import crypto from "node:crypto";
import { db } from "../db";
import type { IncomingMessage } from "./store";

// Read-only Gmail connection for Shift 4's own inboxes (will@, office@ and its aliases).
// Each inbox is connected once by its owner clicking Allow on Google's screen (scope gmail.readonly:
// it can never send, delete or change mail). After that this module:
//   - backfills history (BACKFILL_DAYS, newest skipped categories/newsletters), oldest first
//   - picks up new mail every few minutes through Gmail's history feed
// and hands each email to ingest() like any other source.

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
// GOOGLE_API_BASE / GOOGLE_OAUTH_BASE only exist so the flow can be tested against a local fake.
const G = `${process.env.GOOGLE_API_BASE || "https://gmail.googleapis.com"}/gmail/v1/users/me`;
const TOKEN_URL = `${process.env.GOOGLE_OAUTH_BASE || "https://oauth2.googleapis.com"}/token`;
const SITE = () => (process.env.SITE_URL || "https://shift4projects.com").replace(/\/$/, "");
export const redirectUri = () => process.env.GOOGLE_REDIRECT_URI || `${SITE()}/agent/google/callback`;
const domain = () => (process.env.GOOGLE_ALLOWED_DOMAIN || "shift4projects.com").toLowerCase();
export const googleConfigured = () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_mailboxes (
    email TEXT PRIMARY KEY,
    refresh_token TEXT NOT NULL,
    history_id TEXT,                         -- where the new-mail feed resumes
    backfill_after TEXT,                     -- YYYY/MM/DD lower bound for history
    backfill_page TEXT,                      -- Gmail page token, so a restart resumes the listing
    backfill_listed INTEGER NOT NULL DEFAULT 0,
    backfill_done INTEGER NOT NULL DEFAULT 0,
    connected_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_sync_at TEXT,
    error TEXT
  );
  CREATE TABLE IF NOT EXISTS agent_gmail_seen (
    mailbox TEXT NOT NULL,
    gmail_id TEXT NOT NULL,
    internal_date INTEGER,
    state TEXT NOT NULL DEFAULT 'queued',    -- queued | ingested | skipped | failed
    reason TEXT,
    PRIMARY KEY (mailbox, gmail_id)
  );
  CREATE INDEX IF NOT EXISTS agent_gmail_queue ON agent_gmail_seen(state, internal_date);
`);

type Mailbox = { email: string; refresh_token: string; history_id: string | null; backfill_after: string | null; backfill_page: string | null; backfill_listed: number; backfill_done: number; connected_at: string; last_sync_at: string | null; error: string | null };
export const mailboxes = () => db.prepare("SELECT * FROM agent_mailboxes ORDER BY connected_at").all() as Mailbox[];

/* ---------- connect links (signed, so only links we hand out start the flow) ---------- */

const sign = (s: string) => crypto.createHmac("sha256", process.env.ADMIN_TOKEN || process.env.GOOGLE_CLIENT_SECRET || "dev").update(s).digest("base64url").slice(0, 32);
export const connectKey = () => sign("google-connect");
export const connectUrl = (hint?: string) => `${SITE()}/agent/google/connect?k=${connectKey()}${hint ? `&hint=${encodeURIComponent(hint)}` : ""}`;

export function authUrl(hint?: string) {
  const ts = String(Date.now());
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(), response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent select_account", include_granted_scopes: "true", hd: domain(), state: `${ts}.${sign(`state:${ts}`)}`,
    ...(hint ? { login_hint: hint } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
export function validState(state: string) {
  const [ts, sig] = state.split(".");
  return !!ts && !!sig && sig === sign(`state:${ts}`) && Date.now() - Number(ts) < 30 * 60_000;
}

/** Exchanges the code from Google for a refresh token and records the inbox. */
export async function completeConnect(code: string): Promise<string> {
  const r = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(), grant_type: "authorization_code" }),
  });
  const t = await r.json() as { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!r.ok || !t.access_token) throw new Error(t.error_description || t.error || `token exchange failed (${r.status})`);
  if (!t.scope?.includes("gmail.readonly")) throw new Error("Gmail permission wasn't granted. Please try again and leave the box checked.");
  const prof = await (await fetch(`${G}/profile`, { headers: { Authorization: `Bearer ${t.access_token}` } })).json() as { emailAddress?: string; historyId?: string };
  const email = (prof.emailAddress || "").toLowerCase();
  if (!email.endsWith(`@${domain()}`)) throw new Error(`Only @${domain()} inboxes can be connected.`);
  const existing = db.prepare("SELECT refresh_token FROM agent_mailboxes WHERE email = ?").get(email) as { refresh_token: string } | undefined;
  const refresh = t.refresh_token || existing?.refresh_token;
  if (!refresh) throw new Error("Google didn't return a long-lived token. Remove the app at myaccount.google.com/permissions and try the link again.");
  const days = Number(process.env.BACKFILL_DAYS ?? 365);
  const after = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10).replace(/-/g, "/");
  db.prepare(`INSERT INTO agent_mailboxes (email, refresh_token, history_id, backfill_after) VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET refresh_token = excluded.refresh_token, error = NULL`).run(email, refresh, prof.historyId ?? null, after);
  tokens.delete(email);
  kick();
  return email;
}

/* ---------- Gmail API ---------- */

const tokens = new Map<string, { token: string; until: number }>();
async function accessToken(m: Mailbox): Promise<string> {
  const hit = tokens.get(m.email);
  if (hit && hit.until > Date.now() + 60_000) return hit.token;
  const r = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: m.refresh_token, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, grant_type: "refresh_token" }),
  });
  const t = await r.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !t.access_token) {
    const msg = t.error === "invalid_grant" ? "Access was removed or expired. Send the connect link again." : (t.error_description || t.error || `refresh failed (${r.status})`);
    db.prepare("UPDATE agent_mailboxes SET error = ? WHERE email = ?").run(msg, m.email);
    throw new Error(msg);
  }
  tokens.set(m.email, { token: t.access_token, until: Date.now() + (t.expires_in ?? 3600) * 1000 });
  return t.access_token;
}

async function gget<T>(m: Mailbox, path: string, params: Record<string, string> = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${G}${path}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ""}`, { headers: { Authorization: `Bearer ${await accessToken(m)}` } });
    if (r.status === 429 || r.status >= 500) { if (attempt < 4) { await new Promise((s) => setTimeout(s, 2000 * 2 ** attempt)); continue; } }
    if (!r.ok) { const e = new Error(`Gmail ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`) as Error & { status?: number }; e.status = r.status; throw e; }
    return r.json() as Promise<T>;
  }
}

