import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  addUsage, allJobs, closeItem, getJob, itemsForJob, jobsNeedingTidy, markTidied, timelineForJob, updateJob, type Invoice, type Job,
} from "./store";

// The tidy pass. Reading one email at a time leaves loose ends: a question that was answered three emails later
// stays open, the job summary reflects only the last email, and a job that happened months ago still says "active".
// Here Claude re-reads a whole job at once (every email summary, in order) and squares it up:
// closes what's been dealt with, rewrites the summary, sets the status, and lists the invoices mentioned.

const TidySchema = z.object({
  summary: z.string().describe("Where the job stands today, two or three plain sentences: what it is, what happened, what's still pending"),
  status: z.enum(["inquiry", "quoting", "active", "done", "lost"]),
  client: z.string().nullable().describe("The end client or agency, only if the emails make it clear; null to leave as is"),
  event_date: z.string().nullable().describe("YYYY-MM-DD (or YYYY-MM) only if stated in the emails; null to leave as is"),
  venue: z.string().nullable().describe("Only if stated in the emails; null to leave as is"),
  close: z.array(z.object({
    id: z.number(),
    why: z.enum(["answered", "done", "obsolete", "duplicate"]),
  })).describe("Open items that no longer need attention"),
  invoices: z.array(z.object({
    number: z.string().nullable().describe("Invoice or estimate-turned-invoice number as written, null if none given"),
    party: z.string().describe("Who it's with: the client being billed, or the vendor billing Shift 4"),
    direction: z.enum(["receivable", "payable"]).describe("receivable = money owed TO Shift 4; payable = money Shift 4 owes a vendor or crew"),
    amount: z.string().nullable().describe("Exactly as written in the email, e.g. \"$4,500.00\"; null if no amount is stated"),
    status: z.enum(["sent", "paid", "overdue", "disputed", "unknown"]),
    due: z.string().nullable().describe("YYYY-MM-DD if a due date is stated"),
    note: z.string().nullable().describe("One short line of context, e.g. \"deposit, balance still to come\""),
  })).describe("Invoices and bills for this job that the emails mention. Estimates and quotes are not invoices."),
});
type Tidy = z.infer<typeof TidySchema>;

const SYSTEM = `You keep the project memory for Shift 4 Projects, an event technology and production company in Los Angeles. You are given one job: its details, its open items, and a summary of every email on it in date order. Square the record up against what actually happened.

Rules:
- Use only what the email summaries and items say. Never invent amounts, dates, names or outcomes. When something is unclear, leave it as it is.
- Close an item when a later email answers it, completes it or replaces it ("answered" / "done"), when it repeats another open item ("duplicate"), or when it can no longer matter because the event is over ("obsolete": load-in times, gear lists, site visits, creative approvals for a past event).
- Never close an item about money that is still unsettled (an unpaid invoice, a deposit not received, a disputed amount, a vendor bill not paid), or about gear, files or paperwork still owed after the event. Those stay open however old they are.
- Status: "inquiry" = they asked, nothing quoted yet. "quoting" = a quote or estimate is out and undecided. "active" = booked or in production, event not finished. "done" = the event happened, or the conversation reached its natural end (an introduction, a call, a one-off question). "lost" = they went elsewhere, cancelled, or the event date passed with no sign Shift 4 was booked. Unpaid invoices do not keep a job "active": a finished event is "done" and the money is tracked in invoices.
- Invoices: one entry per invoice. "paid" only when an email says payment was sent or received. "overdue" when a stated due date has passed with no sign of payment, or an email calls it overdue. If a revised invoice replaces an earlier one, list only the current one and say so in the note.
- The summary is for Will, the owner, glancing at it on his phone. Plain words, real specifics, no filler.`;

