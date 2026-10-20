// Project content. Copy is Shift 4's own (lifted from their current site / brief).
// SEED_PROJECTS is only the starting point: on first boot the server copies it into SQLite,
// and from then on the database is the source of truth (edited through the MCP / admin).
// The server injects the live list into the page as window.__PROJECTS__.
// Every photo URL has a sibling thumbnail at the same path ending in -sm.webp.

export type Discipline = "Video" | "Audio" | "Lighting" | "Staging";

export type Project = {
  slug: string;
  client: string;
  title: string;
  disciplines: Discipline[];
  summary: string;
  scope: string[];
  location?: string;
  /** May contain links written as [Name](https://…). */
  credits?: string;
  /** YouTube or Vimeo link, shown above the gallery. */
  video?: string;
  /** Full-size photo URLs, first one is the cover. */
  photos: string[];
  /** Shown in "Selected work" on the home page. */
  featured?: boolean;
};

const seed = (slug: string, n: number) =>
  Array.from({ length: n }, (_, i) => `/work/${slug}/${String(i + 1).padStart(2, "0")}.webp`);

export const DISCIPLINES: Discipline[] = ["Video", "Audio", "Lighting", "Staging"];

export const SEED_PROJECTS: Project[] = [
  {
    slug: "moroccanoil",
    client: "Moroccanoil",
    title: "LA Style Event",
    disciplines: ["Audio", "Lighting"],
    summary:
      "L-Acoustics sound systems venue-wide to support the DJ, welcome remarks, and step-and-repeat, ambient and product highlight lighting for both the guest and brand experience.",
    scope: ["L-Acoustics venue-wide audio", "DJ + welcome remarks support", "Step-and-repeat lighting", "Ambient + product highlight lighting"],
    photos: seed("moroccanoil", 6),
  },
  {
    slug: "indiewire",
    client: "IndieWire",
    title: "Pass the Remote (FYC)",
    disciplines: ["Audio", "Lighting"],
    summary:
      "Panel discussion support with professional microphone deployment and stage management, plus step-and-repeat and ambient lighting for the stage and guest environment.",
    scope: ["Panel microphones", "Stage management", "Step-and-repeat lighting", "Ambient stage + guest lighting"],
    photos: seed("indiewire", 4),
  },
  {
    slug: "monterey-car-week",
    client: "Monterey Car Week",
    title: "Panels, LED Wall and Red Carpet",
    disciplines: ["Video", "Audio", "Lighting"],
    summary:
      "Lighting and audio for panels, a full LED wall build, DJ backline, lighting design and technical direction, red carpet lighting and power distribution across the venue.",
    scope: ["Full LED wall build", "Panel audio + lighting", "DJ backline", "Lighting design + technical direction", "Red carpet lighting", "Power distribution"],
    location: "Monterey, CA",
    credits: "Production: AGENC, Los Angeles",
    photos: seed("monterey-car-week", 5),
  },
  {
    slug: "hulu",
    client: "Hulu",
    title: "Screening and After-Party",
    disciplines: ["Video", "Audio", "Lighting"],
    summary:
      "Projection and audio for the screening, lighting and sound for the after-party, and red carpet lighting.",
    scope: ["Screening projection + audio", "After-party lighting + sound", "Red carpet lighting"],
    location: "Petersen Automotive Museum, Los Angeles",
    credits: "Event production: AGENC",
    photos: seed("hulu", 1),
  },
  {
    slug: "mtv-challenge",
    client: "MTV Challenge",
    title: "LED Wall and 40-Foot Truss Arch",
    disciplines: ["Video", "Staging"],
    summary: "LED wall services and a truss arch for a 40-foot step-and-repeat installation.",
    scope: ["LED wall", "40-foot truss arch", "Step-and-repeat install"],
    location: "LA Coliseum, Los Angeles",
    credits: "Event production: AGENC",
    photos: seed("mtv-challenge", 2),
  },
  {
    slug: "amazon-countdown",
    client: "Amazon",
    title: "Countdown Premiere",
    disciplines: ["Staging"],
    summary: "A truss arch for a 30-foot step-and-repeat installation.",
    scope: ["30-foot truss arch", "Step-and-repeat install"],
    location: "Harmony Gold, Los Angeles",
    credits: "Production: AGENC",
    photos: seed("amazon-countdown", 1),
  },
  {
    slug: "instyle",
    client: "InStyle",
    title: "ImageMakers Awards",
    disciplines: ["Video", "Audio", "Lighting"],
    summary: "Video, lighting, audio and show crew support.",
    scope: ["Video", "Lighting", "Audio", "Show crew"],
    location: "Private estate, Bel Air",
    credits: "Production: AGENC",
    photos: seed("instyle", 1),
  },
  {
    slug: "video-village",
    client: "Video Village",
    title: "On-Site Monitoring",
    disciplines: ["Video"],
    summary: "Video Village.",
    scope: ["On-site monitoring"],
    photos: seed("video-village", 1),
  },
  {
    slug: "agenc-led",
    client: "Agenc",
    title: "70+ LED Tile Build",
    disciplines: ["Video", "Audio", "Lighting"],
    summary:
      "Over 70 LED tiles, L-Acoustics audio, lighting and motion graphics, all coming together in one build.",
    scope: ["70+ LED tiles", "L-Acoustics audio", "Lighting", "Motion graphics"],
    photos: seed("agenc-led", 3),
  },
  {
    slug: "dr-martens",
    client: "Dr. Martens",
    title: "Scenic With Hidden Audio",
    disciplines: ["Audio", "Lighting"],
    summary:
      "Working speakers built into the scenic and lighting mounted in the environment, keeping floors clear. Less gear in sight, same big impact.",
    scope: ["Speakers built into scenic", "Environment-mounted lighting"],
    photos: seed("dr-martens", 1),
  },
  {
    slug: "new-era-timberland",
    client: "New Era x Timberland",
    title: "Collaboration Release",
    disciplines: ["Video", "Audio", "Lighting"],
    summary: "Lighting, sound and projection support for the release event, produced with Highly Likely.",
    scope: ["Lighting", "Sound", "Projection"],
    credits: "Produced with Highly Likely",
    photos: seed("new-era-timberland", 3),
  },
  {
    slug: "cerave",
    client: "CeraVe",
    title: "Loud Luxury at LUME Studios",
    disciplines: ["Audio", "Lighting"],
    summary: "Performance lighting and DJ backline for a night in New York City.",
    scope: ["Performance lighting", "DJ backline"],
    location: "LUME Studios, New York City",
    photos: seed("cerave", 2),
  },
  {
    slug: "macys",
    client: "Macy’s",
    title: "100 Days to Parade Dinner",
    disciplines: ["Audio", "Lighting"],
    summary: "Lighting and sound for the influencer dinner in NYC.",
    scope: ["Lighting", "Sound"],
    location: "New York City",
    photos: seed("macys", 1),
  },
  {
    slug: "custom-dj-booth",
    client: "Custom DJ Booth",
    title: "CDJ-3000 Install",
    disciplines: ["Audio"],
    summary: "A custom fabricated booth with a built-in mouse hole that keeps cabling out of sight.",
    scope: ["Custom fabrication", "CDJ-3000 install", "Hidden cabling"],
    photos: seed("custom-dj-booth", 1),
  },
  {
    slug: "pixelbricks",
    client: "PixelBricks",
    title: "Battery-Powered Accents",
    disciplines: ["Lighting"],
    summary: "Compact, battery-powered fixtures that highlight special moments throughout an event.",
    scope: ["Battery-powered fixtures", "Accent lighting"],
    photos: seed("pixelbricks", 1),
  },
  // Sits last until photos arrive.
  {
    slug: "substack",
    client: "Substack",
    title: "Audrey & Friends",
    disciplines: ["Audio", "Lighting"],
    summary:
      "Comprehensive lighting and audio production, execution of the artist’s technical rider, and ambient lighting across indoor and outdoor environments for a cohesive, elevated atmosphere.",
    scope: ["Lighting + audio production", "Artist technical rider", "Indoor + outdoor ambient lighting"],
    photos: seed("substack", 0),
  },
];

