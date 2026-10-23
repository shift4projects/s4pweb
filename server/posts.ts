import { db } from "./db";
import { markdownToHtml, markdownToText } from "./markdown";

// Insights posts (the articles section). Stored as Markdown, rendered on the way out.
// Drafts are invisible everywhere on the site; only "published" posts appear in the list, sitemap and llms.txt.
// The whole section is off until INSIGHTS_ENABLED=1, so Will can approve the design before anything shows.

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    excerpt TEXT,
    body TEXT NOT NULL,
    cover TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    faq TEXT NOT NULL DEFAULT '[]',          -- [{q, a}] shown at the end and emitted as FAQPage schema
    status TEXT NOT NULL DEFAULT 'draft',    -- draft | published
    published_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export type PostRow = {
  slug: string; title: string; excerpt: string | null; body: string; cover: string | null; tags: string; faq: string;
  status: string; published_at: string | null; created_at: string; updated_at: string;
};
export type Post = Omit<PostRow, "tags" | "faq"> & { tags: string[]; faq: { q: string; a: string }[]; html: string; text: string; words: number; reading_min: number };

export const insightsEnabled = () => process.env.INSIGHTS_ENABLED === "1";

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 80);

function hydrate(r: PostRow): Post {
  const text = markdownToText(r.body);
  const words = text.split(/\s+/).filter(Boolean).length;
  return { ...r, tags: JSON.parse(r.tags || "[]"), faq: JSON.parse(r.faq || "[]"), html: markdownToHtml(r.body), text, words, reading_min: Math.max(1, Math.round(words / 220)) };
}

export const listPosts = (includeDrafts = false): Post[] =>
  (db.prepare(includeDrafts ? "SELECT * FROM posts ORDER BY COALESCE(published_at, created_at) DESC" : "SELECT * FROM posts WHERE status = 'published' ORDER BY published_at DESC").all() as PostRow[]).map(hydrate);
export const getPost = (slug: string, includeDrafts = false): Post | undefined => {
  const r = db.prepare("SELECT * FROM posts WHERE slug = ?").get(slug) as PostRow | undefined;
  return r && (includeDrafts || r.status === "published") ? hydrate(r) : undefined;
};

export type PostFields = { title: string; body: string; excerpt?: string | null; cover?: string | null; tags?: string[]; faq?: { q: string; a: string }[]; slug?: string };

export function createPost(f: PostFields): Post {
  let slug = slugify(f.slug || f.title) || "post";
  for (let n = 2; db.prepare("SELECT 1 FROM posts WHERE slug = ?").get(slug); n++) slug = `${slugify(f.slug || f.title)}-${n}`;
  db.prepare("INSERT INTO posts (slug, title, excerpt, body, cover, tags, faq) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(slug, f.title, f.excerpt ?? null, f.body, f.cover ?? null, JSON.stringify(f.tags ?? []), JSON.stringify(f.faq ?? []));
  return getPost(slug, true)!;
}

export function updatePost(slug: string, patch: Partial<PostFields>): Post {
  const cur = db.prepare("SELECT * FROM posts WHERE slug = ?").get(slug) as PostRow | undefined;
  if (!cur) throw new Error(`No post "${slug}"`);
  const next = {
    title: patch.title ?? cur.title, body: patch.body ?? cur.body, excerpt: patch.excerpt === undefined ? cur.excerpt : patch.excerpt,
    cover: patch.cover === undefined ? cur.cover : patch.cover, tags: patch.tags ? JSON.stringify(patch.tags) : cur.tags, faq: patch.faq ? JSON.stringify(patch.faq) : cur.faq,
  };
  db.prepare("UPDATE posts SET title = ?, body = ?, excerpt = ?, cover = ?, tags = ?, faq = ?, updated_at = datetime('now') WHERE slug = ?")
    .run(next.title, next.body, next.excerpt, next.cover, next.tags, next.faq, slug);
  return getPost(slug, true)!;
}

export function setPublished(slug: string, published: boolean): Post {
  if (!db.prepare("SELECT 1 FROM posts WHERE slug = ?").get(slug)) throw new Error(`No post "${slug}"`);
  db.prepare("UPDATE posts SET status = ?, published_at = CASE WHEN ? THEN COALESCE(published_at, datetime('now')) ELSE published_at END, updated_at = datetime('now') WHERE slug = ?")
    .run(published ? "published" : "draft", published ? 1 : 0, slug);
  return getPost(slug, true)!;
}

export function deletePost(slug: string) {
  const r = db.prepare("DELETE FROM posts WHERE slug = ?").run(slug);
  if (!r.changes) throw new Error(`No post "${slug}"`);
}

/** What the website receives: no Markdown source, just rendered HTML and metadata. */
export const publicPosts = () => (insightsEnabled() ? listPosts() : []).map(({ body: _b, ...p }) => p);
