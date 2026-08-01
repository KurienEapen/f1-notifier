import axios from 'axios';
import * as cheerio from 'cheerio';
import { loadConfig, saveConfig, addLog, MonitoredTarget } from './config';
import { triggerTicketAlert } from './notifier';

const POSITIVE_KEYWORDS = [
  'buy tickets',
  'book tickets',
  'tickets available',
  'register interest',
  'ticket sales open',
  'get tickets',
  'buy now',
  'presale open',
  'on sale now',
  'malaysia grand prix',
  'bahrain grand prix 2026',
  'sepang'
];

const NEGATIVE_KEYWORDS = [
  'sold out',
  'coming soon',
  'tickets not yet available',
  'register your interest',
  'check back later'
];

export async function checkTarget(target: MonitoredTarget): Promise<{ status: 'AVAILABLE' | 'WAITING' | 'ERROR'; message: string }> {
  try {
    const response = await axios.get(target.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000
    });

    const html = response.data;
    if (typeof html !== 'string') {
      return { status: 'WAITING', message: 'Received non-text response' };
    }

    const $ = cheerio.load(html);
    const bodyText = $('body').text().toLowerCase();

    // Auto-Discovery Mode: If checking main catalog index, scan all event links for Malaysia / Bahrain GP
    if (target.url === 'https://tickets.formula1.com/') {
      let discoveredUrl: string | null = null;
      let discoveredText: string | null = null;

      $('a[href*="malaysia"], a[href*="bahrain"], a[href*="sepang"]').each((_, elem) => {
        const href = $(elem).attr('href');
        const text = $(elem).text().trim();
        if (href && (href.includes('malaysia') || href.includes('bahrain') || href.includes('sepang'))) {
          discoveredUrl = href.startsWith('http') ? href : `https://tickets.formula1.com${href}`;
          discoveredText = text || 'Malaysia / Bahrain GP Ticket Link';
          return false;
        }
      });

      if (discoveredUrl) {
        console.log(`[Auto-Discovery] Found event link on main F1 catalog: ${discoveredUrl}`);
        // Alert if a new event page URL is discovered or goes live
        if (target.lastStatus !== 'AVAILABLE') {
          await triggerTicketAlert({
            targetName: 'F1 Store Main Catalog Index',
            targetUrl: discoveredUrl,
            matchedKeyword: 'New Event Link Published on F1 Store Index',
            details: `Found active ticket link on main catalog: "${discoveredText}" -> ${discoveredUrl}`
          });
        }
        return {
          status: 'AVAILABLE',
          message: `Discovered race ticket link on main F1 catalog: ${discoveredUrl}`
        };
      }
    }

    // Check if the page is currently in "Email Interest Registration" mode
    const hasEmailField = $('input[type="email"], input[placeholder*="email"]').length > 0;
    const hasSendBtn = $('button:contains("SEND"), input[type="submit"][value*="SEND"]').length > 0 || bodyText.includes('receive the latest news and ticket promotions');

    // High-confidence ticket purchase indicators
    const PURCHASE_KEYWORDS = [
      'add to basket',
      'add to cart',
      'select tickets',
      'choose ticket',
      'grandstand',
      'general admission',
      'paddock club',
      'main grandstand',
      'view tickets',
      'buy now',
      'tickets from'
    ];

    let matchedKeyword: string | null = null;

    // Search interactive ticket elements & price blocks
    $('.ticket-card, .ticket-item, .price, .grandstand, a, button, .btn').each((_, elem) => {
      const text = $(elem).text().trim().toLowerCase();
      // Skip the email interest submit button
      if (text === 'send' || text.includes('receive the latest news')) return;

      for (const kw of PURCHASE_KEYWORDS) {
        if (text.includes(kw)) {
          matchedKeyword = kw;
          return false;
        }
      }
    });

    // Check for currency symbols + numbers indicating actual price listings (e.g., $150, €200, RM500)
    const hasPriceListing = /([$€£]|RM|MYR)\s*\d+/.test(bodyText);

    if (matchedKeyword || (hasPriceListing && !hasEmailField)) {
      const finalKeyword = matchedKeyword || 'Active Price Listing Detected';
      const message = `Detected active ticket sales element: "${finalKeyword}" on ${target.name}`;

      // Trigger alert if status changed from non-AVAILABLE
      if (target.lastStatus !== 'AVAILABLE') {
        console.log(`[Monitor] ALERT TRIGGER! Match found: ${finalKeyword} on ${target.url}`);
        await triggerTicketAlert({
          targetName: target.name,
          targetUrl: target.url,
          matchedKeyword: finalKeyword,
          details: 'Direct ticket sales / price listings detected on the official F1 portal.'
        });
      }

      return { status: 'AVAILABLE', message };
    } else {
      const statusDetail = hasEmailField ? 'Page is currently showing Email Interest Registration.' : 'No open ticket sale detected yet.';
      return {
        status: 'WAITING',
        message: `${statusDetail} Monitoring active.`
      };
    }
  } catch (error: any) {
    const errorMsg = error.response ? `HTTP ${error.response.status}` : error.message;
    console.error(`[Monitor] Error checking ${target.name}:`, errorMsg);
    return { status: 'ERROR', message: `Fetch failed: ${errorMsg}` };
  }
}

export async function runMonitoringCycle(): Promise<{ checked: number; alerts: number }> {
  const config = loadConfig();
  const now = new Date().toISOString();
  let alertsCount = 0;
  let checkedCount = 0;

  console.log(`[Monitor] Starting monitoring cycle at ${now}...`);

  for (let i = 0; i < config.targets.length; i++) {
    const target = config.targets[i];
    if (!target.enabled) continue;

    checkedCount++;
    const result = await checkTarget(target);

    if (result.status === 'AVAILABLE') {
      alertsCount++;
    }

    // Update target status in config
    config.targets[i].lastChecked = now;
    config.targets[i].lastStatus = result.status;
    config.targets[i].lastMessage = result.message;

    addLog({
      targetName: target.name,
      status: result.status,
      message: result.message
    });
  }

  saveConfig(config);
  console.log(`[Monitor] Completed cycle. Checked ${checkedCount} targets. Alerts sent: ${alertsCount}`);

  return { checked: checkedCount, alerts: alertsCount };
}
