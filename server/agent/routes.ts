import express, { type Express, type Request, type Response } from "express";
import { Webhook } from "svix";
import { safeEqual } from "../auth";
import { digestHtml, sendDigest, startSchedule } from "./digest";
import { agentmailConfigured, aiPause, aiReady, fetchFromAgentMail, ingest, processPending } from "./ingest";
import { authUrl, completeConnect, connectKey, connectUrl, gmailStatus, googleConfigured, startGmail, validState } from "./gmail";
import { brief } from "./brief";
import { jobsNeedingTidy, stats, usageByDay } from "./store";
import { findDuplicates, tidyJob, tidyPending, tidyRunning } from "./tidy";

// HTTP side of the inbox assistant:
//   POST /agent/webhook   AgentMail calls this for every email that lands in the assistant's inbox
//   POST /agent/ingest    hand it an email directly (tests, and backfilling old threads from a script)
//   GET  /agent/status    counts, for a quick health check
//   POST /agent/digest    send today's digest now;  GET /agent/digest  preview it
// Everything but the webhook needs  Authorization: Bearer <ADMIN_TOKEN>.

const adminOnly = (req: Request, res: Response, next: () => void) => {
  const t = process.env.ADMIN_TOKEN;
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || String(req.query.token || "");
  if (!t || !got || !safeEqual(got, t)) return res.status(401).json({ error: "unauthorized" });
  next();
};

