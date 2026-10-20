import path from "node:path";
import sharp from "sharp";
import { listProjects, uploadsDir } from "./projects";

// Width/height of every project photo, sent with the page so the gallery can lay out
// uncropped photos without jumping around while they load. Reads only image headers.
const cache = new Map<string, [number, number]>();
export const fileFor = (url: string) =>
  url.startsWith("/uploads/")
    ? path.join(uploadsDir, url.slice("/uploads/".length))
    : path.join(process.env.NODE_ENV === "production" ? "dist" : "public", url);

async function measure(url: string) {
  if (cache.has(url)) return;
  try {
    const m = await sharp(fileFor(url)).metadata();
    if (m.width && m.height) cache.set(url, [m.width, m.height]);
  } catch { /* missing file: the client falls back to a default shape */ }
}

let running: Promise<void> | null = null;
/** Measures any photo not seen yet. Safe to call often; only new photos cost anything. */
export function measureAll() {
  running ??= (async () => {
    for (const p of listProjects({ includeHidden: true })) for (const u of p.photos) await measure(u);
  })().finally(() => { running = null; });
  return running;
}

export const dimsFor = (urls: string[]) =>
  Object.fromEntries(urls.filter((u) => cache.has(u)).map((u) => [u, cache.get(u)!]));
