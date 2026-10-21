import Anthropic from "@anthropic-ai/sdk";
import type { Job, Item } from "./store";

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
  category: "inquiry" | "change" | "approval" | "question" | "logistics" | "vendor" | "other";
  summary: string;               // what this email says, one or two sentences
  contacts: { email: string; name: string | null; company: string | null; role: "client" | "vendor" | "venue" | "internal" | "other" }[];
  items: { type: "decision" | "question" | "task" | "deadline" | "change"; text: string; owner: "Shift 4" | "client" | "vendor" | null; due: string | null }[];
  resolves: number[];            // ids of existing open items this email answers or completes
};

const TOOL: Anthropic.Tool = {
  name: "record_email",
  description: "Record what this email means for the production company's project memory.",
  input_schema: {
    type: "object",
    required: ["job", "category", "summary", "contacts", "items", "resolves"],
    properties: {
      job: {
        type: ["object", "null"],
        description: "The job (event / production) this email is about. null only if it is clearly not about any job (newsletter, spam, personal).",
        properties: {
          match_id: { type: ["integer", "null"], description: "id of the existing job it belongs to, or null if this is a new job" },
          name: { type: "string" },
          client: { type: ["string", "null"] },
          event_date: { type: ["string", "null"], description: "YYYY-MM-DD, or YYYY-MM if only the month is known" },
          venue: { type: ["string", "null"] },
          status: { type: ["string", "null"], enum: ["inquiry", "quoting", "active", "done", "lost", null] },
          summary: { type: ["string", "null"], description: "Updated one-or-two-sentence state of the whole job, folding in this email" },
        },
        required: ["match_id", "name", "client", "event_date", "venue", "status", "summary"],
      },
      category: { type: "string", enum: ["inquiry", "change", "approval", "question", "logistics", "vendor", "other"] },
      summary: { type: "string", description: "What this email says, in one or two plain sentences" },
      contacts: {
        type: "array",
        items: {
          type: "object",
          required: ["email", "name", "company", "role"],
          properties: {
            email: { type: "string" }, name: { type: ["string", "null"] }, company: { type: ["string", "null"] },
            role: { type: "string", enum: ["client", "vendor", "venue", "internal", "other"] },
          },
        },
      },
      items: {
        type: "array",
        description: "New decisions, open questions, tasks, deadlines or scope changes. Only things stated in this email. Skip anything already in the existing open items.",
        items: {
          type: "object",
          required: ["type", "text", "owner", "due"],
          properties: {
            type: { type: "string", enum: ["decision", "question", "task", "deadline", "change"] },
            text: { type: "string", description: "One line, specific, e.g. \"Client needs 2x CDJ-3000, venue has none\"" },
            owner: { type: ["string", "null"], enum: ["Shift 4", "client", "vendor", null] },
            due: { type: ["string", "null"], description: "YYYY-MM-DD if a date is stated or clearly implied" },
          },
        },
      },
      resolves: { type: "array", items: { type: "integer" }, description: "ids of existing open items this email answers, approves or completes" },
    },
  },
};

const SYSTEM = `You are the inbox assistant for Shift 4 Projects, an event technology and production company in Los Angeles (video walls / LED, audio, lighting, staging, playback, DJ gear, power, rigging, scenic, WiFi, crew). You read emails CC'd to office@shift4projects.com and keep an accurate project memory.

Rules:
- Only record facts stated in the email or its attachments. Never invent specs, prices, dates or names.
- Match to an existing job when the client, event or thread clearly lines up; otherwise create a new one.
- Items are short, specific and actionable. Skip pleasantries. Do not repeat existing open items; if the email answers one, put its id in "resolves".
- Internal emails (from the Shift 4 team) still count: they often contain decisions and tasks.
- If the email is clearly not about any job (newsletter, receipt, spam, personal), set job to null and category "other".
- Dates: resolve relative dates ("next Friday") using the email's send date. Output YYYY-MM-DD.`;

export type ExtractInput = {
  sender: string; recipients: string; subject: string; sent_at: string; body: string; attachments_text: string;
  direction: string; jobs: Job[]; open_items: Item[]; thread_context: string;
};

function render(i: ExtractInput): string {
  const jobs = i.jobs.length
    ? i.jobs.map((j) => `- #${j.id} ${j.name} | client: ${j.client ?? "?"} | date: ${j.event_date ?? "?"} | venue: ${j.venue ?? "?"} | status: ${j.status}`).join("\n")
    : "(none yet)";
  const items = i.open_items.length ? i.open_items.map((it) => `- #${it.id} [${it.type}] ${it.text}${it.due ? ` (due ${it.due})` : ""}`).join("\n") : "(none)";
  return `EXISTING JOBS:\n${jobs}\n\nOPEN ITEMS ON THE LIKELY JOB:\n${items}\n\n` +
    (i.thread_context ? `EARLIER IN THIS THREAD (already recorded):\n${i.thread_context}\n\n` : "") +
    `EMAIL (${i.direction})\nFrom: ${i.sender}\nTo: ${i.recipients}\nDate: ${i.sent_at}\nSubject: ${i.subject}\n\n${i.body.slice(0, 12000)}` +
    (i.attachments_text ? `\n\nATTACHMENTS:\n${i.attachments_text.slice(0, 8000)}` : "");
}

/** Deterministic stand-in so the pipeline can be tested without an API key (AGENT_MODEL=stub). */
function stub(i: ExtractInput): Extraction {
  const match = i.jobs.find((j) => i.subject.toLowerCase().includes((j.client ?? j.name).toLowerCase().split(" ")[0]));
  return {
    job: { match_id: match?.id ?? null, name: match?.name ?? (i.subject.replace(/^(re|fwd?):\s*/i, "").slice(0, 80) || "Untitled job"), client: match?.client ?? null, event_date: null, venue: null, status: null, summary: `Stub: ${i.subject}` },
    category: "other", summary: `Stub summary of "${i.subject}"`, contacts: [{ email: i.sender.replace(/.*<|>.*/g, ""), name: null, company: null, role: i.direction === "internal" ? "internal" : "client" }],
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
  const res = await client.messages.create({
    model, max_tokens: 2500, system: SYSTEM, tools: [TOOL], tool_choice: { type: "tool", name: "record_email" },
    messages: [{ role: "user", content: render(i) }],
  });
  const call = res.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
  if (!call) throw new Error("model returned no record_email call");
  return call.input as Extraction;
}
