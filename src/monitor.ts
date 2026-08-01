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
    const previousStatus = String(target.lastStatus);

    // =========================================================================
    // 1. Direct F1 Event Page (https://tickets.formula1.com/en/f1-83069-bahrain-in-malaysia)
    // =========================================================================
    if (target.url.includes('f1-83069-bahrain-in-malaysia') || target.url.includes('f1-') && target.url.includes('bahrain')) {
      const hasEmailForm = $('input[type="email"]').length > 0 || $('input[placeholder*="email"]').length > 0;
      const bodyText = $('body').text().toLowerCase();

      // If email input field exists or "receive latest news" text exists -> STILL INTEREST ONLY
      if (hasEmailForm || bodyText.includes('receive the latest news and ticket promotions')) {
        return {
          status: 'WAITING',
          message: 'Direct event page is showing Email Interest Registration (SEND button). Tickets not open yet.'
        };
      }

      // Check for real checkout actions once email form disappears
      const hasCheckoutAction = bodyText.includes('add to basket') || bodyText.includes('add to cart') || bodyText.includes('select tickets') || bodyText.includes('choose category');

      if (hasCheckoutAction) {
        const msg = '🚨 TICKETS OPEN! Direct event page updated with active checkout buttons.';
        if (previousStatus !== 'AVAILABLE') {
          await triggerTicketAlert({
            targetName: target.name,
            targetUrl: target.url,
            matchedKeyword: 'Active Checkout Buttons Found',
            details: 'Direct F1 event page email form replaced with active ticket purchasing widgets.'
          });
        }
        return { status: 'AVAILABLE', message: msg };
      }

      return {
        status: 'WAITING',
        message: 'Direct event page monitored. No active ticket checkout buttons detected.'
      };
    }

    // =========================================================================
    // 2. F1 Main Catalog Index (https://tickets.formula1.com/ or /en)
    // =========================================================================
    if (target.url === 'https://tickets.formula1.com/' || target.url.endsWith('/en') || target.url.endsWith('/en/')) {
      let isBahrainCardLive = false;
      let cardMessage = 'Bahrain GP card on F1 Store catalog currently shows VIEW MORE (Interest Only). Monitoring active.';

      // Scope strictly to individual card tiles (avoid grid wrappers)
      $('[class*="card"], [class*="tile"], [class*="item"], article').each((_: any, elem: any) => {
        const cardTitle = $(elem).find('h1, h2, h3, h4, h5, [class*="title"], p').first().text().toLowerCase();

        // Must be the specific Bahrain in Malaysia card title
        if (cardTitle.includes('bahrain') && (cardTitle.includes('malaysia') || cardTitle.includes('sepang'))) {
          const buttonText = $(elem).find('a, button, .btn').text().trim().toLowerCase();

          // Check if button text inside THIS specific card changed from "view more" to "book now" or "buy tickets"
          if (buttonText.includes('book now') || buttonText.includes('buy ticket')) {
            isBahrainCardLive = true;
            cardMessage = '🚨 TICKETS OPEN ON F1 CATALOG! Bahrain GP card updated to BOOK NOW!';
            return false;
          }
        }
      });

      if (isBahrainCardLive) {
        if (previousStatus !== 'AVAILABLE') {
          await triggerTicketAlert({
            targetName: 'F1 Store Catalog Index',
            targetUrl: target.url,
            matchedKeyword: 'BOOK NOW Button on Bahrain Card',
            details: 'Bahrain GP catalog card updated from VIEW MORE to BOOK NOW.'
          });
        }
        return { status: 'AVAILABLE', message: cardMessage };
      }

      return { status: 'WAITING', message: cardMessage };
    }

    // =========================================================================
    // 3. Sepang Circuit Ticketing Page Handler
    // =========================================================================
    if (target.url.includes('sepangcircuit.com')) {
      let foundF1Card = false;
      let matchedTitle = '';

      $('article, [class*="card"], [class*="event"], [class*="item"]').each((_: any, elem: any) => {
        const cardTitle = $(elem).find('h1, h2, h3, h4, h5, [class*="title"]').text().toLowerCase();
        const fullCardText = $(elem).text().toLowerCase();

        const isF1Event = cardTitle.includes('bahrain') || cardTitle.includes('formula 1') || (cardTitle.includes('f1') && !cardTitle.includes('offline'));
        const hasBuyBtn = fullCardText.includes('buy ticket') || fullCardText.includes('book now');

        if (isF1Event && hasBuyBtn) {
          foundF1Card = true;
          matchedTitle = $(elem).find('h1, h2, h3, h4, h5, [class*="title"]').first().text().trim() || 'Formula 1 Bahrain GP Card';
          return false;
        }
      });

      if (foundF1Card) {
        const msg = `🚨 TICKETS OPEN ON SEPANG! Event card detected: "${matchedTitle}"`;
        if (previousStatus !== 'AVAILABLE') {
          await triggerTicketAlert({
            targetName: 'Sepang Circuit Official Ticketing',
            targetUrl: target.url,
            matchedKeyword: `Sepang F1 Card: ${matchedTitle}`,
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

    // Fallback for any other custom URLs
    return { status: 'WAITING', message: 'Target checked. No open ticket checkout triggers detected.' };

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
