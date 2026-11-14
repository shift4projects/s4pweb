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

// Added for the Gmail connection: retry counter, and PDF attachments held until the message is processed.
for (const [col, ddl] of [["attempts", "INTEGER NOT NULL DEFAULT 0"], ["pdfs", "TEXT"], ["mailbox", "TEXT"]] as const) {
  if (!(db.prepare("PRAGMA table_info(agent_messages)").all() as { name: string }[]).some((c) => c.name === col)) db.exec(`ALTER TABLE agent_messages ADD COLUMN ${col} ${ddl}`);
}

// One-time: emails that failed on the old forced-tool call get a fresh set of retries.
// Emails that "failed" only because the Anthropic account ran out of credit get their retries back.
db.exec("UPDATE agent_messages SET attempts = 0 WHERE processed_at IS NULL AND (error LIKE '%credit balance%' OR error LIKE '%overloaded%')");
// Price memory: every line item from the estimates, quotes and invoices that pass through email.
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    source_message_id TEXT NOT NULL,
    doc TEXT NOT NULL,                 -- attachment filename
    doc_type TEXT,                     -- estimate | quote | invoice
    doc_number TEXT,
    doc_date TEXT,
    issuer TEXT,                       -- who wrote the document
    bill_to TEXT,
    side TEXT NOT NULL,                -- sell = Shift 4 charging a client; cost = a vendor or crew charging Shift 4
    category TEXT,                     -- video | audio | lighting | staging | power | rigging | labor | transport | creative | other
    description TEXT NOT NULL,
    qty REAL,
    unit TEXT,
    unit_price TEXT,                   -- as written
    amount TEXT,                       -- as written
    amount_num REAL,
    doc_total TEXT
  );
  CREATE INDEX IF NOT EXISTS agent_prices_job ON agent_prices(job_id);
  CREATE INDEX IF NOT EXISTS agent_prices_src ON agent_prices(source_message_id);
`);
try { db.exec("ALTER TABLE agent_messages ADD COLUMN prices_state TEXT"); } catch { /* already there */ } // null = not looked at; done | none | failed

// Added for the tidy pass and the morning brief.
for (const [table, col, ddl] of [
  ["agent_jobs", "billing", "TEXT"],        // JSON: invoices seen in email for this job
  ["agent_jobs", "tidied_at", "TEXT"],      // last time the whole job was re-read and cleaned up
  ["agent_items", "closed_why", "TEXT"],    // answered | done | obsolete | duplicate (set by the tidy pass)
  ["agent_messages", "needs_reply", "INTEGER"], // 1 when the email is waiting on an answer from Shift 4
] as const) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`); } catch { /* already there */ }
}
if (!(db.prepare("SELECT value FROM agent_settings WHERE key = 'reset_attempts_v1'").get())) {
  db.exec("UPDATE agent_messages SET attempts = 0, error = NULL WHERE processed_at IS NULL");
  db.prepare("INSERT OR REPLACE INTO agent_settings (key, value) VALUES ('reset_attempts_v1', '1')").run();
}

export type Job = {
  id: number; name: string; client: string | null; event_date: string | null; venue: string | null;
  status: string; summary: string | null; notes: string | null; created_at: string; updated_at: string;
  billing?: string | null; tidied_at?: string | null;
};
/** One invoice or bill seen in email. Amounts are kept exactly as written. */
export type Invoice = {
  number: string | null; party: string; direction: "receivable" | "payable"; amount: string | null;
  status: "sent" | "paid" | "overdue" | "disputed" | "unknown"; due: string | null; note: string | null;
};
export type Item = {
  id: number; job_id: number; type: string; text: string; owner: string | null; due: string | null;
  status: string; source_message_id: string | null; created_at: string; closed_at: string | null;
};
export type StoredMessage = {
  attempts?: number; pdfs?: string | null; mailbox?: string | null;
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
  /** PDFs to show the model (base64), dropped once the message is processed. */
  pdfs?: { name: string; data: string }[];
  mailbox?: string;
};

export const hasMessage = (id: string) => !!row("SELECT 1 FROM agent_messages WHERE message_id = ?", id);

