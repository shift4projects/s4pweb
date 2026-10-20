import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// Built-in SQLite: no Supabase, no extra service. One file on disk (a Railway volume in prod).
export const dataDir = path.resolve(process.env.DATA_DIR || "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "shift4.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT,
    phone TEXT,
    services TEXT,
    event_date TEXT,
    city TEXT,
    message TEXT NOT NULL,
    ip TEXT,
    emailed INTEGER NOT NULL DEFAULT 0
  );
`);

export type Lead = {
  name: string; email: string; company?: string; phone?: string; services?: string;
  event_date?: string; city?: string; message: string; ip?: string;
};

const insert = db.prepare(
  `INSERT INTO leads (name, email, company, phone, services, event_date, city, message, ip)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

export function saveLead(l: Lead): number {
  const r = insert.run(l.name, l.email, l.company ?? null, l.phone ?? null, l.services ?? null, l.event_date ?? null, l.city ?? null, l.message, l.ip ?? null);
  return Number(r.lastInsertRowid);
}

// Added after launch of the concept: whether the inquirer got the branded auto-reply.
if (!(db.prepare("PRAGMA table_info(leads)").all() as { name: string }[]).some((c) => c.name === "auto_replied")) {
  db.exec("ALTER TABLE leads ADD COLUMN auto_replied INTEGER NOT NULL DEFAULT 0");
}

export const markEmailed = (id: number) => db.prepare("UPDATE leads SET emailed = 1 WHERE id = ?").run(id);
export const markAutoReplied = (id: number) => db.prepare("UPDATE leads SET auto_replied = 1 WHERE id = ?").run(id);
/** True if this address already got an auto-reply in the last 24 hours (stops the form being used to spam someone). */
export const recentlyAutoReplied = (email: string) =>
  !!db.prepare("SELECT 1 FROM leads WHERE lower(email) = lower(?) AND auto_replied = 1 AND created_at > datetime('now', '-1 day') LIMIT 1").get(email);
export const allLeads = () => db.prepare("SELECT * FROM leads ORDER BY id DESC").all() as Record<string, unknown>[];

export function leadsCsv(): string {
  const rows = allLeads();
  const cols = rows[0] ? Object.keys(rows[0]) : ["id", "created_at", "name", "email", "company", "phone", "services", "event_date", "city", "message"];
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n");
}
