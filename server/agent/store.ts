import { db } from "../db";

// Project memory for the inbox assistant. Everything it learns from office@ email lives here, in the
// same SQLite file as the site, with every fact pointing back at the email it came from.

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    client TEXT,
    event_date TEXT,
    venue TEXT,
    status TEXT NOT NULL DEFAULT 'active',   -- inquiry | quoting | active | done | lost
    summary TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS agent_messages (
    message_id TEXT PRIMARY KEY,              -- RFC Message-ID, also what AgentMail uses
    thread_id TEXT,
    job_id INTEGER REFERENCES agent_jobs(id),
    direction TEXT NOT NULL DEFAULT 'external', -- internal (from Shift 4) | external
    category TEXT,                             -- inquiry | change | approval | question | logistics | vendor | other
    sender TEXT NOT NULL,
    recipients TEXT,
    subject TEXT,
    sent_at TEXT,
    body TEXT,
    attachments TEXT,                          -- JSON [{filename, content_type, size}]
    summary TEXT,
    processed_at TEXT,
    error TEXT,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS agent_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES agent_jobs(id),
    type TEXT NOT NULL,                        -- decision | question | task | deadline | change
    text TEXT NOT NULL,
    owner TEXT,                                -- who it's on: Shift 4 | client | vendor
    due TEXT,
    status TEXT NOT NULL DEFAULT 'open',       -- open | done
    source_message_id TEXT REFERENCES agent_messages(message_id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS agent_contacts (
    email TEXT PRIMARY KEY,
    name TEXT,
    company TEXT,
    role TEXT,                                 -- client | vendor | venue | internal | other
    last_seen TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS agent_settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE INDEX IF NOT EXISTS agent_messages_job ON agent_messages(job_id, sent_at);
  CREATE INDEX IF NOT EXISTS agent_items_open ON agent_items(status, due);
`);
// Full-text search over email and items (FTS5 ships with Node's SQLite).
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS agent_fts USING fts5(kind, ref, text);
  `);
} catch (e) { console.warn("[agent] FTS unavailable:", (e as Error).message); }

export type Job = {
  id: number; name: string; client: string | null; event_date: string | null; venue: string | null;
  status: string; summary: string | null; notes: string | null; created_at: string; updated_at: string;
};
export type Item = {
  id: number; job_id: number; type: string; text: string; owner: string | null; due: string | null;
  status: string; source_message_id: string | null; created_at: string; closed_at: string | null;
};
export type StoredMessage = {
  message_id: string; thread_id: string | null; job_id: number | null; direction: string; category: string | null;
  sender: string; recipients: string | null; subject: string | null; sent_at: string | null; body: string | null;
  attachments: string | null; summary: string | null; processed_at: string | null; error: string | null; received_at: string;
};

const row = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...(args as never[])) as T | undefined;
const rows = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...(args as never[])) as T[];

function index(kind: string, ref: string, text: string) {
  try {
    db.prepare("DELETE FROM agent_fts WHERE kind = ? AND ref = ?").run(kind, ref);
    db.prepare("INSERT INTO agent_fts (kind, ref, text) VALUES (?, ?, ?)").run(kind, ref, text);
  } catch { /* FTS missing */ }
}

/* ---------- messages ---------- */

export type IncomingMessage = {
  message_id: string; thread_id?: string; sender: string; recipients: string[]; subject?: string;
  sent_at?: string; body: string; attachments?: { filename?: string; content_type?: string; size?: number }[];
};

export const hasMessage = (id: string) => !!row("SELECT 1 FROM agent_messages WHERE message_id = ?", id);