export function saveMessage(m: IncomingMessage, direction: string) {
  db.prepare(
    `INSERT OR IGNORE INTO agent_messages (message_id, thread_id, direction, sender, recipients, subject, sent_at, body, attachments, pdfs, mailbox)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(m.message_id, m.thread_id ?? null, direction, m.sender, m.recipients.join(", "), m.subject ?? null, m.sent_at ?? null,
    m.body, JSON.stringify(m.attachments ?? []), m.pdfs?.length ? JSON.stringify(m.pdfs) : null, m.mailbox ?? null);
  index("message", m.message_id, `${m.subject ?? ""}\n${m.sender}\n${m.body}`);
}

export const getMessage = (id: string) => row<StoredMessage>("SELECT * FROM agent_messages WHERE message_id = ?", id);
// Oldest first, so job memory builds in the order things actually happened. Three strikes and a message is left alone.
export const unprocessedMessages = (limit = 20) => rows<StoredMessage>("SELECT * FROM agent_messages WHERE processed_at IS NULL AND attempts < 3 ORDER BY COALESCE(sent_at, received_at) LIMIT ?", limit);
export const messagesForJob = (jobId: number, limit = 30) =>
  rows<StoredMessage>("SELECT * FROM agent_messages WHERE job_id = ? ORDER BY COALESCE(sent_at, received_at) DESC LIMIT ?", jobId, limit);
export const messagesInThread = (threadId: string) =>
  rows<StoredMessage>("SELECT * FROM agent_messages WHERE thread_id = ? AND processed_at IS NOT NULL ORDER BY COALESCE(sent_at, received_at)", threadId);
export const recentMessages = (limit = 20) =>
  rows<StoredMessage>("SELECT * FROM agent_messages ORDER BY COALESCE(sent_at, received_at) DESC LIMIT ?", limit);

export function markProcessed(id: string, patch: { job_id: number | null; category: string; summary: string; needs_reply?: boolean }) {
  db.prepare("UPDATE agent_messages SET job_id = ?, category = ?, summary = ?, needs_reply = ?, processed_at = datetime('now'), error = NULL, pdfs = NULL WHERE message_id = ?")
    .run(patch.job_id, patch.category, patch.summary, patch.needs_reply == null ? null : patch.needs_reply ? 1 : 0, id);
}
/** A job's whole email trail, oldest first (the most recent `limit` emails). */
export const timelineForJob = (jobId: number, limit = 250) =>
  rows<StoredMessage>("SELECT * FROM (SELECT * FROM agent_messages WHERE job_id = ? AND processed_at IS NOT NULL ORDER BY COALESCE(sent_at, received_at) DESC LIMIT ?) ORDER BY COALESCE(sent_at, received_at)", jobId, limit);
/** Records an error without using up one of the email's retries (account-level problems). */
export const noteError = (id: string, error: string) =>
  db.prepare("UPDATE agent_messages SET error = ? WHERE message_id = ?").run(error.slice(0, 500), id);
export const markFailed = (id: string, error: string) =>
  db.prepare("UPDATE agent_messages SET error = ?, attempts = attempts + 1 WHERE message_id = ?").run(error.slice(0, 500), id);

/* ---------- jobs ---------- */

// "Current" = still in play: the event is upcoming or within the last 2 weeks, or there was email on it in the last 30 days.
// The year-long backfill left plenty of jobs marked active/quoting that are long over; they stay searchable but out of the way.
const LAST_EMAIL = "(SELECT max(COALESCE(sent_at, received_at)) FROM agent_messages WHERE job_id = j.id)";
// A finished job stays current while email is still coming in on it (wrap-up, invoices, returns).
const CURRENT_JOB = `j.status != 'lost' AND ((j.status != 'done' AND j.event_date >= date('now', '-14 days')) OR ${LAST_EMAIL} >= date('now', '-30 days'))`;
// An item is fresh when its due date, or failing that the email it came from, is within the last 45 days.
// Decisions are a record of what was agreed, not something to do, so they never count as "open" work.
const FRESH_ITEM = "i.type != 'decision' AND COALESCE(i.due, (SELECT COALESCE(sent_at, received_at) FROM agent_messages WHERE message_id = i.source_message_id), i.created_at) >= date('now', '-45 days')";

/** Jobs by status, or by default only current ones (pass includeOld for every open job ever seen). */
export const listJobs = (status?: string, includeOld = false) =>
  status ? rows<Job>("SELECT * FROM agent_jobs WHERE status = ? ORDER BY COALESCE(event_date, '9999') , updated_at DESC", status)
    : includeOld ? rows<Job>("SELECT * FROM agent_jobs WHERE status NOT IN ('done', 'lost') ORDER BY COALESCE(event_date, '9999'), updated_at DESC")
    : rows<Job>(`SELECT j.* FROM agent_jobs j WHERE ${CURRENT_JOB} ORDER BY COALESCE(j.event_date, '9999'), j.updated_at DESC`);
/** Open items on one job that are still live (not weeks past due, not from long-ago email). */
export const currentItemsForJob = (jobId: number) =>
  rows<Item>(`SELECT i.* FROM agent_items i WHERE i.job_id = ? AND i.status = 'open' AND ${FRESH_ITEM} ORDER BY COALESCE(i.due, '9999'), i.id`, jobId);
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

/** Folds job `from` into job `into`: its emails and items move over, then it's removed. */
export function mergeJobs(into: number, from: number): Job {
  if (into === from) throw new Error("Pick two different jobs");
  const a = getJob(into), b = getJob(from);
  if (!a || !b) throw new Error("Unknown job id");
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE agent_messages SET job_id = ? WHERE job_id = ?").run(into, from);
    db.prepare("UPDATE agent_items SET job_id = ? WHERE job_id = ?").run(into, from);
    db.prepare("UPDATE agent_prices SET job_id = ? WHERE job_id = ?").run(into, from);
    db.prepare("DELETE FROM agent_jobs WHERE id = ?").run(from);
    db.prepare("UPDATE agent_jobs SET tidied_at = NULL WHERE id = ?").run(into); // re-read the combined job on the next tidy
    try { db.prepare("DELETE FROM agent_fts WHERE kind = 'job' AND ref = ?").run(String(from)); } catch { /* no FTS */ }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return updateJob(into, {
    client: a.client ?? b.client ?? undefined, event_date: a.event_date ?? b.event_date ?? undefined, venue: a.venue ?? b.venue ?? undefined,
    notes: [a.notes, b.notes, `Merged in "${b.name}" (#${from}).`].filter(Boolean).join("\n"),
  });
}