export const img = (slug: string, n = 1, size: "sm" | "lg" = "lg") =>
  `/work/${slug}/${String(n).padStart(2, "0")}${size === "sm" ? "-sm" : ""}.webp`;

export const thumb = (url: string) => url.replace(/\.webp$/, "-sm.webp");
/** Let the browser pick the full-size file on big tiles and retina screens. */
export const srcSet = (url: string) => `${thumb(url)} 1000w, ${url} 2500w`;

/** Featured on the home page at first boot. After that it's a per-project flag in the DB. */
export const SEED_FEATURED = ["monterey-car-week", "agenc-led", "hulu", "new-era-timberland", "moroccanoil", "mtv-challenge"];

declare global { interface Window { __PROJECTS__?: Project[]; __DIMS__?: Record<string, [number, number]> } }
/** Photo width / height, injected by the server. Unknown photos are treated as 3:2. */
const DIMS: Record<string, [number, number]> = (typeof window !== "undefined" && window.__DIMS__) || {};
export const ratioOf = (url: string) => { const d = DIMS[url]; return d ? d[0] / d[1] : 1.5; };
/** Live, visible projects in display order. */
export const PROJECTS: Project[] =
  (typeof window !== "undefined" && window.__PROJECTS__) ||
  SEED_PROJECTS.map((p) => ({ ...p, featured: SEED_FEATURED.includes(p.slug) }));
