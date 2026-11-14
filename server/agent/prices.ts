import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { pdfsFor } from "./gmail";
import { addUsage, getJob, priceCandidates, savePrices, setPricesState, type StoredMessage } from "./store";

// Price memory. Will has no rate card: what he charges lives in the estimates and invoices he has sent, and what
// things cost him lives in the quotes and invoices vendors send back. This reads those PDFs line by line so
// "what did I charge for an LED wall last time" and "what does TAV charge me for uplights" have real answers.
// It is the groundwork for drafting estimates (and later, draft invoices in QuickBooks).

const DocSchema = z.object({
  documents: z.array(z.object({
    filename: z.string().describe("The attachment's filename, exactly as given"),
    relevant: z.boolean().describe("true only for an estimate, quote, proposal with prices, or invoice for event production work (gear, crew, services). false for receipts, software bills, W-9s, riders, floor plans, decks without prices"),
    doc_type: z.enum(["estimate", "quote", "invoice", "other"]),
    doc_number: z.string().nullable(),
    doc_date: z.string().nullable().describe("YYYY-MM-DD as printed on the document"),
    issuer: z.string().nullable().describe("The company or person the document is from"),
    bill_to: z.string().nullable().describe("Who it is addressed to"),
    side: z.enum(["sell", "cost"]).describe("sell = issued BY Shift 4 Projects to a client. cost = issued by a vendor, rental house or freelancer TO Shift 4 (or quoted to Shift 4)"),
    total: z.string().nullable().describe("The document's grand total exactly as printed"),
    lines: z.array(z.object({
      category: z.enum(["video", "audio", "lighting", "staging", "power", "rigging", "labor", "transport", "creative", "other"]),
      description: z.string().describe("The line as written, including model names and sizes"),
      qty: z.number().nullable(),
      unit: z.string().nullable().describe("each, day, hour, week, flat... as the document implies; null if unclear"),
      unit_price: z.string().nullable().describe("Exactly as printed, e.g. \"$125.00\""),
      amount: z.string().nullable().describe("Line total exactly as printed"),
    })).describe("Every priced line. Leave out subtotal, tax, discount and total rows"),
  })),
});

const SYSTEM = `You read estimates, quotes and invoices for Shift 4 Projects, an event technology and production company in Los Angeles, and copy out their line items so past pricing can be looked up later.

Rules:
- Copy what is printed. Never calculate, round, guess or fill in a price that isn't on the page. If a line has no price, its unit_price and amount are null.
- One entry per attached document. Mark anything that isn't a priced production document as not relevant and give it no lines.
- A package line with sub-bullets is one line: put the package name and its contents in the description.
- Decide the side from the letterhead and the bill-to: Shift 4 Projects' own paperwork is "sell"; anyone else's paperwork addressed to or quoted for Shift 4 is "cost".`;

let client: Anthropic | null = null;

/** Reads the priced PDFs on one email (downloading them from Gmail again). Returns how many lines were stored. */
export async function readPrices(m: StoredMessage): Promise<number> {
  return readPricesFrom(m, (await pdfsFor(m.message_id, m.mailbox)).filter((p) => /estimate|quote|invoice|proposal/i.test(p.name)));
}
export async function readPricesFrom(m: StoredMessage, pdfs: { name: string; data: string }[]): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  if (!pdfs.length) { setPricesState(m.message_id, "none"); return 0; }
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const job = m.job_id ? getJob(m.job_id) : undefined;
  const res = await client.messages.parse({
    model: process.env.AGENT_MODEL || "claude-sonnet-5-5", max_tokens: 16000, system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(DocSchema) },
    messages: [{ role: "user", content: [
      ...pdfs.map((d) => ({ type: "document" as const, title: d.name, source: { type: "base64" as const, media_type: "application/pdf" as const, data: d.data } })),
      { type: "text" as const, text: `These were attached to an email.\nFrom: ${m.sender}\nTo: ${m.recipients ?? ""}\nDate: ${(m.sent_at ?? m.received_at).slice(0, 10)}\nSubject: ${m.subject ?? ""}\n${job ? `Job: ${job.name}${job.client ? ` (${job.client})` : ""}\n` : ""}Attachments: ${pdfs.map((p) => p.name).join(", ")}` },
    ] }],
  });
  addUsage("prices", res.usage);
  if (res.stop_reason === "refusal") throw new Error("model declined");
  if (res.stop_reason === "max_tokens") throw new Error("reply cut off at max_tokens");
  if (!res.parsed_output) throw new Error("reply didn't match the schema");
  let n = 0;
  for (const d of (res.parsed_output as z.infer<typeof DocSchema>).documents) {
    if (!d.relevant || !d.lines.length) continue;
    savePrices(m.message_id, m.job_id, { doc: d.filename, doc_type: d.doc_type, doc_number: d.doc_number, doc_date: d.doc_date ?? (m.sent_at ?? m.received_at).slice(0, 10), issuer: d.issuer, bill_to: d.bill_to, side: d.side, total: d.total }, d.lines);
    n += d.lines.length;
  }
  setPricesState(m.message_id, n ? "done" : "none");
  console.log(`[agent] prices: ${m.subject ?? m.message_id} -> ${n} lines from ${pdfs.length} pdf(s)`);
  return n;
}

let running = false;
export const pricesRunning = () => running;
/** Works through every email with a priced PDF that hasn't been read yet. One at a time; safe to call often. */
export async function pricesPending(max = 500): Promise<{ read: number; lines: number; failed: number }> {
  const out = { read: 0, lines: 0, failed: 0 };
  if (running || !process.env.ANTHROPIC_API_KEY) return out;
  running = true;
  try {
    for (let batch = priceCandidates(); batch.length && out.read + out.failed < max; batch = priceCandidates()) {
      for (const m of batch) {
        try { out.lines += await readPrices(m); out.read++; }
        catch (e) {
          const msg = (e as Error).message;
          console.error("[agent] prices failed", m.subject, msg);
          if (/credit balance|invalid x-api-key|authentication_error|Access was removed/i.test(msg)) return out; // account problem: leave the rest for later
          setPricesState(m.message_id, "failed"); out.failed++;
        }
      }
    }
  } finally { running = false; }
  return out;
}