export function saveMessage(m: IncomingMessage, direction: string) {
  db.prepare(
    `INSERT OR IGNORE INTO agent_messages (message_id, thread_id, direction, sender, recipients, subject, sent_at, body, attachments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(m.message_id, m.thread_id ?? null, direction, m.sender, m.recipients.join(", "), m.subject ?? null, m.sent_at ?? null,
    m.body, JSON.stringify(m.attachments ?? []));
  index("message", m.message_id, `${m.subject ?? ""}\n${m.sender}\n${m.body}`);
}

export const getMessage = (id: string) => row<StoredMessage>("SELECT * FROM agent_messages WHERE message_id = ?", id);
export const unprocessedMessages = () => rows<StoredMessage>("SELECT * FROM agent_messages WHERE processed_at IS NULL ORDER BY received_at LIMIT 20");
export const messagesForJob = (jobId: number, limit = 30) =>
  rows<StoredMessage>("SELECT * FROM agent_messages WHERE job_id = ? ORDER BY COALESCE(sent_at, received_at) DESC LIMIT ?", jobId, limit);
export const messagesInThread = (threadId: string) =>
  rows<StoredMessage>("SELECT * FROM agent_messages WHERE thread_id = ? AND processed_at IS NOT NULL ORDER BY COALESCE(sent_at, received_at)", threadId);
export const recentMessages = (limit = 20) =>
  rows<StoredMessage>("SELECT * FROM agent_messages ORDER BY COALESCE(sent_at, received_at) DESC LIMIT ?", limit);

export function markProcessed(id: string, patch: { job_id: number | null; category: string; summary: string }) {
  db.prepare("UPDATE agent_messages SET job_id = ?, category = ?, summary = ?, processed_at = datetime('now'), error = NULL WHERE message_id = ?")
    .run(patch.job_id, patch.category, patch.summary, id);
}
export const markFailed = (id: string, error: string) =>
  db.prepare("UPDATE agent_messages SET error = ? WHERE message_id = ?").run(error.slice(0, 500), id);

/* ---------- jobs ---------- */

export const listJobs = (status?: string) =>
  status ? rows<Job>("SELECT * FROM agent_jobs WHERE status = ? ORDER BY COALESCE(event_date, '9999') , updated_at DESC", status)
    : rows<Job>("SELECT * FROM agent_jobs WHERE status NOT IN ('done', 'lost') ORDER BY COALESCE(event_date, '9999'), updated_at DESC");
export const allJobs = () => rows<Job>("SELECT * FROM agent_jobs ORDER BY updated_at DESC");
export const getJob = (id: number) => row<Job>("SELECT * FROM agent_jobs WHERE id = ?", id);

export function createJob(j: { name: string; client?: string | null; event_date?: string | null; venue?: string | null; status?: string; summary?: string | null }): Job {
  const r = db.prepare("INSERT INTO agent_jobs (name, client, event_date, venue, status, summary) VALUES (?, ?, ?, ?, ?, ?)")
    .run(j.name, j.client ?? null, j.event_date ?? null, j.venue ?? null, j.status ?? "active", j.summary ?? null);
  const job = getJob(Number(r.lastInsertRowid))!;
  index("job", String(job.id), `${job.name} ${job.client ?? ""} ${job.venue ?? ""} ${job.summary ?? ""}`);
  return job;
}

export function updateJob(id: number, patch: Partial<Pick<Job, "name" | "client" | "event_date" | "venue" | "status" | "summary" | "notes">>): Job {
  const cur = getJob(id);
  if (!cur) throw new Error(`No job #${id}`);
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Job;
  db.prepare("UPDATE agent_jobs SET name = ?, client = ?, event_date = ?, venue = ?, status = ?, summary = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(next.name, next.client, next.event_date, next.venue, next.status, next.summary, next.notes, id);
  index("job", String(id), `${next.name} ${next.client ?? ""} ${next.venue ?? ""} ${next.summary ?? ""} ${next.notes ?? ""}`);
  return getJob(id)!;
}

/* ---------- items ---------- */

export const itemsForJob = (jobId: number, status?: string) =>
  status ? rows<Item>("SELECT * FROM agent_items WHERE job_id = ? AND status = ? ORDER BY COALESCE(due, '9999'), id", jobId, status)
    : rows<Item>("SELECT * FROM agent_items WHERE job_id = ? ORDER BY status DESC, COALESCE(due, '9999'), id", jobId);
export const openItems = (dueBefore?: string) =>
  dueBefore ? rows<Item & { job_name: string }>("SELECT i.*, j.name AS job_name FROM agent_items i JOIN agent_jobs j ON j.id = i.job_id WHERE i.status = 'open' AND i.due IS NOT NULL AND i.due <= ? ORDER BY i.due", dueBefore)
    : rows<Item & { job_name: string }>("SELECT i.*, j.name AS job_name FROM agent_items i JOIN agent_jobs j ON j.id = i.job_id WHERE i.status = 'open' ORDER BY COALESCE(i.due, '9999'), i.job_id, i.id");

export function addItem(i: { job_id: number; type: string; text: string; owner?: string | null; due?: string | null; source_message_id?: string | null }): Item {
  const r = db.prepare("INSERT INTO agent_items (job_id, type, text, owner, due, source_message_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(i.job_id, i.type, i.text, i.owner ?? null, i.due ?? null, i.source_message_id ?? null);
  const item = row<Item>("SELECT * FROM agent_items WHERE id = ?", Number(r.lastInsertRowid))!;
  index("item", String(item.id), item.text);
  return item;
}
export function closeItem(id: number): Item {
  db.prepare("UPDATE agent_items SET status = 'done', closed_at = datetime('now') WHERE id = ?").run(id);
  const it = row<Item>("SELECT * FROM agent_items WHERE id = ?", id);
  if (!it) throw new Error(`No item #${id}`);
  return it;
}

/* ---------- contacts ---------- */

export function touchContact(c: { email: string; name?: string | null; company?: string | null; role?: string | null }) {
  const email = c.email.toLowerCase();
  const cur = row<{ name: string | null; company: string | null; role: string | null }>("SELECT name, company, role FROM agent_contacts WHERE email = ?", email);
  db.prepare("INSERT INTO agent_contacts (email, name, company, role) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, company = excluded.company, role = excluded.role, last_seen = datetime('now')")
    .run(email, c.name ?? cur?.name ?? null, c.company ?? cur?.company ?? null, c.role ?? cur?.role ?? null);
}
export const contactsForJob = (jobId: number) =>
  rows<{ email: string; name: string | null; company: string | null; role: string | null }>(
    `SELECT DISTINCT c.email, c.name, c.company, c.role FROM agent_contacts c
     WHERE EXISTS (SELECT 1 FROM agent_messages m WHERE m.job_id = ? AND (lower(m.sender) LIKE '%' || c.email || '%' OR lower(m.recipients) LIKE '%' || c.email || '%'))`, jobId);

/* ---------- search + settings ---------- */

export function search(q: string, limit = 20) {
  try {
    return rows<{ kind: string; ref: string; snippet: string }>(
      "SELECT kind, ref, snippet(agent_fts, 2, '[', ']', '…', 18) AS snippet FROM agent_fts WHERE agent_fts MATCH ? ORDER BY rank LIMIT ?", q, limit);
  } catch {
    const like = `%${q}%`;
    return rows<{ kind: string; ref: string; snippet: string }>(
      "SELECT 'message' AS kind, message_id AS ref, substr(body, 1, 160) AS snippet FROM agent_messages WHERE body LIKE ? OR subject LIKE ? LIMIT ?", like, like, limit);
  }
}
export const getSetting = (k: string) => row<{ value: string }>("SELECT value FROM agent_settings WHERE key = ?", k)?.value;
export const setSetting = (k: string, v: string) =>
  db.prepare("INSERT INTO agent_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

export const stats = () => ({
  jobs: row<{ n: number }>("SELECT count(*) AS n FROM agent_jobs")?.n ?? 0,
  messages: row<{ n: number }>("SELECT count(*) AS n FROM agent_messages")?.n ?? 0,
  unprocessed: row<{ n: number }>("SELECT count(*) AS n FROM agent_messages WHERE processed_at IS NULL")?.n ?? 0,
  failed: row<{ n: number }>("SELECT count(*) AS n FROM agent_messages WHERE error IS NOT NULL")?.n ?? 0,
  open_items: row<{ n: number }>("SELECT count(*) AS n FROM agent_items WHERE status = 'open'")?.n ?? 0,
  last_digest: getSetting("last_digest"),
});
