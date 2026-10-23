import type { Express } from "express";
import path from "node:path";
import sharp from "sharp";
import { SERVICES } from "../src/data/services";
import { fileFor } from "./photoDims";
import { publicProjects } from "./projects";
import { getPost, insightsEnabled, listPosts } from "./posts";
import { jsonLdTag, knownPath, verificationTags } from "./seo";

// Link previews (iMessage, WhatsApp, Slack, Facebook, LinkedIn). Those crawlers don't run JavaScript,
// so every page's title, description and share image are written into the HTML on the server.

const SITE = () => (process.env.SITE_URL || "https://shift4projects.com").replace(/\/$/, "");
const BRAND = "Shift 4 Projects";
const DEFAULT_DESC = "Los Angeles event technology and production company: LED walls, audio, lighting, animation and motion, event capture and event WiFi, with crew. Events of any scale in LA, Las Vegas, Dallas and New York.";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);

type Meta = { title: string; description: string; image: string; type?: "website" | "article" };

function metaFor(pathname: string): Meta {
  const base: Meta = { title: `${BRAND} | Event Technology & Production, Los Angeles`, description: DEFAULT_DESC, image: "/og/default.jpg" };
  const m = pathname.match(/^\/projects\/([^/]+)\/?$/);
  if (m) {
    const p = publicProjects().find((x) => x.slug === m[1]);
    if (p) return {
      title: `${p.client}: ${p.title}${p.location ? `, ${p.location}` : ""} | ${BRAND}`,
      description: clip(`${p.disciplines.join(", ")} for ${p.client}${p.location ? ` in ${p.location}` : ""}. ${p.summary}`),
      image: p.photos.length ? `/og/project/${p.slug}.jpg` : base.image,
    };
  }
  if (/^\/projects\/?$/.test(pathname)) return { ...base, title: `Projects | ${BRAND}`, description: `${publicProjects().length} event production projects: LED walls, audio, lighting and staging for ${Array.from(new Set(publicProjects().map((x) => x.client))).slice(0, 6).join(", ")} and more, in Los Angeles, Las Vegas, New York and beyond.` };
  if (/^\/services\/?$/.test(pathname)) return { ...base, title: `Event Production Services | ${BRAND}`, description: `${SERVICES.map((s) => s.title).join(", ")}. Event tech rentals and hands-on production support in Los Angeles and nationwide, for projects of any scale.` };
  const svc = SERVICES.find((s) => s.page && pathname.replace(/\/$/, "") === s.page);
  if (svc) return { ...base, title: `${svc.title} for Events, Los Angeles | ${BRAND}`, description: clip(svc.copy) };
  if (/^\/insights\/?$/.test(pathname) && insightsEnabled()) return { ...base, title: `Insights | ${BRAND}`, description: "Notes from the floor: how we plan, build and run event technology, from LED walls and audio to event WiFi." };
  const post = pathname.match(/^\/insights\/([^/]+)\/?$/);
  if (post && insightsEnabled()) {
    const x = getPost(post[1]);
    if (x) return { title: `${x.title} | ${BRAND}`, description: clip(x.excerpt || x.text), image: x.cover || base.image, type: "article" };
  }
  if (/^\/contact\/?$/.test(pathname)) return { ...base, title: `Contact | ${BRAND}`, description: "Tell us about your upcoming event and get a quote. Event technology and production in Los Angeles, Las Vegas, Dallas and New York City." };
  return base;
}

/** Replaces the template's title/description/OG tags with the right ones for this URL. */
export function withMeta(html: string, pathname: string): string {
  const meta = metaFor(pathname);
  const url = SITE() + pathname;
  const image = meta.image.startsWith("http") ? meta.image : SITE() + meta.image;
  const missing = !knownPath(pathname);
  const tags = [
    `<title>${esc(missing ? `Not found | ${BRAND}` : meta.title)}</title>`,
    missing ? `<meta name="robots" content="noindex" />` : `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />`,
    verificationTags(),
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="${meta.type || "website"}" />`,
    `<meta property="og:site_name" content="${BRAND}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(meta.title)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    missing ? "" : jsonLdTag(pathname),
  ].filter(Boolean).join("\n    ");
  return html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta (?:name="description"|property="og:[^"]+"|name="twitter:[^"]+")[^>]*>\s*/gi, "")
    .replace(/<link rel="canonical"[^>]*>\s*/i, "")
    .replace("</head>", `    ${tags}\n  </head>`);
}

/** /og/project/<slug>.jpg: the project's cover cropped to 1200x630 with the logo, cached in memory. */
export function mountOgImages(app: Express) {
  const cache = new Map<string, { key: string; buf: Buffer }>();
  const logo = path.resolve(process.env.NODE_ENV === "production" ? "dist" : "public", "img/logo-white.png");

  app.get("/og/project/:slug.jpg", async (req, res) => {
    const p = publicProjects().find((x) => x.slug === req.params.slug);
    if (!p || !p.photos.length) return res.redirect(302, "/og/default.jpg");
    const cover = p.photos[0];
    try {
      let hit = cache.get(p.slug);
      if (!hit || hit.key !== cover) {
        const badge = await sharp(logo).resize({ width: 230 }).png().toBuffer();
        const shade = Buffer.from('<svg width="1200" height="630"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#0a0a0b" stop-opacity="0"/><stop offset="1" stop-color="#0a0a0b" stop-opacity="0.75"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/></svg>');
        const buf = await sharp(fileFor(cover)).rotate().resize(1200, 630, { fit: "cover", position: "attention" })
          .composite([{ input: shade }, { input: badge, left: 48, top: 630 - 48 - 100 }])
          .jpeg({ quality: 84, mozjpeg: true }).toBuffer();
        hit = { key: cover, buf };
        cache.set(p.slug, hit);
      }
      res.type("jpg").set("Cache-Control", "public, max-age=3600").send(hit.buf);
    } catch (e) {
      console.error("[og]", e);
      res.redirect(302, "/og/default.jpg");
    }
  });
}
