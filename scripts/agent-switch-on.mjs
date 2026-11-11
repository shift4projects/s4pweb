// Switches the inbox assistant on, start to finish, once the keys exist.
// Put the keys in ~/.claude/.secrets/shift4.env (never in the repo):
//   ANTHROPIC_API_KEY=...        required (Will's account)
//   AGENTMAIL_API_KEY=...        required
//   RESEND_API_KEY=...           optional: turns on the daily digest + contact form email
//   DIGEST_TO=will@shift4projects.com   optional, defaults to that address
// Then:  set -a; source ~/.claude/.secrets/shift4.env; set +a; node scripts/agent-switch-on.mjs        (dry run, changes nothing)
//        ... node scripts/agent-switch-on.mjs --go                                                     (does it)
// Safe to run twice: the inbox and webhook are looked up before anything is created.
import { execFileSync } from "node:child_process";
import { AgentMailClient } from "agentmail";

const GO = process.argv.includes("--go");
const SITE = "https://shift4projects.com";
const HOOK = `${SITE}/agent/webhook`;
const SERVICE = "shift4-site";
const { ANTHROPIC_API_KEY, AGENTMAIL_API_KEY, RESEND_API_KEY } = process.env;
const DIGEST_TO = process.env.DIGEST_TO || "will@shift4projects.com";
const say = (m) => console.log(m);
const die = (m) => { console.error(`STOP: ${m}`); process.exit(1); };

// --code: print the latest emails in the assistant's inbox (to grab Google's forwarding confirmation code).
if (process.argv.includes("--code")) {
  if (!AGENTMAIL_API_KEY) die("AGENTMAIL_API_KEY missing");
  const m = new AgentMailClient({ apiKey: AGENTMAIL_API_KEY });
  const box = (await m.inboxes.list({ limit: 100 })).inboxes?.find((i) => i.clientId === "shift4-office");
  if (!box) die("no inbox yet; run with --go first");
  for (const x of (await m.inboxes.messages.list(box.inboxId, { limit: 5 })).messages ?? []) say(`${x.from} | ${x.subject}\n   ${(x.preview || "").slice(0, 300)}\n`);
  process.exit(0);
}
if (!ANTHROPIC_API_KEY) die("ANTHROPIC_API_KEY missing from ~/.claude/.secrets/shift4.env");
if (!AGENTMAIL_API_KEY) die("AGENTMAIL_API_KEY missing from ~/.claude/.secrets/shift4.env");
say(GO ? "LIVE RUN" : "DRY RUN (nothing will change; add --go to do it)");

