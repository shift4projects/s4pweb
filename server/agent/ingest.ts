import { AgentMailClient } from "agentmail";
import { extract } from "./extract";
import {
  addItem, closeItem, createJob, getJob, getMessage, hasMessage, itemsForJob, listJobs, markFailed, markProcessed,
  messagesInThread, saveMessage, touchContact, unprocessedMessages, updateJob, type IncomingMessage,
} from "./store";

// Turns an email into project memory: save it, ask Claude what it means, update the job, items and contacts.
// Processing is serialized so two webhooks for the same thread never race each other.

const internalDomains = () => (process.env.AGENT_INTERNAL_DOMAINS || "shift4projects.com").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
const addr = (s: string) => (s.match(/<([^>]+)>/)?.[1] || s).trim().toLowerCase();
export const directionOf = (sender: string) => (internalDomains().some((d) => addr(sender).endsWith(`@${d}`)) ? "internal" : "external");

let mail: AgentMailClient | null = null;
const agentmail = () => (mail ??= new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY! }));
export const agentmailConfigured = () => !!process.env.AGENTMAIL_API_KEY && !!process.env.AGENTMAIL_INBOX_ID;

/** Pulls the full message (and the text of any readable attachments) from AgentMail. */
export async function fetchFromAgentMail(messageId: string): Promise<IncomingMessage & { attachments_text: string }> {
  const inbox = process.env.AGENTMAIL_INBOX_ID!;
  const m = await agentmail().inboxes.messages.get(inbox, messageId);
  const parts: string[] = [];
  const attachments = [];
  for (const a of m.attachments ?? []) {
    attachments.push({ filename: a.filename, content_type: a.contentType, size: a.size });
    if (a.contentDisposition === "inline") continue;
    try {
      const r = await agentmail().inboxes.messages.getAttachment(inbox, messageId, a.attachmentId);
      if (r.textUrl) {
        const t = await (await fetch(r.textUrl)).text();
        if (t.trim()) parts.push(`--- ${a.filename ?? a.attachmentId} ---\n${t.slice(0, 6000)}`);
      }
    } catch (e) { console.warn("[agent] attachment text failed", a.filename, (e as Error).message); }
  }
  return {
    message_id: m.messageId, thread_id: m.threadId, sender: m.from, recipients: [...(m.to ?? []), ...(m.cc ?? [])],
    subject: m.subject ?? "", sent_at: new Date(m.timestamp).toISOString(),
    // The full body (with quoted history) is what Claude reads; earlier thread messages are summarized separately.
    body: m.text || m.extractedText || stripHtml(m.html ?? ""), attachments, attachments_text: parts.join("\n\n"),
  };
}

const stripHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();

/** Save an email (from AgentMail or handed to us directly) and process it. Returns false if we already had it. */
export async function ingest(m: IncomingMessage & { attachments_text?: string }): Promise<boolean> {
  if (hasMessage(m.message_id)) return false;
  saveMessage(m, directionOf(m.sender));
  await processOne(m.message_id, m.attachments_text ?? "");
  return true;
}

let chain: Promise<unknown> = Promise.resolve();
/** Runs the extraction for one stored message, one at a time. */
export function processOne(messageId: string, attachmentsText = ""): Promise<void> {
  const run = async () => {
    const m = getMessage(messageId);
    if (!m || m.processed_at) return;
    try {
      const jobs = listJobs();
      // Best guess at the job from the thread so Claude sees the right open items.
      const earlier = m.thread_id ? messagesInThread(m.thread_id).filter((x) => x.message_id !== m.message_id) : [];
      const likely = earlier.find((x) => x.job_id)?.job_id ?? null;
      const open = likely ? itemsForJob(likely, "open") : jobs.flatMap((j) => itemsForJob(j.id, "open")).slice(0, 40);
      const x = await extract({
        sender: m.sender, recipients: m.recipients ?? "", subject: m.subject ?? "", sent_at: m.sent_at ?? m.received_at,
        body: m.body ?? "", attachments_text: attachmentsText, direction: m.direction, jobs, open_items: open,
        thread_context: earlier.map((e) => `- ${e.sent_at?.slice(0, 10)} ${e.sender}: ${e.summary ?? e.subject}`).join("\n"),
      });

      let jobId: number | null = null;
      if (x.job) {
        const existing = x.job.match_id != null ? getJob(x.job.match_id) : undefined;
        if (existing) {
          jobId = existing.id;
          updateJob(existing.id, {
            client: x.job.client ?? undefined, event_date: x.job.event_date ?? undefined, venue: x.job.venue ?? undefined,
            status: x.job.status ?? undefined, summary: x.job.summary ?? undefined,
          });
        } else {
          jobId = createJob({ name: x.job.name, client: x.job.client, event_date: x.job.event_date, venue: x.job.venue, status: x.job.status ?? (x.category === "inquiry" ? "inquiry" : "active"), summary: x.job.summary }).id;
        }
        for (const it of x.items) addItem({ job_id: jobId, type: it.type, text: it.text, owner: it.owner, due: it.due, source_message_id: m.message_id });
        for (const id of x.resolves) { try { closeItem(id); } catch { /* unknown id from the model */ } }
      }
      for (const c of x.contacts) if (c.email.includes("@")) touchContact(c);
      markProcessed(m.message_id, { job_id: jobId, category: x.category, summary: x.summary });
      console.log(`[agent] ${m.message_id} -> job ${jobId ?? "none"} (${x.category}), ${x.items.length} items`);
    } catch (e) {
      console.error("[agent] failed", messageId, e);
      markFailed(messageId, (e as Error).message);
    }
  };
  chain = chain.then(run, run);
  return chain as Promise<void>;
}

/** Retries anything that failed earlier (bad network, API hiccup). Called on a timer. */
export async function processPending(): Promise<number> {
  const pending = unprocessedMessages();
  for (const m of pending) await processOne(m.message_id);
  return pending.length;
}