export const FEATURED_PROJECTS = PROJECTS.filter((p) => p.featured);

export const CITIES = [
  { name: "Los Angeles", tz: "America/Los_Angeles" },
  { name: "Las Vegas", tz: "America/Los_Angeles" },
  { name: "Dallas", tz: "America/Chicago" },
  { name: "New York City", tz: "America/New_York" },
];

/**
 * Client logo row. Files live in /public/logos (originals in assets/logos-original).
 * `scale` balances visual weight: very wide wordmarks run smaller, compact marks larger.
 * `raw` logos are already baked white-on-dark (they have cut-outs a CSS whitening filter would erase).
 */
export const CLIENT_LOGOS: { name: string; file: string; scale: number; raw?: boolean }[] = [
  { name: "Hulu", file: "hulu.svg", scale: 0.9 },
  { name: "Amazon", file: "amazon.svg", scale: 1 },
  { name: "MTV", file: "mtv.svg", scale: 1.3 },
  { name: "Benefit", file: "benefit.svg", scale: 1 },
  { name: "Macy’s", file: "macys.svg", scale: 0.95 },
  { name: "InStyle", file: "instyle.svg", scale: 0.85 },
  { name: "Jaguar", file: "jaguar.svg", scale: 0.55 },
  { name: "Timberland", file: "timberland.svg", scale: 0.9 },
  { name: "CeraVe", file: "cerave.svg", scale: 1.05, raw: true },
  { name: "IndieWire", file: "indiewire.svg", scale: 0.75 },
  { name: "Dr. Martens", file: "drmartens.svg", scale: 1.15 },
  { name: "New Era", file: "newera.png", scale: 0.6 },
  { name: "Moroccanoil", file: "moroccanoil.png", scale: 0.42 },
  { name: "Substack", file: "substack.svg", scale: 0.85 },
  { name: "Cathay Pacific", file: "cathaypacific.svg", scale: 0.62 },
  { name: "AmorePacific", file: "amorepacific.svg", scale: 0.6 },
  { name: "a16z", file: "a16z.svg", scale: 1.1 },
];

export const CLIENTS = [
  "Hulu", "Amazon", "MTV", "Moroccanoil", "InStyle", "IndieWire", "CeraVe", "Macy’s",
  "Dr. Martens", "New Era", "Timberland", "Substack", "Monterey Car Week",
];
