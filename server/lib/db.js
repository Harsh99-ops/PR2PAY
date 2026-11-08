import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'pr2pay.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  issue_number INTEGER NOT NULL,
  issue_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  reward_amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  criteria_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  pr_number INTEGER NOT NULL,
  pr_url TEXT NOT NULL,
  pr_title TEXT NOT NULL,
  pr_author TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  status TEXT NOT NULL,
  score REAL NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evaluations_task ON evaluations(task_id, created_at DESC);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
  dedupe_key TEXT UNIQUE,
  batch_id TEXT NOT NULL UNIQUE,
  payout_batch_id TEXT,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL,
  paypal_status TEXT,
  retry_mode TEXT NOT NULL DEFAULT 'none',
  attempts INTEGER NOT NULL DEFAULT 1,
  response_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_eval ON payments(evaluation_id, created_at DESC);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payout_batch_id TEXT,
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL
);
`);

const paymentColumns = db.prepare('PRAGMA table_info(payments)').all().map(column => column.name);
if (!paymentColumns.includes('dedupe_key')) db.exec('ALTER TABLE payments ADD COLUMN dedupe_key TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_dedupe_key ON payments(dedupe_key)');

export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}
export function setSetting(key, value) {
  db.prepare(`INSERT INTO settings(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}
export function nowIso() { return new Date().toISOString(); }
export function newId() { return crypto.randomUUID(); }

const defaultRepo = process.env.DEFAULT_GITHUB_REPO_URL;
if (defaultRepo && !getSetting('repository_url')) {
  setSetting('repository_url', defaultRepo);
}
