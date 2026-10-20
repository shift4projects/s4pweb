import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { SEED_FEATURED, SEED_PROJECTS, type Discipline, type Project } from "../src/data/projects";
import { dataDir, db } from "./db";

// Projects live in SQLite. Each row keeps the project as JSON plus its position and visibility.
// Every content change writes a full snapshot to project_history so anything can be rolled back.
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    slug TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS project_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    action TEXT NOT NULL,
    data TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export const uploadsDir = path.join(dataDir, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

type Row = { slug: string; position: number; hidden: number; data: string; updated_at: string };
export type StoredProject = Project & { hidden: boolean; position: number; updated_at: string };

const parse = (r: Row): StoredProject => ({ ...(JSON.parse(r.data) as Project), slug: r.slug, hidden: !!r.hidden, position: r.position, updated_at: r.updated_at });

function record(slug: string, action: string) {
  const r = db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as Row | undefined;
  if (r) db.prepare("INSERT INTO project_history (slug, action, data, hidden) VALUES (?, ?, ?, ?)").run(slug, action, r.data, r.hidden);
}

// First boot: copy the seed list into the database.
if ((db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n === 0) {
  const ins = db.prepare("INSERT INTO projects (slug, position, data) VALUES (?, ?, ?)");
  SEED_PROJECTS.forEach((p, i) => {
    const { slug, ...rest } = p;
    ins.run(slug, (i + 1) * 10, JSON.stringify({ ...rest, featured: SEED_FEATURED.includes(slug) }));
    record(slug, "seed");
  });
}

export function listProjects({ includeHidden = false } = {}): StoredProject[] {
  const rows = db.prepare(`SELECT * FROM projects ${includeHidden ? "" : "WHERE hidden = 0"} ORDER BY position, slug`).all() as Row[];
  return rows.map(parse);
}

export function getProject(slug: string): StoredProject | undefined {
  const r = db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as Row | undefined;
  return r && parse(r);
}

/** Public shape for the website (no internal fields). */
export const publicProjects = (): Project[] =>
  listProjects().map(({ hidden: _h, position: _p, updated_at: _u, ...p }) => p);

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);

export type ProjectFields = {
  client: string; title: string; disciplines: Discipline[]; summary: string; scope: string[];
  location?: string; credits?: string; featured?: boolean;
};

export function createProject(f: ProjectFields & { hidden?: boolean; slug?: string }): StoredProject {
  let slug = slugify(f.slug || `${f.client} ${f.title}`) || "project";
  for (let n = 2; getProject(slug); n++) slug = `${slugify(f.slug || `${f.client} ${f.title}`)}-${n}`;
  const top = (db.prepare("SELECT MIN(position) AS m FROM projects").get() as { m: number | null }).m ?? 10;
  const { hidden, slug: _s, ...fields } = f;
  const data: Omit<Project, "slug"> = { ...fields, photos: [] };
  // New work goes to the top of the list.
  db.prepare("INSERT INTO projects (slug, position, hidden, data) VALUES (?, ?, ?, ?)").run(slug, top - 10, hidden ? 1 : 0, JSON.stringify(data));
  record(slug, "create");
  return getProject(slug)!;
}

export function updateProject(slug: string, patch: Partial<ProjectFields> & { photos?: string[] }, action = "update"): StoredProject {
  const cur = getProject(slug);
  if (!cur) throw new Error(`No project with slug "${slug}"`);
  const { hidden: _h, position: _p, updated_at: _u, slug: _s, ...data } = cur;
  const next = { ...data, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  db.prepare("UPDATE projects SET data = ?, updated_at = datetime('now') WHERE slug = ?").run(JSON.stringify(next), slug);
  record(slug, action);
  return getProject(slug)!;
}

export function setHidden(slug: string, hidden: boolean): StoredProject {
  if (!getProject(slug)) throw new Error(`No project with slug "${slug}"`);
  db.prepare("UPDATE projects SET hidden = ?, updated_at = datetime('now') WHERE slug = ?").run(hidden ? 1 : 0, slug);
  record(slug, hidden ? "hide" : "show");
  return getProject(slug)!;
}

/** Puts the given slugs first, in that order; everything else keeps its relative order after them. */
export function reorderProjects(slugs: string[]): StoredProject[] {
  const all = listProjects({ includeHidden: true });
  const unknown = slugs.filter((s) => !all.some((p) => p.slug === s));
  if (unknown.length) throw new Error(`Unknown slugs: ${unknown.join(", ")}`);
  const order = [...slugs, ...all.map((p) => p.slug).filter((s) => !slugs.includes(s))];
  const upd = db.prepare("UPDATE projects SET position = ? WHERE slug = ?");
  order.forEach((s, i) => upd.run((i + 1) * 10, s));
  return listProjects({ includeHidden: true });
}

export function history(slug: string, limit = 20) {
  return db.prepare("SELECT id, action, created_at, data, hidden FROM project_history WHERE slug = ? ORDER BY id DESC LIMIT ?").all(slug, limit) as
    { id: number; action: string; created_at: string; data: string; hidden: number }[];
}

export function restoreVersion(historyId: number): StoredProject {
  const h = db.prepare("SELECT * FROM project_history WHERE id = ?").get(historyId) as { slug: string; data: string; hidden: number } | undefined;
  if (!h) throw new Error(`No history entry ${historyId}`);
  if (getProject(h.slug)) {
    db.prepare("UPDATE projects SET data = ?, hidden = ?, updated_at = datetime('now') WHERE slug = ?").run(h.data, h.hidden, h.slug);
  } else {
    const top = (db.prepare("SELECT MIN(position) AS m FROM projects").get() as { m: number | null }).m ?? 10;
    db.prepare("INSERT INTO projects (slug, position, hidden, data) VALUES (?, ?, ?, ?)").run(h.slug, top - 10, h.hidden, h.data);
  }
  record(h.slug, `restore #${historyId}`);
  return getProject(h.slug)!;
}

const MAX_BYTES = 30 * 1024 * 1024;

async function fetchImage(url: string): Promise<Buffer> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Image URL must be http(s)");
  const res = await fetch(u, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
  if (!res.ok) throw new Error(`Could not download image (${res.status})`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new Error("Image is larger than 30MB");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("Image is larger than 30MB");
  return buf;
}

/** Saves a full-size (2500px) and thumbnail (1000px) WebP; returns the public URL of the full-size file. */
async function storeImage(slug: string, input: Buffer): Promise<string> {
  const meta = await sharp(input).metadata().catch(() => null);
  if (!meta?.format) throw new Error("That file is not an image sharp can read (use JPG, PNG, WebP, HEIC or TIFF)");
  const dir = path.join(uploadsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const base = sharp(input).rotate();
  await base.clone().resize({ width: 2500, withoutEnlargement: true }).webp({ quality: 86 }).toFile(path.join(dir, `${id}.webp`));
  await base.clone().resize({ width: 1000, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(dir, `${id}-sm.webp`));
  return `/uploads/${slug}/${id}.webp`;
}

export async function addPhoto(slug: string, src: { url?: string; base64?: string; buffer?: Buffer }, position?: number): Promise<StoredProject> {
  const cur = getProject(slug);
  if (!cur) throw new Error(`No project with slug "${slug}"`);
  let buf: Buffer;
  if (src.buffer) buf = src.buffer;
  else if (src.url) buf = await fetchImage(src.url);
  else if (src.base64) buf = Buffer.from(src.base64.replace(/^data:[^,]+,/, ""), "base64");
  else throw new Error("Pass image_url or image_base64");
  if (buf.length > MAX_BYTES) throw new Error("Image is larger than 30MB");
  const url = await storeImage(slug, buf);
  const photos = [...cur.photos];
  const at = position === undefined ? photos.length : Math.max(0, Math.min(photos.length, position));
  photos.splice(at, 0, url);
  return updateProject(slug, { photos }, "add photo");
}
