import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { addUsage, type Job, type Item } from "./store";

// Reads one email and returns what it means for Shift 4's project memory. Claude fills in a fixed
// form (a forced tool call), so the output is always the same shape and never free text.

export type Extraction = {
  job: {
    match_id: number | null;     // an existing job this email belongs to, or null for a new one
    name: string;                // short job name, e.g. "Hulu screening and after-party"
    client: string | null;
    event_date: string | null;   // YYYY-MM-DD when known, else null
    venue: string | null;
    status: "inquiry" | "quoting" | "active" | "done" | "lost" | null;
    summary: string | null;      // one or two sentences, updated state of the job
  } | null;
  category: "inquiry" | "change" | "approval" | "question" | "logistics" | "vendor" | "billing" | "other";
  summary: string;               // what this email says, one or two sentences
  needs_reply: boolean;          // is this email waiting on an answer from Shift 4?
  contacts: { email: string; name: string | null; company: string | null; role: "client" | "vendor" | "venue" | "internal" | "other" }[];
  items: { type: "decision" | "question" | "task" | "deadline" | "change"; text: string; owner: "Shift 4" | "client" | "vendor" | null; due: string | null }[];
  resolves: number[];            // ids of existing open items this email answers or completes
};

// Structured outputs: the model's reply is constrained to this schema (forced tool use isn't available on current models).
const ExtractionSchema = z.object({
  job: z.object({
    match_id: z.number().nullable().describe("id of the existing job it belongs to, or null if this is a new job"),
    name: z.string().describe("Short job name, e.g. \"Hulu screening and after-party\""),
    client: z.string().nullable(),
    event_date: z.string().nullable().describe("YYYY-MM-DD, or YYYY-MM if only the month is known"),
    venue: z.string().nullable(),
    status: z.enum(["inquiry", "quoting", "active", "done", "lost"]).nullable(),
    summary: z.string().nullable().describe("Where the whole job stands after this email, two sentences. Build on the current summary shown for the likely job; null when this email changes nothing worth noting or you can't see the current summary"),
  }).nullable().describe("The job (event / production) this email is about. null only if it is clearly not about any job"),
  category: z.enum(["inquiry", "change", "approval", "question", "logistics", "vendor", "billing", "other"]),
  summary: z.string().describe("What this email says, in one or two plain sentences"),
  needs_reply: z.boolean().describe("true only if the sender is outside Shift 4 and is waiting on an answer, decision or action from Shift 4. false for FYIs, thank-yous, automated mail and anything Shift 4 sent."),
  contacts: z.array(z.object({
    email: z.string(), name: z.string().nullable(), company: z.string().nullable(),
    role: z.enum(["client", "vendor", "venue", "internal", "other"]),
  })),
  items: z.array(z.object({
    type: z.enum(["decision", "question", "task", "deadline", "change"]),
    text: z.string().describe("One line, specific, e.g. \"Client needs 2x CDJ-3000, venue has none\""),
    owner: z.enum(["Shift 4", "client", "vendor"]).nullable(),
    due: z.string().nullable().describe("YYYY-MM-DD if a date is stated or clearly implied"),
  })).describe("New decisions, open questions, tasks, deadlines or scope changes stated in this email. Skip anything already in the existing open items."),
  resolves: z.array(z.number()).describe("ids of existing open items this email answers, approves or completes"),
});

const SYSTEM = `You are the inbox assistant for Shift 4 Projects, an event technology and production company in Los Angeles (video walls / LED, audio, lighting, staging, playback, DJ gear, power, rigging, scenic, WiFi, crew). You read Shift 4's email (Will's inbox will@shift4projects.com and the shared office@shift4projects.com, whose aliases are projects@ for jobs and accounting@ for billing) and keep an accurate project memory.

Rules:
- Only record facts stated in the email or its attachments. Never invent specs, prices, dates or names.
- Match to an existing job when the client, event or thread clearly lines up; otherwise create a new one.
- Items are short, specific and actionable: something a person has to do, answer, decide or hit a date for. Plain facts (the event date, a colour scheme, specs, an amount already agreed) belong in the summary, not in items. Use "decision" only to record something that was actually agreed. Skip pleasantries. Do not repeat existing open items; if the email answers one, put its id in "resolves".
- A job is an event or a piece of production work. A call, meeting, intro or calendar invite with someone tied to an existing job or client belongs to that job (record the meeting as one item with its date), not to a new job of its own. Only open a new job for a meeting when it is a new prospect with no job yet.
- A vendor's quote or invoice for an event (for example Turunen AV / TAV billing Shift 4 for a client's show) belongs to that client event's job, not to a separate job named after the vendor.
- Internal emails (from the Shift 4 team) still count: they often contain decisions and tasks.
- Mail sent to accounting@ (or about invoices, deposits, payments, POs, vendor bills) is category "billing". Still tie it to the job when one is identifiable, and record amounts, invoice numbers and due dates exactly as written.
- If the email is clearly not about any job (newsletter, receipt for a personal purchase, spam, personal life), set job to null and category "other", and record no items or contacts.
- Attached PDFs (quotes, invoices, riders, floor plans, venue specs) count as part of the email: pull gear, quantities, power, dates and prices from them.
- Dates: resolve relative dates ("next Friday") using the email's send date. Output YYYY-MM-DD.`;

