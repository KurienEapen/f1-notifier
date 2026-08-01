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

    // Sepang Circuit Ticketing Page Handler
    if (target.url.includes('sepangcircuit.com/ticketing')) {
      let foundF1Card = false;
      let matchedText = '';

      $('.card, .event-card, div, section').each((_, elem) => {
        const text = $(elem).text().toLowerCase();
        // Require the card to mention Bahrain OR Formula 1 OR F1
        if ((text.includes('bahrain') || text.includes('formula 1') || text.includes('f1')) && (text.includes('buy ticket') || text.includes('book now') || text.includes('tickets'))) {
          foundF1Card = true;
          matchedText = $(elem).find('h1, h2, h3, h4, .title').text().trim() || 'Formula 1 Bahrain GP Ticket Card';
          return false;
        }
      });

      if (foundF1Card) {
        const msg = `🚨 TICKETS OPEN ON SEPANG! Event card detected: "${matchedText}"`;
        if (target.lastStatus !== 'AVAILABLE') {
          await triggerTicketAlert({
            targetName: 'Sepang Circuit Official Ticketing',
            targetUrl: target.url,
            matchedKeyword: `Sepang F1 Card: ${matchedText}`,
            details: 'Formula 1 / Bahrain GP ticket card published on Sepang Circuit.'
          });
        }
        return { status: 'AVAILABLE', message: msg };
      } else {
        return {
          status: 'WAITING',
          message: 'Sepang ticketing page currently shows other events (MotoGP/MTCC). Formula 1 Bahrain GP not open yet.'
        };
      }
    }

    const bodyText = $('body').text().toLowerCase();

    // Check if the page is currently showing the email interest registration form
    const hasEmailField = $('input[type="email"], input[placeholder*="email"]').length > 0;
    const isInterestOnly = hasEmailField || bodyText.includes('receive the latest news and ticket promotions') || bodyText.includes('register your interest');

    // Strict purchase keywords (Must be an actual checkout / buy action)
    const STRICT_PURCHASE_BUTTONS = [
      'add to basket',
      'add to cart',
      'select tickets',
      'select category',
      'choose tickets',
      'buy tickets now',
      'book tickets now',
      'checkout',
      'buy now',
      'book now'
    ];

    let matchedAction: string | null = null;

    // Search interactive main content area for actual buy buttons
    $('main, .content, .container, .ticket-selection, .tickets-list, form, .card').find('a, button, .btn, input[type="submit"]').each((_, elem) => {
      const text = $(elem).text().trim().toLowerCase();

      // Ignore static navigation or view-more buttons
      if (text === 'send' || text === 'view more' || text.includes('read more') || text.includes('learn more')) return;

      for (const btnText of STRICT_PURCHASE_BUTTONS) {
        if (text.includes(btnText)) {
          matchedAction = btnText;
          return false;
        }
      }
    });

    // Check for actual numerical price listings (e.g., "RM 450", "€180", "$250", "MYR 300")
    const hasPriceListing = /(RM|MYR|[$€£])\s*\d{2,}/i.test(bodyText);

    // Only mark AVAILABLE if we have a strict purchase action OR price listing, AND not trapped in interest-only mode
    if ((matchedAction || (hasPriceListing && !isInterestOnly)) && !isInterestOnly) {
      const finalKeyword = matchedAction || 'Active Ticket Price Listings Found';
      const message = `🚨 TICKETS OPEN! Detected: "${finalKeyword}" on ${target.name}`;

      if (target.lastStatus !== 'AVAILABLE') {
        console.log(`[Monitor] REAL TICKET ALERT TRIGGERED: ${finalKeyword} on ${target.url}`);
        await triggerTicketAlert({
          targetName: target.name,
          targetUrl: target.url,
          matchedKeyword: finalKeyword,
          details: 'Verified ticket checkout buttons / prices detected on site.'
        });
      }

      return { status: 'AVAILABLE', message };
    } else {
      const statusNote = isInterestOnly ? 'Page is currently showing Email Interest Registration.' : 'No active ticket checkout buttons found yet.';
      return {
        status: 'WAITING',
        message: `${statusNote} Monitoring active.`
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
