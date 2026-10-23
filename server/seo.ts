import type { Express } from "express";
import { CITIES, CLIENT_LOGOS, type Project } from "../src/data/projects";
import { SERVICES } from "../src/data/services";
import { getPost, insightsEnabled, listPosts, type Post } from "./posts";
import { publicProjects } from "./projects";

// Search and answer-engine plumbing: robots.txt, sitemap.xml, llms.txt, structured data (JSON-LD),
// a server-rendered copy of each page's content for crawlers that don't run JavaScript, and real 404s.

export const SITE = () => (process.env.SITE_URL || "https://shift4projects.com").replace(/\/$/, "");
export const BRAND = "Shift 4 Projects";
const INSTAGRAM = "https://instagram.com/shift4projects";
const ABOUT = "A full-service event technology and production company based in Los Angeles. Event tech rentals and hands-on production support, from LED walls to audio systems, for projects of any scale, from single-day installs to multi-city activations.";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cities = CITIES.map((c) => c.name);
const clientNames = () => Array.from(new Set(publicProjects().map((p) => p.client)));
const STATIC_PATHS = ["/", "/projects", "/services", "/contact", ...SERVICES.flatMap((s) => (s.page ? [s.page] : []))];

/** Does this URL exist? Unknown ones get a 404 status so search engines don't index empty pages. */
export function knownPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (STATIC_PATHS.includes(p)) return true;
  const proj = p.match(/^\/projects\/([^/]+)$/);
  if (proj) return publicProjects().some((x) => x.slug === proj[1]);
  if (insightsEnabled()) {
    if (p === "/insights") return true;
    const post = p.match(/^\/insights\/([^/]+)$/);
    if (post) return !!getPost(post[1]);
  }
  return false;
}

/* ---------- FAQs (answers come from the site's own copy, nothing invented) ---------- */

export const FAQS: { q: string; a: string; on: string[] }[] = [
  { on: ["/", "/services"], q: "What services does Shift 4 Projects offer?", a: `${SERVICES.map((s) => s.title).join(", ")}. We handle both the equipment and the people to run it, from LED walls and audio systems to lighting design and on-site crew.` },
  { on: ["/", "/services", "/contact"], q: "Where is Shift 4 Projects based, and where do you work?", a: `We're based in Los Angeles and regularly produce events in ${cities.slice(0, -1).join(", ")} and ${cities.at(-1)}. We travel for multi-city activations and destination events.` },
  { on: ["/", "/services"], q: "What size of event can Shift 4 Projects handle?", a: "Any scale. From intimate panels and private dinners to large-scale performances, premieres and multi-day brand activations, single-day installs to multi-city tours." },
  { on: ["/", "/wifi-solutions"], q: "Do you provide WiFi for events?", a: "Yes. We deploy enterprise-grade event WiFi with a site survey and network plan, dedicated bandwidth (no shared public networks), scalable coverage and on-site technical support, including in places standard providers can't reach: deserts, private estates, rooftops and underground venues." },
  { on: ["/wifi-solutions"], q: "What can run on your event network?", a: "Live streaming, digital activations, point-of-sale systems and production comms. Coverage scales from small gatherings to large productions." },
  { on: ["/", "/services", "/projects"], q: "Who has Shift 4 Projects worked with?", a: `Recent work includes ${clientNames().slice(0, 10).join(", ")} and more. See the Projects page for photos and scope on each one.` },
  { on: ["/services"], q: "Do you rent equipment, or run the whole production?", a: "Both. We offer event technology rentals and hands-on production support: design, install, operation and strike by our own crew." },
  { on: ["/", "/services", "/contact"], q: "How do I get a quote?", a: "Use the contact form with your event date, city and a few details about the venue and what you need. We'll come back with questions and a proposal." },
  { on: ["/animation-motion-design"], q: "What does Shift 4 Projects' animation and motion design cover?", a: "Custom motion graphics and animation for live events, branded experiences, LED walls, social content and digital displays: 2D and 3D animation, LED wall content, event visuals and brand storytelling, from concept to final delivery." },
];
const faqsFor = (p: string) => FAQS.filter((f) => f.on.includes(p));