type Part = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[] };
type GMessage = { id: string; threadId: string; labelIds?: string[]; internalDate?: string; payload?: Part };

const SKIP_LABELS = ["SPAM", "TRASH", "DRAFT", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];
const decode = (s?: string) => (s ? Buffer.from(s, "base64url").toString("utf8") : "");
const stripHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();

function walk(p: Part | undefined, out: Part[] = []): Part[] { if (!p) return out; out.push(p); for (const c of p.parts ?? []) walk(c, out); return out; }

/** Why a message isn't worth reading, or null if it is. */
function skipReason(msg: GMessage, h: (n: string) => string): string | null {
  const labels = msg.labelIds ?? [];
  const bad = labels.find((l) => SKIP_LABELS.includes(l));
  if (bad) return bad.toLowerCase();
  if (h("list-unsubscribe") || h("list-id")) return "newsletter";
  if (/^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster)@/i.test((h("from").match(/<([^>]+)>/)?.[1] || h("from")).trim())) return "automated";
  return null;
}

/** Turns a Gmail message into the assistant's input, or a skip reason. */
async function toIncoming(m: Mailbox, id: string): Promise<IncomingMessage | { skip: string }> {
  const msg = await gget<GMessage>(m, `/messages/${id}`, { format: "full" });
  const hs = msg.payload?.headers ?? [];
  const h = (n: string) => hs.find((x) => x.name.toLowerCase() === n)?.value ?? "";
  const why = skipReason(msg, h);
  if (why) return { skip: why };
  const parts = walk(msg.payload);
  const plain = parts.find((p) => p.mimeType === "text/plain" && !p.filename && p.body?.data);
  const html = parts.find((p) => p.mimeType === "text/html" && !p.filename && p.body?.data);
  const body = plain ? decode(plain.body!.data) : stripHtml(decode(html?.body?.data));
  const files = parts.filter((p) => p.filename && p.body?.attachmentId);
  const attachments = files.map((p) => ({ filename: p.filename, content_type: p.mimeType, size: p.body?.size }));
  // PDFs (quotes, invoices, riders, floor plans) go to the model as documents: up to 3, each under 4 MB.
  const pdfs: { name: string; data: string }[] = [];
  for (const p of files.filter((f) => f.mimeType === "application/pdf" && (f.body?.size ?? 0) < 4_000_000).slice(0, 3)) {
    try {
      const a = await gget<{ data: string }>(m, `/messages/${id}/attachments/${p.body!.attachmentId}`);
      pdfs.push({ name: p.filename!, data: Buffer.from(a.data, "base64url").toString("base64") });
    } catch (e) { console.warn("[gmail] attachment", p.filename, (e as Error).message); }
  }
  const date = h("date") ? new Date(h("date")) : new Date(Number(msg.internalDate || Date.now()));
  return {
    message_id: (h("message-id") || `<${msg.id}@gmail>`).trim(), thread_id: `${m.email}:${msg.threadId}`, mailbox: m.email,
    sender: h("from"), recipients: [h("to"), h("cc"), h("delivered-to")].filter(Boolean).join(", ").split(/,\s*/).filter(Boolean),
    subject: h("subject"), sent_at: isNaN(date.getTime()) ? undefined : date.toISOString(), body: body.slice(0, 60000), attachments, pdfs,
  };
}