/** Jobs with email that arrived since they were last tidied (or never tidied), busiest first. */
export const jobsNeedingTidy = (limit = 200) =>
  rows<Job>(`SELECT j.* FROM agent_jobs j WHERE EXISTS (SELECT 1 FROM agent_messages m WHERE m.job_id = j.id AND m.processed_at > COALESCE(j.tidied_at, ''))
    ORDER BY (SELECT count(*) FROM agent_messages m WHERE m.job_id = j.id) DESC LIMIT ?`, limit);
export function markTidied(id: number, invoices: Invoice[]) {
  db.prepare("UPDATE agent_jobs SET billing = ?, tidied_at = datetime('now') WHERE id = ?").run(JSON.stringify(invoices), id);
}
export const invoicesOf = (j: Job): Invoice[] => { try { return JSON.parse(j.billing || "[]"); } catch { return []; } };
/** Every invoice still open (not paid), across all jobs, with the job it belongs to. */
export function openInvoices(direction?: "receivable" | "payable") {
  return rows<Job>("SELECT * FROM agent_jobs WHERE billing IS NOT NULL AND billing != '[]' ORDER BY COALESCE(event_date, '9999') DESC")
    .flatMap((j) => invoicesOf(j).filter((v) => v.status !== "paid" && (!direction || v.direction === direction))
      .map((v) => ({ job_id: j.id, job: j.name, event_date: j.event_date, ...v })));
}

/* ---------- price memory ---------- */

