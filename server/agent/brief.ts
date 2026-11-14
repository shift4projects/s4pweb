import {
  currentItemsForJob, newInquiries, openInvoices, openItems, upcomingJobs, waitingThreads, type StoredMessage,
} from "./store";

// The morning brief: what needs Will's attention today. No AI call here, it's read straight from the project memory,
// so it's instant and free to ask for as often as he likes.

const TZ = () => process.env.DIGEST_TZ || "America/Los_Angeles";
const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ(), year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const name = (sender: string) => sender.replace(/<.*>/, "").replace(/"/g, "").trim() || sender;
const thread = (m: StoredMessage & { job_name: string }, today: string) => {
  const when = (m.sent_at ?? m.received_at).slice(0, 10);
  return {
    job_id: m.job_id, job: m.job_name, from: name(m.sender), subject: m.subject, date: when,
    days_waiting: Math.max(0, Math.round((Date.parse(today) - Date.parse(when)) / 86400000)), summary: m.summary, message_id: m.message_id,
  };
};

export function brief() {
  const today = day(new Date());
  const week = day(new Date(Date.now() + 7 * 86400000));
  const items = openItems();
  const slim = (it: (typeof items)[number]) => ({ item_id: it.id, job_id: it.job_id, job: it.job_name, type: it.type, text: it.text, owner: it.owner, due: it.due });
  return {
    today,
    events_next_14_days: upcomingJobs(14).map((j) => ({ job_id: j.id, name: j.name, client: j.client, event_date: j.event_date, venue: j.venue, status: j.status, open_items: currentItemsForJob(j.id).length })),
    waiting_on_shift4: waitingThreads("external").map((m) => thread(m, today)),
    overdue: items.filter((it) => it.due && it.due < today).map(slim),
    due_next_7_days: items.filter((it) => it.due && it.due >= today && it.due <= week).map(slim),
    waiting_on_others: waitingThreads("internal").map((m) => thread(m, today)),
    new_inquiries: newInquiries(7).map((j) => ({ job_id: j.id, name: j.name, client: j.client, event_date: j.event_date, summary: j.summary })),
    money_owed_to_shift4: openInvoices("receivable"),
    shift4_owes: openInvoices("payable"),
    note: "Money figures come from email, not QuickBooks. Check the books before chasing or paying anything.",
  };
}
