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

    // Check for strong positive keywords in page buttons, links, or headings
    let matchedKeyword: string | null = null;

    // Search interactive elements first (buttons, links, headings)
    $('a, button, .btn, .ticket-status, h1, h2, h3').each((_, elem) => {
      const text = $(elem).text().trim().toLowerCase();
      for (const kw of POSITIVE_KEYWORDS) {
        if (text.includes(kw) && !text.includes('sold out')) {
          matchedKeyword = kw;
          return false;
        }
      }
    });

    // Fallback search in full page body
    if (!matchedKeyword) {
      for (const kw of ['buy tickets for 2026', 'bahrain grand prix 2026 tickets', 'sepang f1 tickets open']) {
        if (bodyText.includes(kw)) {
          matchedKeyword = kw;
          break;
        }
      }
    }

    if (matchedKeyword) {
      const message = `Detected positive keyword match: "${matchedKeyword}" on ${target.name}`;

      // Trigger alert if status changed from non-AVAILABLE or if first match
      if (target.lastStatus !== 'AVAILABLE') {
        console.log(`[Monitor] ALERT TRIGGER! Match found: ${matchedKeyword} on ${target.url}`);
        await triggerTicketAlert({
          targetName: target.name,
          targetUrl: target.url,
          matchedKeyword: matchedKeyword,
          details: 'Direct match detected on ticket site elements.'
        });
      }

      return { status: 'AVAILABLE', message };
    } else {
      return {
        status: 'WAITING',
        message: 'No open ticket sale detected yet. Monitoring active.'
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