const page = (title: string, body: string, ok = true) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} | Shift 4 Projects</title>
<style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#0a0a0b;color:#f2f0eb;font-family:Helvetica,Arial,sans-serif;padding:24px}main{max-width:460px}h1{font-size:34px;margin:0 0 14px;letter-spacing:-.01em}p{color:#a9a6a0;line-height:1.55}b{color:#f2f0eb}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:${ok ? "#4ade80" : "#f87171"};margin-right:10px}</style></head>
<body><main><h1><span class="dot"></span>${title}</h1>${body}</main></body></html>`;
const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function mountAgent(app: Express) {
  const enabled = aiReady();
  if (!enabled) { console.warn("[agent] ANTHROPIC_API_KEY not set; email is stored but not read yet"); }

  // Gmail: the links Will clicks. /connect checks the signed key, then sends him to Google's Allow screen.
  app.get("/agent/google/connect", (req, res) => {
    if (!googleConfigured()) return res.status(503).type("html").send(page("Not set up yet", "<p>The Google connection isn't configured on the site yet.</p>", false));
    if (String(req.query.k || "") !== connectKey()) return res.status(404).type("html").send(page("Link not valid", "<p>Ask Bobby for a fresh link.</p>", false));
    res.redirect(authUrl(typeof req.query.hint === "string" ? req.query.hint : undefined));
  });
  app.get("/agent/google/callback", async (req, res) => {
    const fail = (msg: string) => res.status(400).type("html").send(page("Didn't connect", `<p>${escHtml(msg)}</p><p>Nothing was changed. Try the link again, or send Bobby a screenshot.</p>`, false));
    if (req.query.error) return fail(req.query.error === "access_denied" ? "Access wasn't allowed." : String(req.query.error));
    if (!validState(String(req.query.state || ""))) return fail("This sign-in expired. Open the link again.");
    try {
      const email = await completeConnect(String(req.query.code || ""));
      res.type("html").send(page("Connected", `<p><b>${escHtml(email)}</b> is connected to your Shift 4 assistant. It can read mail but can never send, delete or change anything.</p><p>It's now reading your recent history and will keep up with new mail every few minutes. You can close this tab.</p>`));
    } catch (e) { fail((e as Error).message); }
  });
  app.get("/agent/google/links", adminOnly, (_req, res) => res.json({
    configured: googleConfigured(), redirect_uri: `${(process.env.SITE_URL || "").replace(/\/$/, "")}/agent/google/callback`,
    will: connectUrl("will@shift4projects.com"), office: connectUrl("office@shift4projects.com"), any: connectUrl(),
  }));
  startGmail(ingest);

  // Raw body: Svix signs the exact bytes, so this route must see them before any JSON parsing.
  app.post("/agent/webhook", express.raw({ type: "*/*", limit: "2mb" }), async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    let event: { event_type?: string; event_id?: string; message?: { message_id?: string; inbox_id?: string } };
    try {
      const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
      if (secret) {
        event = new Webhook(secret).verify(raw, req.headers as Record<string, string>) as unknown as typeof event;
      } else {
        // No signing secret yet: fall back to a token in the URL (?token=AGENT_WEBHOOK_TOKEN).
        const t = process.env.AGENT_WEBHOOK_TOKEN;
        if (!t || !safeEqual(String(req.query.token || ""), t)) return res.status(401).json({ error: "unauthorized" });
        event = JSON.parse(raw);
      }
    } catch (e) {
      return res.status(400).json({ error: `bad webhook: ${(e as Error).message}` });
    }
    // Answer right away; AgentMail retries on anything slow or non-2xx.
    res.json({ ok: true });
    if (event.event_type !== "message.received" || !event.message?.message_id) return;
    if (event.message.inbox_id && process.env.AGENTMAIL_INBOX_ID && event.message.inbox_id !== process.env.AGENTMAIL_INBOX_ID) return;
    if (!agentmailConfigured()) return console.warn("[agent] webhook received but AGENTMAIL_API_KEY / INBOX_ID not set");
    try {
      const m = await fetchFromAgentMail(event.message.message_id);
      await ingest(m);
    } catch (e) { console.error("[agent] webhook ingest failed", e); }
  });

  const json = express.json({ limit: "5mb" });

  app.post("/agent/ingest", adminOnly, json, async (req, res) => {
    const b = req.body ?? {};
    if (!b.message_id || !b.sender || typeof b.body !== "string") return res.status(400).json({ error: "message_id, sender and body are required" });
    try {
      const added = await ingest({
        message_id: String(b.message_id), thread_id: b.thread_id ? String(b.thread_id) : undefined, sender: String(b.sender),
        recipients: Array.isArray(b.recipients) ? b.recipients.map(String) : [], subject: b.subject ? String(b.subject) : "",
        sent_at: b.sent_at ? String(b.sent_at) : undefined, body: b.body, attachments: Array.isArray(b.attachments) ? b.attachments : [],
        attachments_text: typeof b.attachments_text === "string" ? b.attachments_text : "",
      });
      res.json({ ok: true, added });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.get("/agent/status", adminOnly, (_req, res) => res.json({ enabled, agentmail: agentmailConfigured(), google: googleConfigured(), inboxes: gmailStatus(), paused: aiPause(), tidy: { running: tidyRunning(), jobs_waiting: jobsNeedingTidy().length }, ...stats() }));
  app.get("/agent/brief", adminOnly, (_req, res) => res.json(brief()));
  app.get("/agent/usage", adminOnly, (_req, res) => res.json(usageByDay(30)));
  // Tidy one job (?job=12, waits for it) or everything with new email (returns at once, runs in the background).
  app.post("/agent/tidy", adminOnly, async (req, res) => {
    try {
      if (req.query.job) return res.json(await tidyJob(Number(req.query.job)));
      const waiting = jobsNeedingTidy().length;
      if (!tidyRunning()) tidyPending().catch((e) => console.error("[agent] tidy", e));
      res.json({ started: true, jobs_to_tidy: waiting });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.get("/agent/duplicates", adminOnly, async (_req, res) => { try { res.json(await findDuplicates()); } catch (e) { res.status(500).json({ error: (e as Error).message }); } });
  app.post("/agent/retry", adminOnly, async (_req, res) => res.json({ retried: await processPending() }));
  app.get("/agent/digest", adminOnly, (_req, res) => { const d = digestHtml(); d ? res.type("html").send(d.html) : res.type("text").send("Nothing to report."); });
  app.post("/agent/digest", adminOnly, async (_req, res) => res.json({ result: await sendDigest(true) }));

  if (enabled) { startSchedule(processPending, () => (aiPause() ? Promise.resolve() : tidyPending())); setTimeout(() => processPending().catch((e) => console.error("[agent] backlog", e)), 5000).unref(); }
  console.log(`[agent] inbox assistant ${enabled ? "ready" : "storing only (no AI key)"}; Gmail ${googleConfigured() ? `on (${gmailStatus().length} inbox${gmailStatus().length === 1 ? "" : "es"})` : "not configured"}`);
}
