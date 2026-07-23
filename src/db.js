import Database from "better-sqlite3";
import crypto from "node:crypto";
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
  status TEXT DEFAULT 'ativa',           -- ativa (IA) | pausada | escalada | humana
  assigned_to INTEGER,                   -- id do usuario que assumiu (NULL = IA)
  paused_until TEXT,
  last_message_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (assigned_to) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  wa_message_id TEXT UNIQUE,
  role TEXT NOT NULL,                    -- user | assistant | system
  sender TEXT,                           -- ia | celular | nome do atendente | NULL (lead)
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

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS internal_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user INTEGER NOT NULL,
  to_user INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  read_at TEXT,
  FOREIGN KEY (from_user) REFERENCES users(id),
  FOREIGN KEY (to_user) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_dispatches_status ON dispatches(status);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_internal_pair ON internal_messages(from_user, to_user);
`);

// ---------- migracoes leves (bancos criados por versoes anteriores) ----------
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("conversations", "assigned_to", "assigned_to INTEGER");
ensureColumn("messages", "sender", "sender TEXT");

// ---------- senha (scrypt, sem dependencia nativa extra) ----------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

// ---------- usuarios iniciais do painel ----------
const SEED_USERS = [
  { name: "Dioni", email: "dioni630@gmail.com" },
  { name: "Amanda", email: "amanda.morais81@gmail.com" },
];
for (const u of SEED_USERS) {
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(u.email);
  if (!exists) {
    db.prepare(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)"
    ).run(u.name, u.email, hashPassword("12345678"));
    console.log(`[db] usuario inicial criado: ${u.email} (senha padrao 12345678 - troque no primeiro acesso)`);
  }
}

// ---------- users ----------
export function getUserByEmail(email) {
  return db
    .prepare("SELECT * FROM users WHERE lower(email) = lower(?)")
    .get(String(email || "").trim());
}

export function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function listUsers() {
  return db.prepare("SELECT id, name, email FROM users ORDER BY name").all();
}

export function setUserPassword(userId, password, mustChange) {
  db.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?"
  ).run(hashPassword(password), mustChange ? 1 : 0, userId);
}

// ---------- sessions ----------
export function createSession(userId, days = 7) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + days * 86400 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(token, userId, expires);
  return token;
}

export function getSession(token) {
  if (!token) return null;
  const s = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!s) return null;
  if (new Date(s.expires_at + "Z") < new Date()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return s;
}

export function deleteSession(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

// ---------- internal chat ----------
export function saveInternalMessage(fromUser, toUser, content) {
  const info = db
    .prepare("INSERT INTO internal_messages (from_user, to_user, content) VALUES (?, ?, ?)")
    .run(fromUser, toUser, content);
  return db.prepare("SELECT * FROM internal_messages WHERE id = ?").get(info.lastInsertRowid);
}

export function getInternalThread(userA, userB, limit = 200) {
  const rows = db
    .prepare(
      `SELECT * FROM internal_messages
       WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
       ORDER BY id DESC LIMIT ?`
    )
    .all(userA, userB, userB, userA, limit);
  db.prepare(
    "UPDATE internal_messages SET read_at = datetime('now') WHERE to_user = ? AND from_user = ? AND read_at IS NULL"
  ).run(userA, userB);
  return rows.reverse();
}

export function getUnreadInternalCounts(userId) {
  return db
    .prepare(
      `SELECT from_user, COUNT(*) as total FROM internal_messages
       WHERE to_user = ? AND read_at IS NULL GROUP BY from_user`
    )
    .all(userId);
}

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

/** Atribui a conversa a um atendente humano (IA para de responder). */
export function assignConversation(phone, userId) {
  getOrCreateConversation(phone);
  db.prepare(
    "UPDATE conversations SET assigned_to = ?, status = 'humana', paused_until = NULL WHERE phone = ?"
  ).run(userId, phone);
}

/** Devolve o atendimento para a IA (limpa atribuicao e pausas). */
export function returnConversationToIA(phone) {
  getOrCreateConversation(phone);
  db.prepare(
    "UPDATE conversations SET assigned_to = NULL, status = 'ativa', paused_until = NULL WHERE phone = ?"
  ).run(phone);
}

/**
 * A IA so responde quando a conversa esta 'ativa', sem atendente atribuido
 * e sem pausa vigente.
 */
export function isConversationPaused(phone) {
  const conv = db.prepare("SELECT * FROM conversations WHERE phone = ?").get(phone);
  if (!conv) return false;
  if (conv.assigned_to) return true;
  if (conv.status === "ativa") return false;
  if (conv.paused_until && new Date(conv.paused_until + "Z") < new Date()) {
    setConversationStatus(phone, "ativa");
    return false;
  }
  return true;
}

/**
 * Lista conversas para o painel, com lead e ultima mensagem.
 * filter: "ia" | "user:<id>" | "all"
 */
export function listConversationsForPanel(filter = "all") {
  let where = "";
  const args = [];
  if (filter === "ia") {
    where = "WHERE c.assigned_to IS NULL";
  } else if (filter && filter.startsWith("user:")) {
    where = "WHERE c.assigned_to = ?";
    args.push(parseInt(filter.slice(5), 10));
  }
  return db
    .prepare(
      `SELECT c.id, c.phone, c.status, c.assigned_to, c.paused_until, c.last_message_at,
              u.name as assigned_name,
              l.name as lead_name, l.status as lead_status,
              (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) as last_message,
              (SELECT role FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) as last_role
       FROM conversations c
       LEFT JOIN leads l ON l.phone = c.phone
       LEFT JOIN users u ON u.id = c.assigned_to
       ${where}
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT 300`
    )
    .all(...args);
}

// ---------- messages ----------
export function saveMessage({ phone, waMessageId, role, content, mediaType, sender }) {
  const conv = getOrCreateConversation(phone);
  try {
    db.prepare(
      `INSERT INTO messages (conversation_id, wa_message_id, role, sender, content, media_type)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(conv.id, waMessageId ?? null, role, sender ?? null, content, mediaType ?? null);
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
      `SELECT role, sender, content, media_type, created_at FROM messages
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
