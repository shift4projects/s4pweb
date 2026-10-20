import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { DISCIPLINES } from "../src/data/projects";
import { db } from "./db";
import { adminEnabled, safeEqual } from "./auth";
import { protectedResourceMetadataUrl, verifyOAuthToken } from "./oauth";
import {
  addPhoto, createProject, getProject, history, listProjects, reorderProjects,
  restoreVersion, setHidden, updateProject, type StoredProject,
} from "./projects";

// The site's own MCP server: lets Shift 4 (or us) update projects by talking to Claude
// or any MCP client. Content only. Layout, video and animations are not exposed.

const SITE = process.env.SITE_URL || "https://shift4-projects.com";
const discipline = z.enum(DISCIPLINES as [string, ...string[]]);

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: (e as Error).message }] });
const run = async (fn: () => unknown) => { try { return json(await fn()); } catch (e) { return fail(e); } };
const summary = (p: StoredProject) => ({
  slug: p.slug, client: p.client, title: p.title, disciplines: p.disciplines, photos: p.photos.length,
  featured: !!p.featured, hidden: p.hidden, url: `${SITE}/projects/${p.slug}`,
});

const fields = {
  client: z.string().min(1).max(120).describe("Client or brand, e.g. \"Hulu\""),
  title: z.string().min(1).max(160).describe("Project title, e.g. \"Screening and After-Party\""),
  disciplines: z.array(discipline).min(1).describe("Which of Video, Audio, Lighting, Staging apply"),
  summary: z.string().min(1).max(1200).describe("One or two sentences describing what Shift 4 did"),
  scope: z.array(z.string().max(120)).max(20).describe("Short scope items, e.g. [\"LED wall\", \"Red carpet lighting\"]"),
  location: z.string().max(160).optional().describe("Venue and city, if known"),
  credits: z.string().max(240).optional().describe("Production partners or crew, e.g. \"Production: AGENC\""),
  featured: z.boolean().optional().describe("Show in Selected work on the home page"),
};

