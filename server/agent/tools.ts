import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { brief } from "./brief";
import { sendDigest } from "./digest";
import { gmailStatus } from "./gmail";
import { aiPause } from "./ingest";
import { findDuplicates, tidyJob, tidyPending, tidyRunning } from "./tidy";
import {
  addItem, closeItem, contactsForJob, currentItemsForJob, mergeJobs, getJob, getMessage, itemsForJob, listJobs, messagesForJob, openItems,
  findContacts, invoicesOf, jobsNeedingTidy, openInvoices, recentMessages, search, stats, updateJob, usageByDay,
} from "./store";

// The project-memory tools Will uses from Claude: "what's open on the Hulu job?", "what did the venue say about power?"

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: (e as Error).message }] });
const run = async (fn: () => unknown) => { try { return json(await fn()); } catch (e) { return fail(e); } };
const line = (m: { message_id: string; sent_at: string | null; received_at: string; sender: string; subject: string | null; category: string | null; summary: string | null; direction: string }) =>
  ({ message_id: m.message_id, date: (m.sent_at ?? m.received_at).slice(0, 16), from: m.sender, subject: m.subject, category: m.category, summary: m.summary, direction: m.direction });

export function registerAgentTools(server: McpServer) {
  server.registerTool("list_jobs", {
    title: "List jobs (inbox assistant)",
    description: "Jobs the inbox assistant is tracking from will@ and office@ email, soonest event first. Default: current jobs only (event upcoming or in the last 2 weeks, or email in the last 30 days, including just-finished jobs still wrapping up). Pass include_old for every job not marked done or lost, or a status for that status.",
    inputSchema: { status: z.enum(["inquiry", "quoting", "active", "done", "lost"]).optional(), include_old: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, ({ status, include_old }) => run(() => listJobs(status, include_old).map((j) => ({ ...j, open_items: (include_old || status ? itemsForJob(j.id, "open") : currentItemsForJob(j.id)).length }))));

  server.registerTool("get_job", {
    title: "Get job",
    description: "Everything known about one job: details, open and done items, contacts and the recent emails (with summaries) it was learned from.",
    inputSchema: { job_id: z.number().int() },
    annotations: { readOnlyHint: true },
  }, ({ job_id }) => run(() => {
    const j = getJob(job_id);
    if (!j) throw new Error(`No job #${job_id}. Use list_jobs.`);
    const { billing: _b, ...rest } = j;
    return { ...rest, invoices: invoicesOf(j), items: itemsForJob(job_id), contacts: contactsForJob(job_id), emails: messagesForJob(job_id).map(line) };
  }));

  server.registerTool("open_items", {
    title: "Open items across all jobs",
    description: "Open questions, tasks, deadlines and changes across current jobs, soonest due first. Leaves out items on jobs that are over and items more than 45 days stale unless include_old is true. Optionally only those due on or before a date.",
    inputSchema: { due_before: z.string().optional().describe("YYYY-MM-DD"), include_old: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, ({ due_before, include_old }) => run(() => openItems(due_before, include_old)));

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

  server.registerTool("merge_jobs", {
    title: "Merge two jobs",
    description: "When the same event was filed as two jobs, fold one into the other: its emails and items move to the job you keep.",
    inputSchema: { keep_job_id: z.number().int(), merge_job_id: z.number().int().describe("This job is removed after its emails and items move over") },
  }, ({ keep_job_id, merge_job_id }) => run(() => mergeJobs(keep_job_id, merge_job_id)));

  server.registerTool("search_inbox", {
    title: "Search email memory",
    description: "Full-text search across every email the assistant has read, plus items and jobs. Good for \"what did the venue say about power\".",
    inputSchema: { query: z.string().min(2).max(200), limit: z.number().int().min(1).max(50).default(15) },
    annotations: { readOnlyHint: true },
  }, ({ query, limit }) => run(() => search(query, limit).map((r) => {
    if (r.kind === "message") { const m = getMessage(r.ref); return m ? { ...line(m), snippet: r.snippet, job_id: m.job_id } : r; }
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
    return { ...line(m), to: m.recipients, body: m.body, attachments: JSON.parse(m.attachments || "[]"), job_id: m.job_id };
  }));

  server.registerTool("recent_emails", {
    title: "Recent emails",
    description: "The latest emails the assistant has read, newest first, with one-line summaries.",
    inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
    annotations: { readOnlyHint: true },
  }, ({ limit }) => run(() => recentMessages(limit).map(line)));

  server.registerTool("inbox_connections", {
    title: "Connected inboxes",
    description: "Which Gmail inboxes the assistant reads, how far the history backfill has got, and any connection errors.",
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, () => run(() => ({ inboxes: gmailStatus(), paused: aiPause(), tidy: { running: tidyRunning(), jobs_waiting: jobsNeedingTidy().length }, ...stats(), usage_by_day: usageByDay(7) })));

  server.registerTool("morning_brief", {
    title: "Morning brief",
    description: "What needs attention today: events in the next 2 weeks, emails waiting on a reply from Shift 4, overdue and due-this-week items, things Shift 4 is waiting on, new inquiries, and open invoices both ways. Start here for \"what's on my plate\" or \"catch me up\".",
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, () => run(() => brief()));

  server.registerTool("open_invoices", {
    title: "Open invoices (who owes what)",
    description: "Unpaid invoices the assistant has seen in email, across all jobs. receivable = owed to Shift 4, payable = Shift 4 owes a vendor or crew. Figures come from email, not QuickBooks, so treat them as a prompt to check the books.",
    inputSchema: { direction: z.enum(["receivable", "payable"]).optional() },
    annotations: { readOnlyHint: true },
  }, ({ direction }) => run(() => openInvoices(direction)));

  server.registerTool("find_contact", {
    title: "Find a contact",
    description: "Look someone up by name, company or email: who they are, their role, and which jobs they've been on.",
    inputSchema: { query: z.string().min(2).max(100) },
    annotations: { readOnlyHint: true },
  }, ({ query }) => run(() => findContacts(query)));

  server.registerTool("tidy_job", {
    title: "Tidy a job",
    description: "Re-reads every email on one job and squares the record up: closes items that were answered or no longer matter, rewrites the summary, sets the status and lists its invoices. Runs by itself every night for jobs with new email; use this to do one right now.",
    inputSchema: { job_id: z.number().int() },
  }, ({ job_id }) => run(() => tidyJob(job_id)));

  server.registerTool("tidy_all_jobs", {
    title: "Tidy every job with new email",
    description: "Starts the tidy pass in the background for every job that has had email since it was last tidied. Returns straight away; ask for inbox_connections to see progress.",
    inputSchema: {},
  }, () => run(() => {
    const waiting = jobsNeedingTidy().length;
    if (!tidyRunning()) tidyPending().catch((e) => console.error("[agent] tidy", e));
    return { started: true, jobs_to_tidy: waiting };
  }));

  server.registerTool("find_duplicate_jobs", {
    title: "Find jobs filed twice",
    description: "Looks for the same event filed as two jobs and suggests which to merge. It only suggests: use merge_jobs to act on a pair.",
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, () => run(() => findDuplicates()));

  server.registerTool("send_digest", {
    title: "Send the daily digest now",
    description: "Emails today's digest (open items per job, new emails) to the digest inbox right away.",
    inputSchema: {},
  }, () => run(async () => ({ result: await sendDigest(true), ...stats() })));
}