// 1. Anthropic key works, and the model the assistant uses is available on it.
const MODEL = process.env.AGENT_MODEL || "claude-sonnet-5-5";
{
  const r = await fetch("https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } });
  if (!r.ok) die(`Anthropic key rejected (${r.status}). Check the key and that a card is on the account.`);
  const ids = (await r.json()).data.map((m) => m.id);
  if (!ids.includes(MODEL)) die(`Model ${MODEL} isn't available on this key. Available: ${ids.slice(0, 8).join(", ")}`);
  say(`1. Anthropic key OK, ${MODEL} available`);
}

// 2. AgentMail inbox (find or create).
const mail = new AgentMailClient({ apiKey: AGENTMAIL_API_KEY });
let inbox = (await mail.inboxes.list({ limit: 100 })).inboxes?.find((i) => i.clientId === "shift4-office" || i.displayName === "Shift 4 Office Assistant");
if (!inbox && GO) inbox = await mail.inboxes.create({ username: "shift4-office", displayName: "Shift 4 Office Assistant", clientId: "shift4-office" });
say(`2. AgentMail inbox: ${inbox ? inbox.email || inbox.inboxId : "(would create shift4-office@agentmail.to)"}`);

// 3. Webhook to the site for new mail (find or create), and its signing secret.
let hook = (await mail.webhooks.list({ limit: 100 })).webhooks?.find((w) => w.url === HOOK);
if (!hook && GO && inbox) hook = await mail.webhooks.create({ url: HOOK, eventTypes: ["message.received"], inboxIds: [inbox.inboxId], clientId: "shift4-site-webhook" });
if (hook && !hook.secret) hook = await mail.webhooks.get(hook.webhookId);
say(`3. Webhook -> ${HOOK}: ${hook ? `ready (${hook.enabled === false ? "DISABLED" : "enabled"})` : "(would create)"}`);

// 4. Resend (optional): register the sending domain and show the DNS records to add in Cloudflare.
let from = null;
if (RESEND_API_KEY) {
  const H = { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" };
  const list = await (await fetch("https://api.resend.com/domains", { headers: H })).json();
  let dom = (list.data || []).find((d) => d.name === "shift4projects.com");
  if (!dom && GO) dom = await (await fetch("https://api.resend.com/domains", { method: "POST", headers: H, body: JSON.stringify({ name: "shift4projects.com" }) })).json();
  if (dom?.id) {
    const full = await (await fetch(`https://api.resend.com/domains/${dom.id}`, { headers: H })).json();
    say(`4. Resend domain shift4projects.com: ${full.status}`);
    if (full.status !== "verified") {
      say("   Add these in Cloudflare (shift4projects.com zone, DNS only), then re-run this script:");
      for (const r of full.records || []) say(`   ${r.type.padEnd(5)} ${String(r.name).padEnd(28)} ${r.value}${r.priority ? `  (priority ${r.priority})` : ""}`);
      if (GO) await fetch(`https://api.resend.com/domains/${dom.id}/verify`, { method: "POST", headers: H });
    } else from = "Shift 4 Projects <office@shift4projects.com>";
  } else say("4. Resend: (would register shift4projects.com as a sending domain)");
} else say("4. Resend key not set: digest and contact form emails stay off for now");

if (!GO) { say("\nDry run finished. Nothing changed."); process.exit(0); }
if (!inbox || !hook) die("inbox or webhook missing");

// 5. Hand the keys to Railway (one redeploy), without printing them.
const vars = {
  ANTHROPIC_API_KEY, AGENT_MODEL: MODEL, AGENTMAIL_API_KEY, AGENTMAIL_INBOX_ID: inbox.inboxId, AGENTMAIL_WEBHOOK_SECRET: hook.secret,
  AGENT_INTERNAL_DOMAINS: "shift4projects.com", DIGEST_TO, DIGEST_HOUR: "7", DIGEST_TZ: "America/Los_Angeles",
  ...(RESEND_API_KEY ? { RESEND_API_KEY, CONTACT_TO: DIGEST_TO } : {}), ...(from ? { CONTACT_FROM: from } : {}),
};
execFileSync("railway", ["variables", "-s", SERVICE, ...Object.entries(vars).flatMap(([k, v]) => ["--set", `${k}=${v}`])], { stdio: "ignore" });
say(`5. Railway: set ${Object.keys(vars).join(", ")}`);

// 6. Wait for the restart and confirm the assistant reports ready.
const admin = JSON.parse(execFileSync("railway", ["variables", "--json", "-s", SERVICE]).toString()).ADMIN_TOKEN;
let st = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  try { st = await (await fetch(`${SITE}/agent/status`, { headers: { Authorization: `Bearer ${admin}` } })).json(); if (st.enabled && st.agentmail) break; } catch { /* restarting */ }
}
if (!st?.enabled || !st?.agentmail) die(`assistant not reporting ready yet: ${JSON.stringify(st)}. Check the Railway deploy.`);
say(`6. Assistant is ON: ${JSON.stringify(st)}`);
say(`\nNEXT: in Google Workspace, forward office@shift4projects.com to  ${inbox.email || inbox.inboxId}`);
say("Google emails a confirmation code to that address first. Read it with:  node scripts/agent-switch-on.mjs --code");
say("Then forward one real job thread to office@ and ask Claude: \"list my jobs\".");
