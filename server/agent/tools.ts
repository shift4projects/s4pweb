import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendDigest } from "./digest";
import {
  addItem, closeItem, contactsForJob, getJob, getMessage, itemsForJob, listJobs, messagesForJob, openItems,
  recentMessages, search, stats, updateJob,
} from "./store";

// The project-memory tools Will uses from Claude: "what's open on the Hulu job?", "what did the venue say about power?"

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: (e as Error).message }] });
const run = async (fn: () => unknown) => { try { return json(await fn()); } catch (e) { return fail(e); } };
const brief = (m: { message_id: string; sent_at: string | null; received_at: string; sender: string; subject: string | null; category: string | null; summary: string | null; direction: string }) =>
  ({ message_id: m.message_id, date: (m.sent_at ?? m.received_at).slice(0, 16), from: m.sender, subject: m.subject, category: m.category, summary: m.summary, direction: m.direction });

export function registerAgentTools(server: McpServer) {
  server.registerTool("list_jobs", {
    title: "List jobs (inbox assistant)",
    description: "Jobs the inbox assistant is tracking from office@ email, soonest event first. Default: everything not done or lost.",
    inputSchema: { status: z.enum(["inquiry", "quoting", "active", "done", "lost"]).optional() },
    annotations: { readOnlyHint: true },
  }, ({ status }) => run(() => listJobs(status).map((j) => ({ ...j, open_items: itemsForJob(j.id, "open").length }))));

  server.registerTool("get_job", {
    title: "Get job",
    description: "Everything known about one job: details, open and done items, contacts and the recent emails (with summaries) it was learned from.",
    inputSchema: { job_id: z.number().int() },
    annotations: { readOnlyHint: true },
  }, ({ job_id }) => run(() => {
    const j = getJob(job_id);
    if (!j) throw new Error(`No job #${job_id}. Use list_jobs.`);
    return { ...j, items: itemsForJob(job_id), contacts: contactsForJob(job_id), emails: messagesForJob(job_id).map(brief) };
  }));

  server.registerTool("open_items", {
    title: "Open items across all jobs",
    description: "Every open question, task, deadline and change, soonest due first. Optionally only those due on or before a date.",
    inputSchema: { due_before: z.string().optional().describe("YYYY-MM-DD") },
    annotations: { readOnlyHint: true },
  }, ({ due_before }) => run(() => openItems(due_before)));

  server.registerTool("complete_item", {
    title: "Mark item done",
    description: "Close an open item (question answered, task finished, change applied).",
    inputSchema: { item_id: z.number().int() },
  }, ({ item_id }) => run(() => closeItem(item_id)));

  server.registerTool("add_item", {
    title: "Add item to a job",
    description: "Add a task, question, deadline, decision or change to a job by hand.",
    inputSchema: {
      job_id: z.number().int(), type: z.enum(["decision", "question", "task", "deadline", "change"]), text: z.string().min(1).max(300),
      owner: z.enum(["Shift 4", "client", "vendor"]).optional(), due: z.string().optional().describe("YYYY-MM-DD"),
    },
  }, (a) => run(() => addItem(a)));

  server.registerTool("update_job", {
    title: "Update job",
    description: "Correct or fill in a job's name, client, event date, venue, status, summary or notes. Only the fields you pass change.",
    inputSchema: {
      job_id: z.number().int(), name: z.string().max(160).optional(), client: z.string().max(120).optional(), event_date: z.string().max(20).optional(),
      venue: z.string().max(160).optional(), status: z.enum(["inquiry", "quoting", "active", "done", "lost"]).optional(),
      summary: z.string().max(1200).optional(), notes: z.string().max(4000).optional().describe("Free-form notes Will wants kept with the job"),
    },
  }, ({ job_id, ...patch }) => run(() => updateJob(job_id, patch)));

  server.registerTool("search_inbox", {
    title: "Search email memory",
    description: "Full-text search across every email the assistant has read, plus items and jobs. Good for \"what did the venue say about power\".",
    inputSchema: { query: z.string().min(2).max(200), limit: z.number().int().min(1).max(50).default(15) },
    annotations: { readOnlyHint: true },
  }, ({ query, limit }) => run(() => search(query, limit).map((r) => {
    if (r.kind === "message") { const m = getMessage(r.ref); return m ? { ...brief(m), snippet: r.snippet, job_id: m.job_id } : r; }
    return r;
  })));

  server.registerTool("read_email", {
    title: "Read one email",
    description: "The full text of one email the assistant has stored, by message_id (from get_job, search_inbox or recent_emails).",
    inputSchema: { message_id: z.string() },
    annotations: { readOnlyHint: true },
  }, ({ message_id }) => run(() => {
    const m = getMessage(message_id);
    if (!m) throw new Error("No such email");
    return { ...brief(m), to: m.recipients, body: m.body, attachments: JSON.parse(m.attachments || "[]"), job_id: m.job_id };
  }));

  server.registerTool("recent_emails", {
    title: "Recent emails",
    description: "The latest emails the assistant has read, newest first, with one-line summaries.",
    inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
    annotations: { readOnlyHint: true },
  }, ({ limit }) => run(() => recentMessages(limit).map(brief)));

  server.registerTool("send_digest", {
    title: "Send the daily digest now",
    description: "Emails today's digest (open items per job, new emails) to the digest inbox right away.",
    inputSchema: {},
  }, () => run(async () => ({ result: await sendDigest(true), ...stats() })));
}
