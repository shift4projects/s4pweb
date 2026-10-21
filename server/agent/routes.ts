import express, { type Express, type Request, type Response } from "express";
import { Webhook } from "svix";
import { safeEqual } from "../auth";
import { digestHtml, sendDigest, startSchedule } from "./digest";
import { agentmailConfigured, fetchFromAgentMail, ingest, processPending } from "./ingest";
import { stats } from "./store";

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

export function mountAgent(app: Express) {
  const enabled = !!process.env.ANTHROPIC_API_KEY || process.env.AGENT_MODEL === "stub";
  if (!enabled) { console.warn("[agent] ANTHROPIC_API_KEY not set; inbox assistant idle"); }

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

  app.get("/agent/status", adminOnly, (_req, res) => res.json({ enabled, agentmail: agentmailConfigured(), ...stats() }));
  app.post("/agent/retry", adminOnly, async (_req, res) => res.json({ retried: await processPending() }));
  app.get("/agent/digest", adminOnly, (_req, res) => { const d = digestHtml(); d ? res.type("html").send(d.html) : res.type("text").send("Nothing to report."); });
  app.post("/agent/digest", adminOnly, async (_req, res) => res.json({ result: await sendDigest(true) }));

  if (enabled) startSchedule(processPending);
  console.log(`[agent] inbox assistant ${enabled ? "ready" : "idle"} (${agentmailConfigured() ? "AgentMail connected" : "no AgentMail yet"})`);
}