function buildServer() {
  const server = new McpServer(
    { name: "shift4-projects-site", version: "1.0.0" },
    {
      instructions:
        "Manages the project portfolio on the Shift 4 Projects website. Changes go live immediately, and every change is saved " +
        "to history so it can be undone with restore_project_version. Never invent facts (years, venues, credits); only use what " +
        "the user provides. Prefer hide_project over deleting anything. Design, videos and page layout cannot be changed here.",
    },
  );

  server.registerTool("list_projects", {
    title: "List projects",
    description: "All projects in display order (top of the list shows first on the site), including hidden ones.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, () => run(() => listProjects({ includeHidden: true }).map(summary)));

  server.registerTool("get_project", {
    title: "Get project",
    description: "Full details for one project, including every photo URL in order.",
    inputSchema: { slug: z.string() },
    annotations: { readOnlyHint: true },
  }, ({ slug }) => run(() => {
    const p = getProject(slug);
    if (!p) throw new Error(`No project with slug "${slug}". Use list_projects to see slugs.`);
    return { ...p, url: `${SITE}/projects/${p.slug}` };
  }));

  server.registerTool("create_project", {
    title: "Create project",
    description: "Add a new project. It goes to the top of the list. Add photos after with add_project_photo. Set publish=false to keep it hidden until it's ready.",
    inputSchema: { ...fields, publish: z.boolean().default(true).describe("false keeps it hidden from the site") },
  }, (a) => run(() => summary(createProject({ ...a, disciplines: a.disciplines as never, hidden: !a.publish }))));

  server.registerTool("update_project", {
    title: "Update project",
    description: "Change any text fields on a project. Only the fields you pass are changed.",
    inputSchema: { slug: z.string(), ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])) } as typeof fields & { slug: z.ZodString },
  }, ({ slug, ...patch }) => run(() => summary(updateProject(slug, patch as never))));

  server.registerTool("hide_project", {
    title: "Hide or show project",
    description: "Take a project off the site (hidden=true) or put it back (hidden=false). Nothing is deleted.",
    inputSchema: { slug: z.string(), hidden: z.boolean() },
  }, ({ slug, hidden }) => run(() => summary(setHidden(slug, hidden))));

  server.registerTool("reorder_projects", {
    title: "Reorder projects",
    description: "Put these slugs first, in this order. Every other project keeps its order after them.",
    inputSchema: { slugs: z.array(z.string()).min(1) },
  }, ({ slugs }) => run(() => reorderProjects(slugs).map(summary)));

  server.registerTool("add_project_photo", {
    title: "Add project photo",
    description:
      "Add a photo to a project from a public image link (Dropbox, Google Drive direct link, WeTransfer, the old site, etc.) or base64 data. " +
      "It is resized and optimized automatically. position 0 makes it the cover; default adds it to the end.",
    inputSchema: {
      slug: z.string(),
      image_url: z.string().url().optional(),
      image_base64: z.string().optional().describe("Raw base64 or a data: URL"),
      position: z.number().int().min(0).optional(),
    },
  }, ({ slug, image_url, image_base64, position }) => run(async () => {
    const p = await addPhoto(slug, { url: image_url, base64: image_base64 }, position);
    return { ...summary(p), photo_urls: p.photos };
  }));

  server.registerTool("set_project_photos", {
    title: "Reorder or remove photos",
    description: "Set the exact photo list for a project, in order (first is the cover). Use URLs from get_project. Leave a URL out to remove it from the project.",
    inputSchema: { slug: z.string(), photos: z.array(z.string()) },
  }, ({ slug, photos }) => run(() => {
    const p = getProject(slug);
    if (!p) throw new Error(`No project with slug "${slug}"`);
    const bad = photos.filter((u) => !p.photos.includes(u));
    if (bad.length) throw new Error(`Not photos of this project: ${bad.join(", ")}. Add new ones with add_project_photo.`);
    const next = updateProject(slug, { photos }, "set photos");
    return { ...summary(next), photo_urls: next.photos };
  }));

  server.registerTool("project_history", {
    title: "Project history",
    description: "Recent saved versions of a project, newest first. Use restore_project_version with an id to undo.",
    inputSchema: { slug: z.string(), limit: z.number().int().min(1).max(100).default(15) },
    annotations: { readOnlyHint: true },
  }, ({ slug, limit }) => run(() => history(slug, limit).map((h) => {
    const d = JSON.parse(h.data);
    return { id: h.id, action: h.action, at: h.created_at, title: d.title, photos: d.photos.length, hidden: !!h.hidden };
  })));

  server.registerTool("restore_project_version", {
    title: "Restore project version",
    description: "Roll a project back to a version from project_history.",
    inputSchema: { history_id: z.number().int() },
  }, ({ history_id }) => run(() => summary(restoreVersion(history_id))));

  server.registerTool("list_inquiries", {
    title: "List inquiries",
    description: "Contact form submissions from the website, newest first.",
    inputSchema: { limit: z.number().int().min(1).max(200).default(20) },
    annotations: { readOnlyHint: true },
  }, ({ limit }) => run(() =>
    db.prepare("SELECT id, created_at, name, email, company, phone, services, event_date, city, message FROM leads ORDER BY id DESC LIMIT ?").all(limit)));

  return server;
}

/**
 * Mounts the MCP endpoint. Three ways in:
 *  - OAuth (claude.ai custom connector): https://<site>/mcp, sign in with ADMIN_PASSWORD (see oauth.ts)
 *  - header  Authorization: Bearer <MCP_TOKEN>  at /mcp       (Claude Code, Claude Desktop, Cursor...)
 *  - secret path                               /mcp/<MCP_TOKEN> (fallback for clients with no auth support)
 * Disabled entirely when neither MCP_TOKEN nor ADMIN_PASSWORD is set.
 */
export function mountMcp(app: Express) {
  const token = process.env.MCP_TOKEN || "";
  if (!token && !adminEnabled()) { console.warn("[mcp] MCP_TOKEN / ADMIN_PASSWORD not set; MCP endpoint disabled"); return; }

  const handle = async (req: Request, res: Response) => {
    const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const ok = (token && req.params.token && safeEqual(req.params.token, token)) ||
      (token && bearer && safeEqual(bearer, token)) ||
      (bearer && adminEnabled() && await verifyOAuthToken(bearer));
    if (!ok) {
      // Point OAuth-capable clients at the login flow.
      const meta = !req.params.token && adminEnabled() && protectedResourceMetadataUrl(req);
      if (meta) res.set("WWW-Authenticate", `Bearer ${bearer ? 'error="invalid_token", ' : ""}resource_metadata="${meta}"`);
      return res.status(401).json({ error: "unauthorized" });
    }
    if (req.method !== "POST") return res.status(405).set("Allow", "POST").json({ error: "Use POST (stateless Streamable HTTP)" });

    // Stateless: a fresh server + transport per request.
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("[mcp]", e);
      if (!res.headersSent) res.status(500).json({ error: "internal error" });
    }
  };

  app.all("/mcp", handle);
  app.all("/mcp/:token", handle);
  console.log("[mcp] endpoint ready at /mcp");
}