/* ---------- JSON-LD ---------- */

const org = () => ({
  "@type": "Organization", "@id": `${SITE()}/#org`, name: BRAND, alternateName: ["Shift4Projects", "Shift4 Projects"],
  url: SITE(), logo: `${SITE()}/icon-512.png`, image: `${SITE()}/og/default.jpg`, description: ABOUT, sameAs: [INSTAGRAM],
  areaServed: cities.map((c) => ({ "@type": "City", name: c })),
  address: { "@type": "PostalAddress", addressLocality: "Los Angeles", addressRegion: "CA", addressCountry: "US" },
  knowsAbout: ["Event production", "LED walls", "Event audio", "Event lighting", "Projection", "Motion graphics", "Event WiFi", "Staging"],
  hasOfferCatalog: { "@type": "OfferCatalog", name: "Services", itemListElement: SERVICES.map((s) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.title, url: SITE() + (s.page || `/services#${s.slug}`) } })) },
});
const website = () => ({ "@type": "WebSite", "@id": `${SITE()}/#site`, url: SITE(), name: BRAND, publisher: { "@id": `${SITE()}/#org` }, inLanguage: "en-US" });
const crumbs = (items: [string, string][]) => ({ "@type": "BreadcrumbList", itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: SITE() + url })) });
const faqPage = (p: string) => { const f = faqsFor(p); return f.length ? [{ "@type": "FAQPage", mainEntity: f.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })) }] : []; };
const service = (s: (typeof SERVICES)[number]) => ({
  "@type": "Service", name: s.title, serviceType: s.title, description: s.copy, provider: { "@id": `${SITE()}/#org` }, areaServed: cities.map((c) => ({ "@type": "City", name: c })),
  url: SITE() + (s.page || `/services#${s.slug}`), hasOfferCatalog: { "@type": "OfferCatalog", name: s.title, itemListElement: s.list.map((n) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: n } })) },
});
const projectWork = (p: Project) => ({
  "@type": "CreativeWork", "@id": `${SITE()}/projects/${p.slug}#work`, name: `${p.client}: ${p.title}`, headline: `${p.client}: ${p.title}`,
  description: p.summary, url: `${SITE()}/projects/${p.slug}`, image: p.photos.map((u) => SITE() + u), creator: { "@id": `${SITE()}/#org` },
  about: { "@type": "Organization", name: p.client }, ...(p.location ? { locationCreated: { "@type": "Place", name: p.location } } : {}),
  keywords: [...p.disciplines, ...p.scope].join(", "), ...(p.video ? { video: { "@type": "VideoObject", name: `${p.client}: ${p.title}`, embedUrl: p.video, thumbnailUrl: p.photos[0] ? SITE() + p.photos[0] : undefined, description: p.summary, uploadDate: undefined } } : {}),
});
const article = (post: Post) => ({
  "@type": "BlogPosting", "@id": `${SITE()}/insights/${post.slug}#article`, headline: post.title, description: post.excerpt || post.text.slice(0, 160),
  url: `${SITE()}/insights/${post.slug}`, image: post.cover ? [SITE() + post.cover] : [`${SITE()}/og/default.jpg`], datePublished: post.published_at, dateModified: post.updated_at,
  author: { "@id": `${SITE()}/#org` }, publisher: { "@id": `${SITE()}/#org` }, wordCount: post.words, keywords: post.tags.join(", "), inLanguage: "en-US",
  mainEntityOfPage: `${SITE()}/insights/${post.slug}`,
});

