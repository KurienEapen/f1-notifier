import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface MonitoredTarget {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastChecked?: string;
  lastStatus?: 'AVAILABLE' | 'WAITING' | 'ERROR';
  lastMessage?: string;
}

export interface AppConfig {
  telegramBotToken: string;
  telegramChatId: string;
  discordWebhookUrl: string;
  cronSchedule: string;
  targets: MonitoredTarget[];
}

export interface LogEntry {
  id: string;
  timestamp: string;
  targetName: string;
  status: 'AVAILABLE' | 'WAITING' | 'ERROR' | 'INFO';
  message: string;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

const DEFAULT_TARGETS: MonitoredTarget[] = [
  {
    id: 'f1-official',
    name: 'F1 Official Ticket Store (Bahrain/Malaysia GP 2026)',
    url: 'https://tickets.formula1.com/',
    enabled: true,
    lastStatus: 'WAITING',
    lastMessage: 'Initialized'
  },
  {
    id: 'sepang-circuit',
    name: 'Sepang International Circuit Official',
    url: 'https://www.sepangcircuit.com/',
    enabled: true,
    lastStatus: 'WAITING',
    lastMessage: 'Initialized'
  },
  {
    id: 'bahrain-gp-official',
    name: 'Bahrain GP Official Site',
    url: 'https://www.bahraingp.com/',
    enabled: true,
    lastStatus: 'WAITING',
    lastMessage: 'Initialized'
  }
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadConfig(): AppConfig {
  ensureDataDir();

  let config: Partial<AppConfig> = {};

  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      config = JSON.parse(data);
    } catch (e) {
      console.error('Error reading settings.json, loading defaults:', e);
    }
  }

  return {
    telegramBotToken: config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: config.telegramChatId || process.env.TELEGRAM_CHAT_ID || '',
    discordWebhookUrl: config.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL || '',
    cronSchedule: config.cronSchedule || process.env.CHECK_CRON_SCHEDULE || '*/5 * * * *',
    targets: config.targets && config.targets.length > 0 ? config.targets : DEFAULT_TARGETS
  };
}

export function saveConfig(newConfig: AppConfig): void {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(newConfig, null, 2), 'utf8');
}

export function getLogs(limit = 50): LogEntry[] {
  ensureDataDir();
  if (!fs.existsSync(LOGS_FILE)) return [];
  try {
    const data = fs.readFileSync(LOGS_FILE, 'utf8');
    const logs: LogEntry[] = JSON.parse(data);
    return logs.slice(0, limit);
  } catch (e) {
    return [];
  }
}

export function addLog(log: Omit<LogEntry, 'id' | 'timestamp'>): void {
  ensureDataDir();
  const logs = getLogs(200);
  const newEntry: LogEntry = {
    id: Math.random().toString(36).substring(2, 9),
    timestamp: new Date().toISOString(),
    ...log
  };
  logs.unshift(newEntry);
  fs.writeFileSync(LOGS_FILE, JSON.stringify(logs.slice(0, 100), null, 2), 'utf8');
}
