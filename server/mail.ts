import { CITIES } from "../src/data/projects";
import type { Lead } from "./db";

const esc = (s = "") => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const FROM = () => process.env.CONTACT_FROM || "Shift 4 Projects <onboarding@resend.dev>";
const SITE = () => (process.env.SITE_URL || "https://shift4-projects.com").replace(/\/$/, "");
const inbox = () => (process.env.CONTACT_TO || "").split(",").map((s) => s.trim()).filter(Boolean);

const rowsOf = (l: Lead): [string, string | undefined][] => [
  ["Name", l.name], ["Email", l.email], ["Company", l.company], ["Phone", l.phone],
  ["Services", l.services], ["Event date", l.event_date], ["City", l.city],
];

/** POSTs to Resend. RESEND_API_URL can point at a local mock for testing. */
async function resend(payload: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(process.env.RESEND_API_URL || "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("[mail] Resend error", res.status, await res.text());
    return false;
  }
  return true;
}

/** Sends the inquiry to Shift 4's inbox. Returns false (and the lead stays in the DB) if not configured. */
export async function sendLeadEmail(l: Lead): Promise<boolean> {
  const to = inbox();
  if (!process.env.RESEND_API_KEY || !to.length) {
    console.warn("[mail] RESEND_API_KEY / CONTACT_TO not set; lead saved to DB only");
    return false;
  }
  const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px">
      <h2 style="margin:0 0 16px">New inquiry from shift4-projects.com</h2>
      <table cellpadding="6" style="border-collapse:collapse">
        ${rowsOf(l).filter(([, v]) => v).map(([k, v]) => `<tr><td style="color:#777">${k}</td><td>${esc(v)}</td></tr>`).join("")}
      </table>
      <p style="white-space:pre-wrap;border-top:1px solid #eee;padding-top:14px">${esc(l.message)}</p>
    </div>`;

  return resend({
    from: FROM(),
    to,
    reply_to: l.email,
    subject: `New inquiry: ${l.name}${l.company ? ` (${l.company})` : ""}`,
    html,
  });
}

/** The branded email the inquirer receives right after submitting (dark + orange, same as the site). */
export function autoReplyHtml(l: Lead): string {
  const first = esc(l.name.split(/\s+/)[0] || l.name);
  const site = SITE();
  const details = rowsOf(l).filter(([k, v]) => v && k !== "Name" && k !== "Email");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background:#0a0a0b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b">
<tr><td align="center" style="padding:40px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:Helvetica,Arial,sans-serif;color:#f2f0eb">
    <tr><td style="padding:0 0 36px"><a href="${site}"><img src="${site}/img/logo-white.png" width="150" alt="Shift 4 Projects" style="display:block;width:150px;height:auto;border:0"></a></td></tr>
    <tr><td style="font-size:40px;line-height:1.05;font-weight:800;letter-spacing:-0.02em;color:#ffffff;padding:0 0 18px">Got it, ${first}.</td></tr>
    <tr><td style="font-size:17px;line-height:1.55;color:#f2f0eb;padding:0 0 30px">Thanks for reaching out. We’ll be in touch shortly to talk through the details.</td></tr>
    <tr><td style="border-top:1px solid #2a2a2c;padding:22px 0 6px;font-family:Menlo,monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8c8b88">What you sent us</td></tr>
    ${details.map(([k, v]) => `<tr><td style="padding:6px 0;font-size:15px;line-height:1.4"><span style="color:#8c8b88">${k}</span>&nbsp;&nbsp;${esc(v)}</td></tr>`).join("")}
    <tr><td style="padding:14px 0 30px;font-size:15px;line-height:1.55;color:#c9c7c2;white-space:pre-wrap">${esc(l.message)}</td></tr>
    <tr><td style="border-top:1px solid #2a2a2c;padding:22px 0 0;font-family:Menlo,monospace;font-size:12px;line-height:1.8;color:#8c8b88">
      ${CITIES.map((c) => c.name).join(" &middot; ")}<br>
      <a href="${site}" style="color:#f2f0eb;text-decoration:none">${site.replace(/^https?:\/\//, "")}</a> &middot;
      <a href="https://instagram.com/shift4projects" style="color:#f2f0eb;text-decoration:none">@shift4projects</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/**
 * Instant auto-reply to the person who filled in the form. Skipped when Resend isn't configured or
 * CONTACT_FROM isn't a real (verified) sender, since Resend's test sender can't email strangers.
 */
export async function sendAutoReply(l: Lead): Promise<boolean> {
  if (!process.env.RESEND_API_KEY || !process.env.CONTACT_FROM || process.env.AUTO_REPLY === "off") return false;
  const replyTo = inbox();
  return resend({
    from: FROM(),
    to: [l.email],
    ...(replyTo.length ? { reply_to: replyTo } : {}),
    subject: "Thanks for reaching out to Shift 4 Projects",
    html: autoReplyHtml(l),
    text: `Got it, ${l.name.split(/\s+/)[0]}.\n\nThanks for reaching out. We’ll be in touch shortly to talk through the details.\n\n${SITE()}`,
  });
}