export function jsonLd(pathname: string): object[] {
  const p = pathname.replace(/\/+$/, "") || "/";
  const graph: object[] = [org(), website()];
  if (p === "/") graph.push(...faqPage(p));
  else if (p === "/services") graph.push(crumbs([["Home", "/"], ["Services", "/services"]]), ...SERVICES.map(service), ...faqPage(p));
  else if (p === "/projects") graph.push(crumbs([["Home", "/"], ["Projects", "/projects"]]), { "@type": "CollectionPage", name: `Projects | ${BRAND}`, url: `${SITE()}/projects`, hasPart: publicProjects().map((x) => ({ "@id": `${SITE()}/projects/${x.slug}#work` })) }, ...faqPage(p));
  else if (p === "/contact") graph.push(crumbs([["Home", "/"], ["Contact", "/contact"]]), { "@type": "ContactPage", name: `Contact | ${BRAND}`, url: `${SITE()}/contact` }, ...faqPage(p));
  else if (p === "/insights") graph.push(crumbs([["Home", "/"], ["Insights", "/insights"]]), { "@type": "Blog", name: `Insights | ${BRAND}`, url: `${SITE()}/insights`, blogPost: listPosts().map((x) => ({ "@id": `${SITE()}/insights/${x.slug}#article` })) });
  else {
    const svc = SERVICES.find((s) => s.page === p);
    if (svc) graph.push(crumbs([["Home", "/"], ["Services", "/services"], [svc.title, svc.page!]]), service(svc), ...faqPage(p));
    const proj = p.match(/^\/projects\/([^/]+)$/); const pr = proj && publicProjects().find((x) => x.slug === proj[1]);
    if (pr) graph.push(crumbs([["Home", "/"], ["Projects", "/projects"], [`${pr.client}: ${pr.title}`, `/projects/${pr.slug}`]]), projectWork(pr));
    const postM = p.match(/^\/insights\/([^/]+)$/); const post = postM && insightsEnabled() ? getPost(postM[1]) : undefined;
    if (post) {
      graph.push(crumbs([["Home", "/"], ["Insights", "/insights"], [post.title, `/insights/${post.slug}`]]), article(post));
      if (post.faq.length) graph.push({ "@type": "FAQPage", mainEntity: post.faq.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })) });
    }
  }
  return graph;
}

export const jsonLdTag = (pathname: string) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": jsonLd(pathname) }).replace(/</g, "\\u003c")}</script>`;

/** Search Console / Bing verification, set as env vars so Will's accounts can be verified without a redeploy. */
export const verificationTags = () => [
  process.env.GOOGLE_SITE_VERIFICATION && `<meta name="google-site-verification" content="${esc(process.env.GOOGLE_SITE_VERIFICATION)}" />`,
  process.env.BING_SITE_VERIFICATION && `<meta name="msvalidate.01" content="${esc(process.env.BING_SITE_VERIFICATION)}" />`,
].filter(Boolean).join("\n    ");

/* ---------- Server-rendered content (what crawlers that don't run JavaScript read) ---------- */

const link = (href: string, text: string) => `<a href="${href}">${esc(text)}</a>`;
const faqHtml = (p: string) => { const f = faqsFor(p); return f.length ? `<section><h2>Frequently asked questions</h2>${f.map((x) => `<h3>${esc(x.q)}</h3><p>${esc(x.a)}</p>`).join("")}</section>` : ""; };
const projectCard = (x: Project) => `<li>${link(`/projects/${x.slug}`, `${x.client}: ${x.title}`)}${x.location ? ` <span>(${esc(x.location)})</span>` : ""}<br>${esc(x.disciplines.join(" · "))}</li>`;

