import express, { type Express, type Request, type Response } from "express";
import { DISCIPLINES, type Discipline } from "../src/data/projects";
import { allLeads, leadsCsv } from "./db";
import { adminEnabled, checkPassword, endSession, hasSession, lockedOut, requireAdmin, startSession } from "./auth";
import {
  addPhoto, createProject, getProject, history, listProjects, reorderProjects,
  restoreVersion, setHidden, updateProject, type ProjectFields,
} from "./projects";

// JSON API behind /admin. Uses the same projects.ts functions as the MCP, so history and image
// processing behave identically whichever way Shift 4 edits the site.

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

/** Validates the editable text fields. `partial` allows leaving required ones out (for updates). */
function fieldsFrom(b: Record<string, unknown>, partial: boolean): Partial<ProjectFields> {
  const out: Partial<ProjectFields> = {};
  const client = str(b.client, 120), title = str(b.title, 160), summary = str(b.summary, 1200);
  if (client !== undefined) out.client = client;
  if (title !== undefined) out.title = title;
  if (summary !== undefined) out.summary = summary;
  if (b.location !== undefined) out.location = str(b.location, 160) || undefined;
  if (b.credits !== undefined) out.credits = str(b.credits, 240) || undefined;
  if (b.featured !== undefined) out.featured = !!b.featured;
  if (Array.isArray(b.disciplines)) out.disciplines = b.disciplines.filter((d) => DISCIPLINES.includes(d as Discipline)) as Discipline[];
  if (Array.isArray(b.scope)) out.scope = b.scope.map((s) => str(s, 120)).filter((s): s is string => !!s).slice(0, 20);

  const missing = (["client", "title", "summary"] as const).filter((k) => (partial ? out[k] === "" : !out[k]));
  if (missing.length) throw new Error(`Please fill in: ${missing.join(", ")}`);
  if ((!partial || out.disciplines) && !out.disciplines?.length) throw new Error("Pick at least one discipline");
  return out;
}

const wrap = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
};

const exists = (slug: string) => {
  const p = getProject(slug);
  if (!p) throw new Error(`No project with slug "${slug}"`);
  return p;
};

export function mountAdmin(app: Express) {
  const r = express.Router();
  r.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  r.get("/me", (req, res) => res.json({ enabled: adminEnabled(), signedIn: hasSession(req) }));

  r.post("/login", (req, res) => {
    const ip = req.ip || "unknown";
    if (!adminEnabled()) return res.status(503).json({ error: "Admin is not set up yet (ADMIN_PASSWORD)." });
    if (lockedOut(ip)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
    if (!checkPassword(ip, req.body?.password)) return res.status(401).json({ error: "Wrong password." });
    startSession(res);
    res.json({ ok: true });
  });

  r.post("/logout", (req, res) => { endSession(req, res); res.json({ ok: true }); });

  r.use(requireAdmin);

  r.get("/projects", (_req, res) => res.json(listProjects({ includeHidden: true })));

  r.get("/projects/:slug", wrap((req) => exists(req.params.slug)));

  r.post("/projects", wrap((req) => {
    const f = fieldsFrom(req.body ?? {}, false) as ProjectFields;
    return createProject({ ...f, scope: f.scope ?? [], hidden: req.body?.hidden !== false });
  }));

  r.put("/projects/:slug", wrap((req) => {
    exists(req.params.slug);
    return updateProject(req.params.slug, fieldsFrom(req.body ?? {}, true), "admin edit");
  }));

  r.post("/projects/:slug/hidden", wrap((req) => setHidden(exists(req.params.slug).slug, !!req.body?.hidden)));

  r.post("/reorder", wrap((req) => {
    const slugs = req.body?.slugs;
    if (!Array.isArray(slugs) || !slugs.every((s) => typeof s === "string")) throw new Error("slugs must be a list");
    return reorderProjects(slugs);
  }));

  // Raw image body (what the browser sends for a File). sharp resizes it to 2500 + 1000px WebP.
  r.post("/projects/:slug/photos", express.raw({ type: "image/*", limit: "30mb" }), wrap(async (req) => {
    exists(req.params.slug);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error("No image received");
    const pos = req.query.position === undefined ? undefined : Number(req.query.position);
    return addPhoto(req.params.slug, { buffer: req.body }, Number.isFinite(pos) ? pos : undefined);
  }));

  // Reorder or remove: the new list must only contain photos the project already has (same rule as the MCP).
  r.put("/projects/:slug/photos", wrap((req) => {
    const p = exists(req.params.slug);
    const photos = req.body?.photos;
    if (!Array.isArray(photos)) throw new Error("photos must be a list");
    const bad = photos.filter((u) => !p.photos.includes(u));
    if (bad.length) throw new Error("Some of those photos don't belong to this project. Reload and try again.");
    return updateProject(p.slug, { photos: [...new Set(photos as string[])] }, "set photos");
  }));

  r.get("/projects/:slug/history", wrap((req) => history(exists(req.params.slug).slug, 30).map((h) => {
    const d = JSON.parse(h.data);
    return { id: h.id, action: h.action, at: h.created_at, title: d.title, photos: d.photos.length, hidden: !!h.hidden };
  })));

  r.post("/history/:id/restore", wrap((req) => {
    const id = Number(req.params.id);
    const h = history(String(req.body?.slug ?? ""), 1000).find((x) => x.id === id);
    if (!h) throw new Error("That version isn't part of this project");
    return restoreVersion(id);
  }));

  r.get("/inquiries", (_req, res) => res.json(allLeads().map(({ ip: _ip, ...l }) => l)));

  r.get("/inquiries.csv", (_req, res) => {
    const day = new Date().toISOString().slice(0, 10);
    res.type("text/csv").attachment(`shift4-inquiries-${day}.csv`).send(leadsCsv());
  });

  app.use("/api/admin", r);
}
