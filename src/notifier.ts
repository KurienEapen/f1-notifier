import axios from 'axios';
import { loadConfig, addLog } from './config';

export interface TicketAlertPayload {
  targetName: string;
  targetUrl: string;
  matchedKeyword: string;
  details?: string;
}

export async function sendTelegramMessage(text: string, inlineUrl?: string): Promise<boolean> {
  const config = loadConfig();
  if (!config.telegramBotToken || !config.telegramChatId) {
    console.warn('[Notifier] Telegram Bot Token or Chat ID missing in configuration.');
    return false;
  }

  const endpoint = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;

  const payload: any = {
    chat_id: config.telegramChatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: false
  };

  if (inlineUrl) {
    payload.reply_markup = {
      inline_keyboard: [
        [
          {
            text: '🎟️ Open Ticket Store',
            url: inlineUrl
          }
        ]
      ]
    };
  }

  try {
    const res = await axios.post(endpoint, payload, { timeout: 10000 });
    if (res.data && res.data.ok) {
      console.log('[Notifier] Telegram alert sent successfully.');
      return true;
    } else {
      console.error('[Notifier] Telegram API returned non-ok response:', res.data);
      return false;
    }
  } catch (error: any) {
    console.error('[Notifier] Failed to send Telegram message:', error.response?.data || error.message);
    return false;
  }
}

export async function triggerTicketAlert(alert: TicketAlertPayload): Promise<boolean> {
  const message = `
🏎️ <b>TICKET ALERT: Bahrain Grand Prix 2026 (Malaysia)</b> 🏎️

<b>Target:</b> ${alert.targetName}
<b>Trigger:</b> ${alert.matchedKeyword}
<b>Status:</b> 🚨 <i>TICKETS / REGISTRATION DETECTED OPEN!</i>

${alert.details ? `<b>Details:</b> ${alert.details}\n` : ''}
<b>Action:</b> Book immediately before seats sell out!
  `.trim();

  const telegramSuccess = await sendTelegramMessage(message, alert.targetUrl);

  // Optional Discord notification fallback if webhook URL configured
  const config = loadConfig();
  if (config.discordWebhookUrl) {
    try {
      await axios.post(config.discordWebhookUrl, {
        content: `🚨 **TICKET ALERT: Bahrain GP 2026 (Malaysia)** 🚨\n**Target:** ${alert.targetName}\n**Link:** ${alert.targetUrl}\n**Detected:** ${alert.matchedKeyword}`
      });
    } catch (e) {
      console.error('[Notifier] Discord webhook error:', e);
    }
  }

  addLog({
    targetName: alert.targetName,
    status: 'AVAILABLE',
    message: `ALERT TRIGGERED! Match: ${alert.matchedKeyword}`
  });

  return telegramSuccess;
}

export async function sendTestAlert(): Promise<{ success: boolean; message: string }> {
  const config = loadConfig();
  if (!config.telegramBotToken || !config.telegramChatId) {
    return {
      success: false,
      message: 'Telegram Bot Token and Chat ID are required! Please enter them in settings.'
    };
  }

  const testMessage = `
✅ <b>Test Notification from Bahrain GP 2026 Ticket Monitor</b>

Your Telegram notification integration is working perfectly!
You will receive instant alerts here as soon as tickets or registration open for the <b>Bahrain GP 2026 at Sepang, Malaysia</b>.
  `.trim();

  const success = await sendTelegramMessage(testMessage, 'https://tickets.formula1.com/');
  if (success) {
    addLog({
      targetName: 'System Test',
      status: 'INFO',
      message: 'Successfully sent test Telegram notification'
    });
    return { success: true, message: 'Test message sent successfully to your Telegram chat!' };
  } else {
    addLog({
      targetName: 'System Test',
      status: 'ERROR',
      message: 'Failed to send test Telegram notification'
    });
    return { success: false, message: 'Failed to send Telegram message. Please verify Bot Token and Chat ID.' };
  }
}