export type PriceLine = {
  id: number; job_id: number | null; source_message_id: string; doc: string; doc_type: string | null; doc_number: string | null; doc_date: string | null;
  issuer: string | null; bill_to: string | null; side: string; category: string | null; description: string; qty: number | null; unit: string | null;
  unit_price: string | null; amount: string | null; amount_num: number | null; doc_total: string | null;
};
/** Emails carrying a PDF that looks like an estimate, quote, invoice or proposal and hasn't been read for prices yet. */
export const priceCandidates = (limit = 20) =>
  rows<StoredMessage>(`SELECT * FROM agent_messages WHERE prices_state IS NULL AND processed_at IS NOT NULL
    AND attachments LIKE '%pdf%' AND (lower(attachments) LIKE '%estimate%' OR lower(attachments) LIKE '%quote%' OR lower(attachments) LIKE '%invoice%' OR lower(attachments) LIKE '%proposal%')
    AND lower(sender) NOT LIKE '%stripe.com%' AND lower(sender) NOT LIKE '%zoom.us%' AND lower(sender) NOT LIKE '%intuit.com%'
    ORDER BY COALESCE(sent_at, received_at) DESC LIMIT ?`, limit);
export const priceCandidateCount = () => row<{ n: number }>(`SELECT count(*) AS n FROM agent_messages WHERE prices_state IS NULL AND processed_at IS NOT NULL
    AND attachments LIKE '%pdf%' AND (lower(attachments) LIKE '%estimate%' OR lower(attachments) LIKE '%quote%' OR lower(attachments) LIKE '%invoice%' OR lower(attachments) LIKE '%proposal%')
    AND lower(sender) NOT LIKE '%stripe.com%' AND lower(sender) NOT LIKE '%zoom.us%' AND lower(sender) NOT LIKE '%intuit.com%'`)?.n ?? 0;
export const setPricesState = (messageId: string, state: "done" | "none" | "failed") =>
  db.prepare("UPDATE agent_messages SET prices_state = ? WHERE message_id = ?").run(state, messageId);
