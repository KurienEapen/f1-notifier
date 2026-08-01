import express from 'express';
import cors from 'cors';
import path from 'path';
import cron, { ScheduledTask } from 'node-cron';
import { loadConfig, saveConfig, getLogs, addLog } from './config';
import { sendTestAlert } from './notifier';
import { runMonitoringCycle } from './monitor';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

let activeCronTask: ScheduledTask | null = null;

function setupScheduler(cronSchedule: string) {
  if (activeCronTask) {
    activeCronTask.stop();
    activeCronTask = null;
  }

  if (cron.validate(cronSchedule)) {
    console.log(`[Scheduler] Setting up cron job with pattern: "${cronSchedule}"`);
    activeCronTask = cron.schedule(cronSchedule, async () => {
      console.log('[Scheduler] Running scheduled ticket availability check...');
      await runMonitoringCycle();
    });
  } else {
    console.error(`[Scheduler] Invalid cron schedule expression: "${cronSchedule}". Defaulting to */5 * * * *`);
    activeCronTask = cron.schedule('*/5 * * * *', async () => {
      await runMonitoringCycle();
    });
  }
}

// API Routes
app.get('/notifier-api/config', (req, res) => {
  const config = loadConfig();
  res.json(config);
});

app.post('/notifier-api/config', (req, res) => {
  try {
    const newConfig = req.body;
    saveConfig(newConfig);
    setupScheduler(newConfig.cronSchedule || '*/5 * * * *');
    addLog({
      targetName: 'Settings',
      status: 'INFO',
      message: 'Configuration updated via Web Dashboard'
    });
    res.json({ success: true, message: 'Settings saved successfully!' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/notifier-api/logs', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(getLogs(limit));
});

app.post('/notifier-api/test-telegram', async (req, res) => {
  const result = await sendTestAlert();
  res.json(result);
});

app.post('/notifier-api/check-now', async (req, res) => {
  try {
    const summary = await runMonitoringCycle();
    res.json({ success: true, message: `Check complete! Inspected ${summary.checked} targets. Alerts triggered: ${summary.alerts}` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Initialize server
app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🏎️  Bahrain GP 2026 Ticket Notifier Server Active`);
  console.log(`🌐 Dashboard running at: http://localhost:${PORT}`);
  console.log(`==================================================\n`);

  const initialConfig = loadConfig();
  setupScheduler(initialConfig.cronSchedule);

  // Run initial background check on server start
  setTimeout(() => {
    runMonitoringCycle().catch(err => console.error('[Monitor] Initial run error:', err));
  }, 2000);
});
