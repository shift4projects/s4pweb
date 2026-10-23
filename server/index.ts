import express from "express";
import fs from "node:fs";
import path from "node:path";
import { leadsCsv, markAutoReplied, markEmailed, recentlyAutoReplied, saveLead } from "./db";
import { mountAdmin } from "./admin";
import { sendAutoReply, sendLeadEmail } from "./mail";
import { mountMcp } from "./mcp";
import { mountOAuth } from "./oauth";
import { publicProjects, uploadsDir } from "./projects";
import { dimsFor, measureAll } from "./photoDims";
import { mountOgImages, withMeta } from "./meta";
import { trackingTags } from "./tracking";
import { mountAgent } from "./agent/routes";
import { knownPath, mountSeo, prerender } from "./seo";
import { publicPosts } from "./posts";

const app = express();
const PORT = Number(process.env.PORT) || 5260;
const prod = process.env.NODE_ENV === "production";

// One proxy hop on Railway: req.ip is the visitor, and rate limiters can trust it.
app.set("trust proxy", 1);

// Other domains Shift 4 owns (REDIRECT_HOSTS, comma separated) forward page visits to the main one (SITE_URL),
// so old links and search results keep working and there's only one copy of the site.
const redirectHosts = new Set((process.env.REDIRECT_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));
app.use((req, res, next) => {
  const site = process.env.SITE_URL;
  if (!site || !redirectHosts.has(req.hostname.toLowerCase()) || (req.method !== "GET" && req.method !== "HEAD")) return next();
  res.redirect(301, site.replace(/\/$/, "") + req.originalUrl);
});
// MCP calls can carry base64 photos, so they get a bigger body limit than the contact form.
const smallJson = express.json({ limit: "32kb" });
const bigJson = express.json({ limit: "45mb" });
// The inbox assistant's webhook needs the raw body (signature check), so it parses its own.
app.use((req, res, next) => (req.path.startsWith("/agent/") ? next() : (req.path.startsWith("/mcp") ? bigJson : smallJson)(req, res, next)));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/projects", (_req, res) => res.set("Cache-Control", "no-cache").json(publicProjects()));
app.use("/uploads", express.static(uploadsDir, { maxAge: "30d", immutable: true }));
mountOAuth(app);
mountMcp(app);
mountOgImages(app);
mountAdmin(app);
mountAgent(app);
mountSeo(app);

/** Puts the live project list (and the tracking tags, when configured) into the page so the site never shows stale or hidden work. */
const tags = trackingTags();
const inject = (html: string, pathname = "/") => {
  const projects = publicProjects();
  const dims = dimsFor(projects.flatMap((p) => p.photos));
  const data = JSON.stringify(projects).replace(/</g, "\\u003c");
  const posts = pathname.startsWith("/insights") ? `;window.__POSTS__=${JSON.stringify(publicPosts()).replace(/</g, "\\u003c")}` : "";
  // Home: fetch the hero still right away so it's on screen the moment the page renders (it matches the video's first frame).
  const heroPreload = pathname === "/"
    ? `<link rel="preload" as="image" href="/video/hero-poster-mobile.jpg" media="(max-width: 760px)"><link rel="preload" as="image" href="/video/hero-poster.jpg" media="(min-width: 761px)">`
    : "";
  // Crawlers that don't run JavaScript (link previews, most AI assistants) read the server-rendered copy inside #root; React replaces it on load.
  return withMeta(html, pathname)
    .replace("</head>", `${heroPreload}<script>window.__PROJECTS__=${data};window.__DIMS__=${JSON.stringify(dims)}${posts}</script>${tags}</head>`)
    .replace('<div id="root"></div>', `<div id="root">${prerender(pathname)}</div>`);
};

// Tiny in-memory rate limit: 5 submissions per IP per 10 minutes.
const hits = new Map<string, number[]>();
const limited = (ip: string) => {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
};

const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

app.post("/api/contact", async (req, res) => {
  const b = req.body ?? {};
  if (clean(b.website)) return res.json({ ok: true }); // honeypot: pretend success
  const ip = req.ip || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many requests. Please try again in a few minutes." });

  const lead = {
    name: clean(b.name, 120),
    email: clean(b.email, 200),
    company: clean(b.company, 160) || undefined,
    phone: clean(b.phone, 40) || undefined,
    services: Array.isArray(b.services) ? b.services.map((s: unknown) => clean(s, 40)).filter(Boolean).join(", ") || undefined : undefined,
    event_date: clean(b.date, 80) || undefined,
    city: clean(b.city, 80) || undefined,
    message: clean(b.message, 5000),
    ip,
  };
  if (!lead.name || !lead.message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    return res.status(400).json({ error: "Please add your name, a valid email and a few details about the event." });
  }

  const repeat = recentlyAutoReplied(lead.email);
  const id = saveLead(lead);
  const [notified, replied] = await Promise.allSettled([sendLeadEmail(lead), repeat ? Promise.resolve(false) : sendAutoReply(lead)]);
  if (notified.status === "fulfilled" && notified.value) markEmailed(id);
  else if (notified.status === "rejected") console.error("[mail] notify failed", notified.reason);
  if (replied.status === "fulfilled" && replied.value) markAutoReplied(id);
  else if (replied.status === "rejected") console.error("[mail] auto-reply failed", replied.reason);
  res.json({ ok: true });
});

// CSV export for the client: GET /api/leads.csv?token=ADMIN_TOKEN
app.get("/api/leads.csv", (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.query.token !== token) return res.status(404).end();
  res.type("text/csv").send(leadsCsv());
});

async function start() {
  await measureAll();
  if (!prod) {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
    app.use(vite.middlewares);
    app.get(["/admin", "/admin/*"], async (req, res, next) => {
      try {
        const html = await vite.transformIndexHtml(req.originalUrl, fs.readFileSync("admin.html", "utf8"));
        res.type("html").set("Cache-Control", "no-store").send(html);
      } catch (e) { next(e); }
    });
    app.get("*", async (req, res, next) => {
      try {
        await measureAll(); // new uploads get measured before the page is built (cached photos cost nothing)
        const html = await vite.transformIndexHtml(req.originalUrl, fs.readFileSync("index.html", "utf8"));
        res.status(knownPath(req.path) ? 200 : 404).type("html").set("Cache-Control", "no-cache").send(inject(html, req.path));
      } catch (e) { next(e); }
    });
  } else {
    const dist = path.resolve("dist");
    const shell = fs.readFileSync(path.join(dist, "index.html"), "utf8");
    app.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "1y" }));
    const adminShell = fs.readFileSync(path.join(dist, "admin.html"), "utf8");
    app.get(["/admin", "/admin/*", "/admin.html"], (_req, res) => res.type("html").set("Cache-Control", "no-store").send(adminShell));
    // Photos, videos and logos keep the same file names when they're swapped or fixed, so browsers
    // revalidate them (cheap 304s via ETag) instead of holding a stale copy for an hour.
    app.use(express.static(dist, { maxAge: 0, index: false }));
    app.get("*", async (req, res) => {
      await measureAll(); // new uploads get measured before the page is built (cached photos cost nothing)
      res.status(knownPath(req.path) ? 200 : 404).type("html").set("Cache-Control", "no-cache").send(inject(shell, req.path));
    });
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`Shift 4 Projects on http://localhost:${PORT}`));
}

start();