const num = (s: string | null | undefined) => { const d = String(s ?? "").replace(/[^0-9.\-]/g, ""); const n = Number(d); return /\d/.test(d) && isFinite(n) ? n : null; };
export function savePrices(messageId: string, jobId: number | null, doc: { doc: string; doc_type: string | null; doc_number: string | null; doc_date: string | null; issuer: string | null; bill_to: string | null; side: string; total: string | null },
  lines: { category: string | null; description: string; qty: number | null; unit: string | null; unit_price: string | null; amount: string | null }[]) {
  db.prepare("DELETE FROM agent_prices WHERE source_message_id = ? AND doc = ?").run(messageId, doc.doc);
  const ins = db.prepare(`INSERT INTO agent_prices (job_id, source_message_id, doc, doc_type, doc_number, doc_date, issuer, bill_to, side, category, description, qty, unit, unit_price, amount, amount_num, doc_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const l of lines) ins.run(jobId, messageId, doc.doc, doc.doc_type, doc.doc_number, doc.doc_date, doc.issuer, doc.bill_to, doc.side, l.category, l.description, l.qty, l.unit, l.unit_price, l.amount, num(l.amount), doc.total);
}
const PRICE_COLS = "p.*, j.name AS job_name, j.event_date AS job_date";
/** Past line items matching every word of the query, newest document first. */
export function searchPrices(q: string, side?: string, limit = 40) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  const where = [...words.map(() => "lower(p.description || ' ' || COALESCE(p.category, '')) LIKE ?"), ...(side ? ["p.side = ?"] : [])].join(" AND ") || "1";
  // LIKE finds the candidates; the check below keeps only hits at the start of a word ("led" must not match "unbilled").
  const starts = words.map((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
  return rows<PriceLine & { job_name: string | null; job_date: string | null }>(
    `SELECT ${PRICE_COLS} FROM agent_prices p LEFT JOIN agent_jobs j ON j.id = p.job_id WHERE ${where} ORDER BY COALESCE(p.doc_date, '') DESC, p.id LIMIT ?`,
    ...words.map((w) => `%${w}%`), ...(side ? [side] : []), limit * 4,
  ).filter((p) => starts.every((re) => re.test(`${p.description} ${p.category ?? ""}`))).slice(0, limit);
}
export const pricesForJob = (jobId: number) =>
  rows<PriceLine>("SELECT p.* FROM agent_prices p WHERE p.job_id = ? ORDER BY COALESCE(p.doc_date, ''), p.doc, p.id", jobId);
export const priceStats = () => ({
  lines: row<{ n: number }>("SELECT count(*) AS n FROM agent_prices")?.n ?? 0,
  documents: row<{ n: number }>("SELECT count(*) AS n FROM (SELECT DISTINCT source_message_id, doc FROM agent_prices)")?.n ?? 0,
  waiting: priceCandidateCount(),
});

/* ---------- the morning brief ---------- */

const WHEN = "COALESCE(m.sent_at, m.received_at)";
/** Threads on current jobs where the last word is `direction` (external = waiting on Shift 4, internal = waiting on them). */
export function waitingThreads(direction: "external" | "internal", days = 14) {
  // needs_reply is set on newer mail; older mail falls back to the kind of email it was.
  const pending = direction === "external"
    ? "(m.needs_reply = 1 OR (m.needs_reply IS NULL AND m.category IN ('inquiry', 'question', 'approval', 'change')))"
    : "m.category IN ('question', 'approval', 'billing', 'inquiry')";
  return rows<StoredMessage & { job_name: string }>(
    `SELECT m.*, j.name AS job_name FROM agent_messages m JOIN agent_jobs j ON j.id = m.job_id
     WHERE m.processed_at IS NOT NULL AND m.direction = ? AND ${CURRENT_JOB} AND ${pending}
       AND ${WHEN} >= date('now', ?) AND ${WHEN} <= strftime('%Y-%m-%dT%H:%M:%S', 'now', ?)
       AND NOT EXISTS (SELECT 1 FROM agent_messages x WHERE x.job_id = m.job_id AND COALESCE(x.sent_at, x.received_at) > ${WHEN}
                        AND (x.thread_id = m.thread_id OR x.direction != m.direction))
     ORDER BY ${WHEN}`, direction, `-${days} days`, direction === "external" ? "-3 hours" : "-2 days");
}
export const upcomingJobs = (days = 14) =>
  rows<Job>("SELECT * FROM agent_jobs j WHERE j.status NOT IN ('done', 'lost') AND length(j.event_date) = 10 AND j.event_date >= date('now', '-1 day') AND j.event_date <= date('now', ?) ORDER BY j.event_date", `+${days} days`);
export const newInquiries = (days = 7) =>
  rows<Job>("SELECT * FROM agent_jobs j WHERE j.status = 'inquiry' AND j.created_at >= date('now', '-2 days') AND (SELECT min(COALESCE(sent_at, received_at)) FROM agent_messages WHERE job_id = j.id) >= date('now', ?) ORDER BY j.created_at DESC", `-${days} days`);

/* ---------- items ---------- */

export const itemsForJob = (jobId: number, status?: string) =>
  status ? rows<Item>("SELECT * FROM agent_items WHERE job_id = ? AND status = ? ORDER BY COALESCE(due, '9999'), id", jobId, status)
    : rows<Item>("SELECT * FROM agent_items WHERE job_id = ? ORDER BY status DESC, COALESCE(due, '9999'), id", jobId);
/** Open items, by default only fresh ones on current jobs. */
export function openItems(dueBefore?: string, includeOld = false) {
  const where = ["i.status = 'open'", ...(includeOld ? [] : [CURRENT_JOB, FRESH_ITEM]), ...(dueBefore ? ["i.due IS NOT NULL AND i.due <= ?"] : [])].join(" AND ");
  const sql = `SELECT i.*, j.name AS job_name FROM agent_items i JOIN agent_jobs j ON j.id = i.job_id WHERE ${where} ORDER BY COALESCE(i.due, '9999'), i.job_id, i.id`;
  return dueBefore ? rows<Item & { job_name: string }>(sql, dueBefore) : rows<Item & { job_name: string }>(sql);
}

export function addItem(i: { job_id: number; type: string; text: string; owner?: string | null; due?: string | null; source_message_id?: string | null }): Item {
  const r = db.prepare("INSERT INTO agent_items (job_id, type, text, owner, due, source_message_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(i.job_id, i.type, i.text, i.owner ?? null, i.due ?? null, i.source_message_id ?? null);
  const item = row<Item>("SELECT * FROM agent_items WHERE id = ?", Number(r.lastInsertRowid))!;
  index("item", String(item.id), item.text);
  return item;
}
export function closeItem(id: number, why?: string): Item {
  db.prepare("UPDATE agent_items SET status = 'done', closed_at = datetime('now'), closed_why = ? WHERE id = ?").run(why ?? null, id);
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

/** Look someone up by name, company or email, most recently seen first, with the jobs they've been on. */
export function findContacts(q: string, limit = 15) {
  const like = `%${q.toLowerCase()}%`;
  return rows<{ email: string; name: string | null; company: string | null; role: string | null; last_seen: string }>(
    "SELECT * FROM agent_contacts WHERE lower(email) LIKE ? OR lower(COALESCE(name, '')) LIKE ? OR lower(COALESCE(company, '')) LIKE ? ORDER BY last_seen DESC LIMIT ?", like, like, like, limit,
  ).map((c) => ({
    ...c,
    jobs: rows<{ id: number; name: string; event_date: string | null }>(
      `SELECT DISTINCT j.id, j.name, j.event_date FROM agent_jobs j JOIN agent_messages m ON m.job_id = j.id
       WHERE lower(m.sender) LIKE '%' || ? || '%' OR lower(m.recipients) LIKE '%' || ? || '%' ORDER BY COALESCE(j.event_date, '') DESC LIMIT 8`, c.email, c.email),
  }));
}

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

/** Running tally of what the assistant has used on the Anthropic account, per day. */
export function addUsage(kind: string, u: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined) {
  if (!u) return;
  const key = `usage:${new Date().toISOString().slice(0, 10)}`;
  const cur = JSON.parse(getSetting(key) || "{}") as Record<string, number>;
  cur.calls = (cur.calls ?? 0) + 1;
  cur[`${kind}_calls`] = (cur[`${kind}_calls`] ?? 0) + 1;
  cur.input_tokens = (cur.input_tokens ?? 0) + (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  cur.output_tokens = (cur.output_tokens ?? 0) + (u.output_tokens ?? 0);
  setSetting(key, JSON.stringify(cur));
}
export const usageByDay = (days = 14) =>
  rows<{ key: string; value: string }>("SELECT key, value FROM agent_settings WHERE key LIKE 'usage:%' ORDER BY key DESC LIMIT ?", days)
    .map((r) => ({ day: r.key.slice(6), ...(JSON.parse(r.value) as Record<string, number>) }));

export const stats = () => ({
  jobs: row<{ n: number }>("SELECT count(*) AS n FROM agent_jobs")?.n ?? 0,
  messages: row<{ n: number }>("SELECT count(*) AS n FROM agent_messages")?.n ?? 0,
  unprocessed: row<{ n: number }>("SELECT count(*) AS n FROM agent_messages WHERE processed_at IS NULL AND attempts < 3")?.n ?? 0,
  failed: row<{ n: number }>("SELECT count(*) AS n FROM agent_messages WHERE error IS NOT NULL")?.n ?? 0,
  current_jobs: row<{ n: number }>(`SELECT count(*) AS n FROM agent_jobs j WHERE ${CURRENT_JOB}`)?.n ?? 0,
  current_open_items: row<{ n: number }>(`SELECT count(*) AS n FROM agent_items i JOIN agent_jobs j ON j.id = i.job_id WHERE i.status = 'open' AND ${CURRENT_JOB} AND ${FRESH_ITEM}`)?.n ?? 0,
  open_items: row<{ n: number }>("SELECT count(*) AS n FROM agent_items WHERE status = 'open'")?.n ?? 0,
  last_digest: getSetting("last_digest"),
});