/* ---------- sync loop ---------- */

const queue = (mailbox: string, ids: { id: string; at?: number }[]) => {
  const ins = db.prepare("INSERT OR IGNORE INTO agent_gmail_seen (mailbox, gmail_id, internal_date) VALUES (?, ?, ?)");
  for (const x of ids) ins.run(mailbox, x.id, x.at ?? null);
};

/** Lists one page of history for the backfill (newest pages first; processing is sorted oldest first). */
async function backfillPage(m: Mailbox) {
  const q = `after:${m.backfill_after} -in:chats -category:promotions -category:social -category:forums`;
  const r = await gget<{ messages?: { id: string }[]; nextPageToken?: string }>(m, "/messages", { q, maxResults: "500", ...(m.backfill_page ? { pageToken: m.backfill_page } : {}) });
  const ids = r.messages ?? [];
  queue(m.email, ids.map((x) => ({ id: x.id })));
  const max = Number(process.env.BACKFILL_MAX ?? 4000);
  const listed = m.backfill_listed + ids.length;
  const done = !r.nextPageToken || listed >= max;
  db.prepare("UPDATE agent_mailboxes SET backfill_page = ?, backfill_listed = ?, backfill_done = ? WHERE email = ?").run(done ? null : (r.nextPageToken ?? null), listed, done ? 1 : 0, m.email);
  console.log(`[gmail] ${m.email}: listed ${listed} for backfill${done ? " (done listing)" : ""}`);
}

/** New mail since the last check, via Gmail's history feed. */
async function newMail(m: Mailbox) {
  if (!m.history_id) {
    const prof = await gget<{ historyId: string }>(m, "/profile");
    db.prepare("UPDATE agent_mailboxes SET history_id = ? WHERE email = ?").run(prof.historyId, m.email);
    return;
  }
  let page: string | undefined; let latest: string = m.history_id;
  try {
    do {
      const r = await gget<{ history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]; historyId?: string; nextPageToken?: string }>(m, "/history",
        { startHistoryId: m.history_id, historyTypes: "messageAdded", maxResults: "500", ...(page ? { pageToken: page } : {}) });
      const ids = (r.history ?? []).flatMap((x) => x.messagesAdded ?? []).map((x) => x.message).filter((x) => !(x.labelIds ?? []).some((l) => SKIP_LABELS.includes(l)));
      queue(m.email, ids.map((x) => ({ id: x.id, at: Date.now() })));
      if (r.historyId) latest = r.historyId;
      page = r.nextPageToken;
    } while (page);
  } catch (e) {
    // History ids expire after about a week offline: fall back to a dated search for anything missed.
    if ((e as { status?: number }).status === 404) {
      const since = new Date(Date.now() - 8 * 86400_000).toISOString().slice(0, 10).replace(/-/g, "/");
      const r = await gget<{ messages?: { id: string }[] }>(m, "/messages", { q: `after:${since}`, maxResults: "500" });
      queue(m.email, (r.messages ?? []).map((x) => ({ id: x.id, at: Date.now() })));
      latest = (await gget<{ historyId: string }>(m, "/profile")).historyId;
    } else throw e;
  }
  db.prepare("UPDATE agent_mailboxes SET history_id = ?, last_sync_at = datetime('now'), error = NULL WHERE email = ?").run(latest, m.email);
}