export function prerender(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/";
  const projects = publicProjects();
  const nav = `<nav aria-label="Primary">${link("/", "Home")} · ${link("/projects", "Projects")} · ${link("/services", "Services")} · ${link("/contact", "Contact")}${insightsEnabled() ? ` · ${link("/insights", "Insights")}` : ""}</nav>`;
  let main = "";
  if (p === "/") {
    main = `<h1>Event technology &amp; production</h1><p>${esc(ABOUT)}</p>
      <section><h2>Services</h2><ul>${SERVICES.map((s) => `<li>${link(s.page || `/services#${s.slug}`, s.title)}: ${esc(s.copy)}</li>`).join("")}</ul></section>
      <section><h2>Selected work</h2><ul>${projects.filter((x) => x.featured).map(projectCard).join("")}</ul><p>${link("/projects", `All ${projects.length} projects`)}</p></section>
      <section><h2>Clients</h2><p>${esc(CLIENT_LOGOS.map((l) => l.name).join(", "))}</p></section>${faqHtml(p)}`;
  } else if (p === "/projects") {
    main = `<h1>Projects</h1><p>${projects.length} projects across video, audio, lighting and staging.</p><ul>${projects.map(projectCard).join("")}</ul>${faqHtml(p)}`;
  } else if (p === "/services") {
    main = `<h1>Services</h1><p>${esc(ABOUT)}</p>${SERVICES.map((s) => `<section id="${s.slug}"><h2>${s.page ? link(s.page, s.title) : esc(s.title)}</h2><p>${esc(s.copy)}</p><ul>${s.list.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></section>`).join("")}${faqHtml(p)}`;
  } else if (p === "/contact") {
    main = `<h1>Tell us about your event</h1><p>Use the form to send your event date, city and details. We work in ${esc(cities.join(", "))}.</p><p>${link(INSTAGRAM, "Instagram @shift4projects")}</p>${faqHtml(p)}`;
  } else if (p === "/insights" && insightsEnabled()) {
    main = `<h1>Insights</h1><ul>${listPosts().map((x) => `<li>${link(`/insights/${x.slug}`, x.title)}${x.excerpt ? `<br>${esc(x.excerpt)}` : ""}</li>`).join("")}</ul>`;
  } else {
    const svc = SERVICES.find((s) => s.page === p);
    if (svc) main = `<h1>${esc(svc.title)}</h1><p>${esc(svc.copy)}</p><ul>${svc.list.map((n) => `<li>${esc(n)}</li>`).join("")}</ul><p>${link("/contact", "Get a quote")}</p>${faqHtml(p)}`;
    const proj = p.match(/^\/projects\/([^/]+)$/); const pr = proj && projects.find((x) => x.slug === proj[1]);
    if (pr) main = `<p>${link("/projects", "All projects")}</p><h1>${esc(pr.client)}</h1><p><strong>${esc(pr.title)}</strong></p><p>${esc(pr.summary)}</p>
      <dl><dt>Client</dt><dd>${esc(pr.client)}</dd><dt>Disciplines</dt><dd>${esc(pr.disciplines.join(", "))}</dd><dt>Scope</dt><dd>${esc(pr.scope.join(", "))}</dd>${pr.location ? `<dt>Location</dt><dd>${esc(pr.location)}</dd>` : ""}${pr.credits ? `<dt>Credits</dt><dd>${esc(pr.credits.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"))}</dd>` : ""}</dl>
      ${pr.photos.map((u, i) => `<img src="${u}" alt="${esc(`${pr.client}: ${pr.title}${pr.location ? `, ${pr.location}` : ""}, photo ${i + 1}`)}" loading="lazy" width="1200">`).join("")}`;
    const postM = p.match(/^\/insights\/([^/]+)$/); const post = postM && insightsEnabled() ? getPost(postM[1]) : undefined;
    if (post) main = `<p>${link("/insights", "Insights")}</p><article><h1>${esc(post.title)}</h1>${post.excerpt ? `<p><em>${esc(post.excerpt)}</em></p>` : ""}${post.html}${post.faq.length ? `<section><h2>FAQ</h2>${post.faq.map((x) => `<h3>${esc(x.q)}</h3><p>${esc(x.a)}</p>`).join("")}</section>` : ""}</article>`;
  }
  if (!main) return "";
  return `<div class="ssr wrap">${nav}<main>${main}</main><footer><p>${esc(BRAND)} · ${esc(cities.join(" · "))}</p></footer></div>`;
}

/* ---------- robots.txt, sitemap.xml, llms.txt ---------- */

export function mountSeo(app: Express) {
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").set("Cache-Control", "public, max-age=3600").send([
      "# Shift 4 Projects. Search engines and AI assistants are welcome to read and cite the site.",
      "User-agent: *", "Allow: /", "Disallow: /admin", "Disallow: /admin.html", "Disallow: /api/", "Disallow: /mcp", "Disallow: /agent/", "Disallow: /oauth/", "Disallow: /.well-known/oauth-", "",
      // Named so the intent is explicit even if a bot ignores the wildcard.
      ...["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "Bingbot", "DuckAssistBot", "CCBot"]
        .flatMap((ua) => [`User-agent: ${ua}`, "Allow: /", ""]),
      `Sitemap: ${SITE()}/sitemap.xml`, `# AI summary of this site: ${SITE()}/llms.txt`,
    ].join("\n"));
  });

  app.get("/sitemap.xml", (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const projects = publicProjects();
    const url = (loc: string, lastmod: string, priority: string, images: string[] = []) =>
      `<url><loc>${SITE()}${loc}</loc><lastmod>${lastmod}</lastmod><priority>${priority}</priority>${images.map((u) => `<image:image><image:loc>${SITE()}${esc(u)}</image:loc></image:image>`).join("")}</url>`;
    const entries = [
      url("/", today, "1.0"), url("/services", today, "0.9"), url("/projects", today, "0.9"), url("/contact", today, "0.7"),
      ...SERVICES.filter((s) => s.page).map((s) => url(s.page!, today, "0.8")),
      ...projects.map((p) => url(`/projects/${p.slug}`, ((p as Project & { updated_at?: string }).updated_at || today).slice(0, 10), "0.7", p.photos.slice(0, 10))),
      ...(insightsEnabled() ? [url("/insights", today, "0.8"), ...listPosts().map((x) => url(`/insights/${x.slug}`, x.updated_at.slice(0, 10), "0.7", x.cover ? [x.cover] : []))] : []),
    ];
    res.type("application/xml").set("Cache-Control", "public, max-age=3600")
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${entries.join("\n")}\n</urlset>`);
  });

  // llms.txt: a plain-text brief for AI assistants (the proposed llmstxt.org convention). llms-full.txt carries every page's text.
  const llms = (full: boolean) => {
    const projects = publicProjects();
    const lines = [
      `# ${BRAND}`, "", `> ${ABOUT}`, "",
      `Shift 4 Projects (also written Shift4Projects) is based in Los Angeles and works in ${cities.join(", ")}, travelling for multi-city activations. Services: ${SERVICES.map((s) => s.title).join(", ")}. Clients include ${clientNames().join(", ")}.`, "",
      "## Pages", `- [Home](${SITE()}/)`, `- [Services](${SITE()}/services)`, ...SERVICES.filter((s) => s.page).map((s) => `- [${s.title}](${SITE()}${s.page})`), `- [Projects](${SITE()}/projects)`, `- [Contact](${SITE()}/contact)`,
      ...(insightsEnabled() ? [`- [Insights](${SITE()}/insights)`] : []), "",
      "## Services", ...SERVICES.map((s) => `- **${s.title}**: ${s.copy} Includes: ${s.list.join(", ")}.`), "",
      "## Projects", ...projects.map((p) => `- [${p.client}: ${p.title}](${SITE()}/projects/${p.slug})${p.location ? ` (${p.location})` : ""}: ${p.summary} Scope: ${p.scope.join(", ")}.${p.credits ? ` ${p.credits.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")}.` : ""}`), "",
      "## Frequently asked questions", ...FAQS.map((f) => `- **${f.q}** ${f.a}`), "",
      `## Contact`, `- Inquiries: ${SITE()}/contact`, `- Instagram: ${INSTAGRAM}`,
    ];
    if (full && insightsEnabled()) {
      for (const post of listPosts()) lines.push("", `## Article: ${post.title}`, `${SITE()}/insights/${post.slug}`, "", post.text);
    }
    return lines.join("\n");
  };
  app.get("/llms.txt", (_req, res) => res.type("text/plain; charset=utf-8").set("Cache-Control", "public, max-age=3600").send(llms(false)));
  app.get("/llms-full.txt", (_req, res) => res.type("text/plain; charset=utf-8").set("Cache-Control", "public, max-age=3600").send(llms(true)));
}