export type ExtractInput = {
  sender: string; recipients: string; subject: string; sent_at: string; body: string; attachments_text: string;
  direction: string; jobs: Job[]; open_items: Item[]; thread_context: string;
  /** The job this thread already belongs to, so its summary can be built on rather than overwritten. */
  likely_job?: Job | null;
  pdfs?: { name: string; data: string }[];
};

function render(i: ExtractInput): string {
  const jobs = i.jobs.length
    ? i.jobs.map((j) => `- #${j.id} ${j.name} | client: ${j.client ?? "?"} | date: ${j.event_date ?? "?"} | venue: ${j.venue ?? "?"} | status: ${j.status}`).join("\n")
    : "(none yet)";
  const items = i.open_items.length ? i.open_items.map((it) => `- #${it.id} [${it.type}] ${it.text}${it.due ? ` (due ${it.due})` : ""}`).join("\n") : "(none)";
  const likely = i.likely_job ? `LIKELY JOB (this thread is already filed under it): #${i.likely_job.id} ${i.likely_job.name}\nCurrent summary: ${i.likely_job.summary ?? "(none)"}\n\n` : "";
  return `EXISTING JOBS:\n${jobs}\n\n${likely}OPEN ITEMS ON THE LIKELY JOB:\n${items}\n\n` +
    (i.thread_context ? `EARLIER IN THIS THREAD (already recorded):\n${i.thread_context}\n\n` : "") +
    `EMAIL (${i.direction})\nFrom: ${i.sender}\nTo: ${i.recipients}\nDate: ${i.sent_at}\nSubject: ${i.subject}\n\n${i.body.slice(0, 12000)}` +
    (i.attachments_text ? `\n\nATTACHMENTS:\n${i.attachments_text.slice(0, 8000)}` : "");
}

/** Deterministic stand-in so the pipeline can be tested without an API key (AGENT_MODEL=stub). */
function stub(i: ExtractInput): Extraction {
  const match = i.jobs.find((j) => i.subject.toLowerCase().includes((j.client ?? j.name).toLowerCase().split(" ")[0]));
  return {
    job: { match_id: match?.id ?? null, name: match?.name ?? (i.subject.replace(/^(re|fwd?):\s*/i, "").slice(0, 80) || "Untitled job"), client: match?.client ?? null, event_date: null, venue: null, status: null, summary: `Stub: ${i.subject}` },
    category: "other", summary: `Stub summary of "${i.subject}"`, needs_reply: i.direction !== "internal" && /\?/.test(i.body), contacts: [{ email: i.sender.replace(/.*<|>.*/g, ""), name: null, company: null, role: i.direction === "internal" ? "internal" : "client" }],
    items: /\?/.test(i.body) ? [{ type: "question", text: i.body.split(/\n/).find((l) => l.includes("?"))?.trim().slice(0, 140) || "Question in email", owner: "Shift 4", due: null }] : [],
    resolves: [],
  };
}

let client: Anthropic | null = null;

export async function extract(i: ExtractInput): Promise<Extraction> {
  const model = process.env.AGENT_MODEL || "claude-sonnet-5-5";
  if (model === "stub") return stub(i);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.parse({
    model, max_tokens: 16000, system: SYSTEM,
    // Routine extraction: medium effort keeps thinking (and cost) modest.
    output_config: { effort: (process.env.AGENT_EFFORT as "low" | "medium" | "high" | undefined) || "medium", format: zodOutputFormat(ExtractionSchema) },
    messages: [{ role: "user", content: [
      ...(i.pdfs ?? []).map((d) => ({ type: "document" as const, title: d.name, source: { type: "base64" as const, media_type: "application/pdf" as const, data: d.data } })),
      { type: "text" as const, text: render(i) },
    ] }],
  });
  addUsage("email", res.usage);
  if (res.stop_reason === "refusal") throw new Error(`model declined (${res.stop_details?.category ?? "no category"})`);
  if (res.stop_reason === "max_tokens") throw new Error("reply cut off at max_tokens");
  if (!res.parsed_output) throw new Error("reply didn't match the schema");
  return res.parsed_output as Extraction;
}