/** Fetches queued messages (oldest first) and hands them to ingest. */
async function drain(ingest: (m: IncomingMessage) => Promise<boolean>, budget = 60) {
  const rows = db.prepare(`SELECT s.mailbox, s.gmail_id FROM agent_gmail_seen s WHERE s.state = 'queued' ORDER BY COALESCE(s.internal_date, 0), s.rowid DESC LIMIT ?`).all(budget) as { mailbox: string; gmail_id: string }[];
  const boxes = new Map(mailboxes().map((b) => [b.email, b]));
  for (const r of rows) {
    const m = boxes.get(r.mailbox); if (!m) continue;
    const mark = (state: string, reason: string | null) => db.prepare("UPDATE agent_gmail_seen SET state = ?, reason = ? WHERE mailbox = ? AND gmail_id = ?").run(state, reason, r.mailbox, r.gmail_id);
    try {
      const x = await toIncoming(m, r.gmail_id);
      if ("skip" in x) { mark("skipped", x.skip); continue; }
      await ingest(x);
      mark("ingested", null);
    } catch (e) { mark("failed", (e as Error).message.slice(0, 300)); console.warn("[gmail] fetch failed", r.gmail_id, (e as Error).message); }
  }
  return rows.length;
}

/** Backfill listings need internal dates to sort oldest first; fetch them cheaply in small batches. */
async function dateQueued(budget = 200) {
  const rows = db.prepare("SELECT mailbox, gmail_id FROM agent_gmail_seen WHERE state = 'queued' AND internal_date IS NULL LIMIT ?").all(budget) as { mailbox: string; gmail_id: string }[];
  const boxes = new Map(mailboxes().map((b) => [b.email, b]));
  for (const r of rows) {
    const m = boxes.get(r.mailbox); if (!m) continue;
    try {
      const x = await gget<{ internalDate?: string }>(m, `/messages/${r.gmail_id}`, { format: "minimal" });
      db.prepare("UPDATE agent_gmail_seen SET internal_date = ? WHERE mailbox = ? AND gmail_id = ?").run(Number(x.internalDate || 0), r.mailbox, r.gmail_id);
    } catch { db.prepare("UPDATE agent_gmail_seen SET internal_date = 0 WHERE mailbox = ? AND gmail_id = ?").run(r.mailbox, r.gmail_id); }
  }
  return rows.length;
}

let running = false;
let ingestFn: ((m: IncomingMessage) => Promise<boolean>) | null = null;
async function tick() {
  if (running || !ingestFn || !googleConfigured()) return;
  running = true;
  try {
    for (const m of mailboxes()) {
      if (m.error?.startsWith("Access was removed")) continue;
      try {
        if (!m.backfill_done) await backfillPage(m);
        await newMail(m);
      } catch (e) { db.prepare("UPDATE agent_mailboxes SET error = ? WHERE email = ?").run((e as Error).message.slice(0, 300), m.email); console.warn("[gmail]", m.email, (e as Error).message); }
    }
    // Only start reading once every listing is dated, so the oldest emails really go first.
    while (await dateQueued() > 0) { /* keep dating */ }
    // Until there's an AI key, just keep the list: emails (and their PDFs) are downloaded when they can be read.
    if (process.env.ANTHROPIC_API_KEY || process.env.AGENT_MODEL === "stub") await drain(ingestFn);
  } finally { running = false; }
}
let timer: NodeJS.Timeout | null = null;
const kick = () => { setTimeout(() => tick().catch((e) => console.error("[gmail] tick", e)), 500); };

export function startGmail(ingest: (m: IncomingMessage) => Promise<boolean>) {
  ingestFn = ingest;
  if (!googleConfigured() || timer) return;
  timer = setInterval(() => tick().catch((e) => console.error("[gmail] tick", e)), Number(process.env.GMAIL_POLL_SECONDS ?? 180) * 1000);
  timer.unref();
  kick();
}

export function gmailStatus() {
  const counts = db.prepare("SELECT mailbox, state, count(*) AS n FROM agent_gmail_seen GROUP BY mailbox, state").all() as { mailbox: string; state: string; n: number }[];
  return mailboxes().map((m) => ({
    email: m.email, connected_at: m.connected_at, last_sync_at: m.last_sync_at, error: m.error, history_since: m.backfill_after,
    backfill: m.backfill_done ? "listed" : `listing (${m.backfill_listed} so far)`,
    emails: Object.fromEntries(counts.filter((c) => c.mailbox === m.email).map((c) => [c.state, c.n])),
  }));
}

/** Disconnects an inbox here (the owner can also remove access at myaccount.google.com/permissions). */
export function disconnect(email: string) {
  db.prepare("DELETE FROM agent_mailboxes WHERE email = ?").run(email.toLowerCase());
  tokens.delete(email.toLowerCase());
}
