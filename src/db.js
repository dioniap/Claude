import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  source TEXT DEFAULT 'manual',          -- manual | excel | redrive | inbound
  redrive_id TEXT,
  status TEXT DEFAULT 'novo',            -- novo | contatado | conversando | interessado | negociando | fechado | perdido | escalado
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'ativa',           -- ativa | pausada | escalada
  paused_until TEXT,
  last_message_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  wa_message_id TEXT UNIQUE,
  role TEXT NOT NULL,                    -- user | assistant | system
  content TEXT NOT NULL,
  media_type TEXT,                       -- image | document | audio | video | null
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign TEXT,
  phone TEXT NOT NULL,
  name TEXT,
  template TEXT,
  status TEXT DEFAULT 'pendente',        -- pendente | enviado | erro
  error TEXT,
  wa_message_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_dispatches_status ON dispatches(status);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
`);

// ---------- leads ----------
export function upsertLead({ phone, name, email, source, redriveId }) {
  const existing = db.prepare("SELECT * FROM leads WHERE phone = ?").get(phone);
  if (existing) {
    db.prepare(
      `UPDATE leads SET
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        redrive_id = COALESCE(?, redrive_id),
        updated_at = datetime('now')
       WHERE phone = ?`
    ).run(name ?? null, email ?? null, redriveId ?? null, phone);
    return db.prepare("SELECT * FROM leads WHERE phone = ?").get(phone);
  }
  db.prepare(
    "INSERT INTO leads (phone, name, email, source, redrive_id) VALUES (?, ?, ?, ?, ?)"
  ).run(phone, name ?? null, email ?? null, source ?? "manual", redriveId ?? null);
  return db.prepare("SELECT * FROM leads WHERE phone = ?").get(phone);
}

export function getLead(phone) {
  return db.prepare("SELECT * FROM leads WHERE phone = ?").get(phone);
}

export function updateLeadStatus(phone, status, notes) {
  db.prepare(
    `UPDATE leads SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now') WHERE phone = ?`
  ).run(status, notes ?? null, phone);
}

export function listLeads() {
  return db.prepare("SELECT * FROM leads ORDER BY updated_at DESC").all();
}

// ---------- conversations ----------
export function getOrCreateConversation(phone) {
  let conv = db.prepare("SELECT * FROM conversations WHERE phone = ?").get(phone);
  if (!conv) {
    db.prepare("INSERT INTO conversations (phone) VALUES (?)").run(phone);
    conv = db.prepare("SELECT * FROM conversations WHERE phone = ?").get(phone);
  }
  return conv;
}

export function setConversationStatus(phone, status, pausedUntil = null) {
  getOrCreateConversation(phone);
  db.prepare(
    "UPDATE conversations SET status = ?, paused_until = ? WHERE phone = ?"
  ).run(status, pausedUntil, phone);
}

export function isConversationPaused(phone) {
  const conv = db.prepare("SELECT * FROM conversations WHERE phone = ?").get(phone);
  if (!conv) return false;
  if (conv.status === "ativa") return false;
  if (conv.paused_until && new Date(conv.paused_until + "Z") < new Date()) {
    setConversationStatus(phone, "ativa");
    return false;
  }
  return true;
}

// ---------- messages ----------
export function saveMessage({ phone, waMessageId, role, content, mediaType }) {
  const conv = getOrCreateConversation(phone);
  try {
    db.prepare(
      `INSERT INTO messages (conversation_id, wa_message_id, role, content, media_type)
       VALUES (?, ?, ?, ?, ?)`
    ).run(conv.id, waMessageId ?? null, role, content, mediaType ?? null);
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return false; // webhook reentregue
    throw e;
  }
  db.prepare(
    "UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?"
  ).run(conv.id);
  return true;
}

export function messageAlreadyProcessed(waMessageId) {
  if (!waMessageId) return false;
  return !!db
    .prepare("SELECT id FROM messages WHERE wa_message_id = ?")
    .get(waMessageId);
}

export function getHistory(phone, limit) {
  const conv = getOrCreateConversation(phone);
  const rows = db
    .prepare(
      `SELECT role, content, media_type, created_at FROM messages
       WHERE conversation_id = ? AND role IN ('user','assistant')
       ORDER BY id DESC LIMIT ?`
    )
    .all(conv.id, limit);
  return rows.reverse();
}

// ---------- dispatches ----------
export function queueDispatch({ campaign, phone, name, template }) {
  db.prepare(
    "INSERT INTO dispatches (campaign, phone, name, template) VALUES (?, ?, ?, ?)"
  ).run(campaign ?? null, phone, name ?? null, template ?? null);
}

export function nextPendingDispatch() {
  return db
    .prepare("SELECT * FROM dispatches WHERE status = 'pendente' ORDER BY id LIMIT 1")
    .get();
}

export function markDispatch(id, status, { error, waMessageId } = {}) {
  db.prepare(
    `UPDATE dispatches SET status = ?, error = ?, wa_message_id = ?, sent_at = datetime('now') WHERE id = ?`
  ).run(status, error ?? null, waMessageId ?? null, id);
}

export function dispatchStats(campaign) {
  const where = campaign ? "WHERE campaign = ?" : "";
  const args = campaign ? [campaign] : [];
  return db
    .prepare(
      `SELECT status, COUNT(*) as total FROM dispatches ${where} GROUP BY status`
    )
    .all(...args);
}
