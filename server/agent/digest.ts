import { sendEmail } from "../mail";
import { getSetting, listJobs, itemsForJob, recentMessages, setSetting, type Item } from "./store";

// The daily digest: what's open on every active job, and what came in since yesterday.

const esc = (s = "") => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const TZ = () => process.env.DIGEST_TZ || "America/Los_Angeles";
const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const hourIn = (tz: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()));

export function digestHtml(): { html: string; text: string; subject: string } | null {
  const today = todayIn(TZ());
  const jobs = listJobs().map((j) => ({ ...j, items: itemsForJob(j.id, "open") })).filter((j) => j.items.length || j.status === "inquiry" || j.status === "quoting");
  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const fresh = recentMessages(40).filter((m) => (m.sent_at ?? m.received_at) >= since && m.processed_at);
  if (!jobs.length && !fresh.length) return null;

  const line = (it: Item) => `${it.due ? `<b>${esc(it.due)}</b> ` : ""}${esc(it.text)}${it.owner ? ` <span style="color:#888">(${esc(it.owner)})</span>` : ""}`;
  const overdue = jobs.flatMap((j) => j.items.filter((it) => it.due && it.due < today).map((it) => ({ ...it, job: j.name })));
  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:620px;color:#111">
    <h2 style="margin:0 0 4px">Shift 4 daily digest</h2>
    <p style="margin:0 0 20px;color:#777">${esc(today)} · ${jobs.length} active job${jobs.length === 1 ? "" : "s"} · ${jobs.reduce((n, j) => n + j.items.length, 0)} open items</p>
    ${overdue.length ? `<div style="background:#fff3f3;border:1px solid #f3c2c2;padding:12px 14px;margin-bottom:20px"><b>Overdue</b><ul style="margin:8px 0 0;padding-left:18px">${overdue.map((it) => `<li>${line(it)} <span style="color:#888">· ${esc(it.job)}</span></li>`).join("")}</ul></div>` : ""}
    ${jobs.map((j) => `
      <div style="border-top:1px solid #e5e5e5;padding:14px 0">
        <div><b>${esc(j.name)}</b>${j.client ? ` · ${esc(j.client)}` : ""}${j.event_date ? ` · ${esc(j.event_date)}` : ""}${j.venue ? ` · ${esc(j.venue)}` : ""} <span style="color:#888">· ${esc(j.status)}</span></div>
        ${j.summary ? `<div style="color:#555;margin-top:4px">${esc(j.summary)}</div>` : ""}
        ${j.items.length ? `<ul style="margin:8px 0 0;padding-left:18px">${j.items.map((it) => `<li>[${esc(it.type)}] ${line(it)}</li>`).join("")}</ul>` : `<div style="color:#888;margin-top:4px">Nothing open.</div>`}
      </div>`).join("")}
    ${fresh.length ? `<h3 style="margin:24px 0 8px">New since yesterday</h3><ul style="margin:0;padding-left:18px">${fresh.map((m) => `<li><b>${esc(m.subject ?? "(no subject)")}</b> <span style="color:#888">${esc(m.sender)}</span><br>${esc(m.summary ?? "")}</li>`).join("")}</ul>` : ""}
    <p style="color:#888;margin-top:28px;font-size:12px">Ask Claude for more: "what's open on ${esc(jobs[0]?.name ?? "a job")}?"</p>
  </div>`;
  const text = jobs.map((j) => `${j.name}${j.client ? ` (${j.client})` : ""}\n${j.items.map((it) => `  - [${it.type}] ${it.due ? `${it.due} ` : ""}${it.text}`).join("\n") || "  nothing open"}`).join("\n\n");
  return { html, text, subject: `Shift 4 digest, ${today}: ${jobs.reduce((n, j) => n + j.items.length, 0)} open across ${jobs.length} jobs` };
}

export async function sendDigest(force = false): Promise<"sent" | "empty" | "skipped" | "failed"> {
  const to = (process.env.DIGEST_TO || process.env.CONTACT_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length || !process.env.RESEND_API_KEY) { if (force) console.warn("[agent] DIGEST_TO / RESEND_API_KEY not set"); return "skipped"; }
  const today = todayIn(TZ());
  if (!force && getSetting("last_digest") === today) return "skipped";
  const d = digestHtml();
  if (!d) { setSetting("last_digest", today); return "empty"; }
  const ok = await sendEmail({ to, subject: d.subject, html: d.html, text: d.text });
  if (ok) setSetting("last_digest", today);
  return ok ? "sent" : "failed";
}

/** Once a minute: send the digest at DIGEST_HOUR (local to DIGEST_TZ), and retry anything unprocessed. */
export function startSchedule(retry: () => Promise<unknown>) {
  const hour = Number(process.env.DIGEST_HOUR ?? 7);
  setInterval(() => {
    if (hourIn(TZ()) >= hour) sendDigest().catch((e) => console.error("[agent] digest", e));
  }, 60_000).unref();
  setInterval(() => retry().catch((e) => console.error("[agent] retry", e)), 10 * 60_000).unref();
}