function render(job: Job, today: string): string {
  const items = itemsForJob(job.id, "open");
  const mail = timelineForJob(job.id);
  return `TODAY: ${today}

JOB #${job.id}: ${job.name}
Client: ${job.client ?? "?"} | Event date: ${job.event_date ?? "?"} | Venue: ${job.venue ?? "?"} | Status now: ${job.status}
Summary now: ${job.summary ?? "(none)"}

OPEN ITEMS (${items.length}):
${items.map((it) => `- #${it.id} [${it.type}] ${it.text}${it.owner ? ` (on ${it.owner})` : ""}${it.due ? ` (due ${it.due})` : ""}`).join("\n") || "(none)"}

EMAILS, OLDEST FIRST (${mail.length}):
${mail.map((m) => `- ${(m.sent_at ?? m.received_at).slice(0, 10)} | ${m.direction === "internal" ? "Shift 4" : "them"}: ${m.sender.replace(/<.*>/, "").trim().slice(0, 40)} | ${m.category ?? "?"} | ${m.summary ?? m.subject ?? ""}`).join("\n") || "(none)"}`;
}

let client: Anthropic | null = null;

/** Re-reads one job and squares it up. Returns what changed. */
export async function tidyJob(jobId: number): Promise<{ job_id: number; name: string; status: string; closed: number; still_open: number; invoices: number; summary: string }> {
  const job = getJob(jobId);
  if (!job) throw new Error(`No job #${jobId}`);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.DIGEST_TZ || "America/Los_Angeles" }).format(new Date());
  const res = await client.messages.parse({
    model: process.env.AGENT_MODEL || "claude-sonnet-5-5", max_tokens: 16000, system: SYSTEM,
    output_config: { effort: (process.env.AGENT_EFFORT as "low" | "medium" | "high" | undefined) || "medium", format: zodOutputFormat(TidySchema) },
    messages: [{ role: "user", content: render(job, today) }],
  });
  addUsage("tidy", res.usage);
  if (res.stop_reason === "refusal") throw new Error(`model declined (${res.stop_details?.category ?? "no category"})`);
  if (res.stop_reason === "max_tokens") throw new Error("reply cut off at max_tokens");
  if (!res.parsed_output) throw new Error("reply didn't match the schema");
  const t = res.parsed_output as Tidy;

  // Only ids that really are open items on this job get closed, whatever the model returns.
  const open = new Set(itemsForJob(jobId, "open").map((it) => it.id));
  let closed = 0;
  for (const c of t.close) if (open.has(c.id)) { closeItem(c.id, c.why); closed++; }
  updateJob(jobId, {
    summary: t.summary, status: t.status,
    client: job.client ? undefined : t.client ?? undefined, event_date: t.event_date ?? undefined, venue: job.venue ? undefined : t.venue ?? undefined,
  });
  markTidied(jobId, t.invoices as Invoice[]);
  console.log(`[agent] tidied #${jobId} ${job.name}: ${job.status} -> ${t.status}, closed ${closed}/${open.size}, ${t.invoices.length} invoices`);
  return { job_id: jobId, name: job.name, status: t.status, closed, still_open: open.size - closed, invoices: t.invoices.length, summary: t.summary };
}

let running = false;
/** Tidies every job that has had email since its last tidy. One at a time; safe to call often. */
export async function tidyPending(max = 200): Promise<{ tidied: number; closed: number; failed: number }> {
  if (running) return { tidied: 0, closed: 0, failed: 0 };
  running = true;
  const out = { tidied: 0, closed: 0, failed: 0 };
  try {
    for (const j of jobsNeedingTidy(max)) {
      try { const r = await tidyJob(j.id); out.tidied++; out.closed += r.closed; }
      catch (e) {
        out.failed++;
        console.error(`[agent] tidy #${j.id} failed:`, (e as Error).message);
        if (/credit balance|invalid x-api-key|authentication_error/i.test((e as Error).message)) break; // account problem: stop, try again later
      }
    }
  } finally { running = false; }
  return out;
}
export const tidyRunning = () => running;

/* ---------- duplicates ---------- */

const DupSchema = z.object({
  pairs: z.array(z.object({
    keep_job_id: z.number().describe("The fuller record: more email, clearer name"),
    merge_job_id: z.number(),
    confidence: z.enum(["certain", "likely"]),
    reason: z.string().describe("One line: what shows these are the same event"),
  })),
});

/** Asks Claude which jobs look like the same event filed twice. Suggests only; merging is a separate, deliberate step. */
export async function findDuplicates() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const jobs = allJobs();
  const res = await client.messages.parse({
    model: process.env.AGENT_MODEL || "claude-sonnet-5-5", max_tokens: 8000,
    system: `You review the job list of Shift 4 Projects, an event production company. The list was built from email, so one event sometimes got filed as two jobs (for example once under the client and once under the AV vendor who invoiced for it). Find pairs that are the same event. Same client alone is not enough: the date, venue or specifics must line up. Different events for the same client are different jobs. If unsure, leave it out.`,
    output_config: { effort: "medium", format: zodOutputFormat(DupSchema) },
    messages: [{ role: "user", content: jobs.map((j) => `#${j.id} | ${j.name} | client: ${j.client ?? "?"} | date: ${j.event_date ?? "?"} | venue: ${j.venue ?? "?"} | ${j.status} | ${(j.summary ?? "").slice(0, 400)}`).join("\n") }],
  });
  addUsage("dedupe", res.usage);
  if (!res.parsed_output) throw new Error("reply didn't match the schema");
  const byId = new Map(jobs.map((j) => [j.id, j]));
  return (res.parsed_output as z.infer<typeof DupSchema>).pairs
    .filter((p) => byId.has(p.keep_job_id) && byId.has(p.merge_job_id) && p.keep_job_id !== p.merge_job_id)
    .map((p) => ({ ...p, keep: byId.get(p.keep_job_id)!.name, merge: byId.get(p.merge_job_id)!.name }));
}
