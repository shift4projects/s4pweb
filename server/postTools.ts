import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createPost, deletePost, getPost, insightsEnabled, listPosts, setPublished, updatePost, type Post } from "./posts";

// Insights (articles) tools for the MCP: write and publish posts from Claude. Posts are Markdown.
// The section stays hidden on the site until INSIGHTS_ENABLED=1, but drafts can be written any time.

const SITE = process.env.SITE_URL || "https://shift4projects.com";
const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: (e as Error).message }] });
const run = async (fn: () => unknown) => { try { return json(await fn()); } catch (e) { return fail(e); } };
const brief = (p: Post) => ({ slug: p.slug, title: p.title, status: p.status, words: p.words, tags: p.tags, published_at: p.published_at, updated_at: p.updated_at, url: `${SITE}/insights/${p.slug}` });

const faq = z.array(z.object({ q: z.string().max(200), a: z.string().max(1200) })).max(10);

export function registerPostTools(server: McpServer) {
  server.registerTool("list_posts", {
    title: "List Insights posts",
    description: `Articles in the Insights section, drafts included. The section is currently ${insightsEnabled() ? "LIVE" : "hidden (INSIGHTS_ENABLED is off)"}; drafts are never shown on the site.`,
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, () => run(() => listPosts(true).map(brief)));

  server.registerTool("get_post", {
    title: "Get post", description: "Full Markdown body, excerpt, tags, FAQ and status of one post.",
    inputSchema: { slug: z.string() }, annotations: { readOnlyHint: true },
  }, ({ slug }) => run(() => { const p = getPost(slug, true); if (!p) throw new Error(`No post "${slug}"`); const { html: _h, ...rest } = p; return rest; }));

  server.registerTool("create_post", {
    title: "Create post (draft)",
    description: "Write a new article as a draft. Body is Markdown (## headings, lists, links, images by URL). Keep claims to what Shift 4 has actually done; never invent clients, specs or prices. Add 2 to 5 FAQ pairs that answer real questions a buyer would ask.",
    inputSchema: {
      title: z.string().min(4).max(120), body: z.string().min(50).max(40000), excerpt: z.string().max(300).optional().describe("One or two sentences for the list page and search results"),
      cover: z.string().max(300).optional().describe("Image URL, e.g. a project photo like /uploads/<slug>/<file>.webp"), tags: z.array(z.string().max(40)).max(8).optional(), faq: faq.optional(), slug: z.string().max(80).optional(),
    },
  }, (a) => run(() => brief(createPost(a))));

  server.registerTool("update_post", {
    title: "Update post", description: "Change any part of a post. Only the fields you pass change.",
    inputSchema: { slug: z.string(), title: z.string().min(4).max(120).optional(), body: z.string().min(50).max(40000).optional(), excerpt: z.string().max(300).nullable().optional(), cover: z.string().max(300).nullable().optional(), tags: z.array(z.string().max(40)).max(8).optional(), faq: faq.optional() },
  }, ({ slug, ...patch }) => run(() => brief(updatePost(slug, patch))));

  server.registerTool("publish_post", {
    title: "Publish or unpublish post", description: "published=true makes it visible (once the Insights section is enabled) and adds it to the sitemap and llms.txt; false returns it to draft.",
    inputSchema: { slug: z.string(), published: z.boolean() },
  }, ({ slug, published }) => run(() => brief(setPublished(slug, published))));

  server.registerTool("delete_post", {
    title: "Delete post", description: "Permanently removes a post. Prefer publish_post with published=false unless it was created by mistake.",
    inputSchema: { slug: z.string() },
  }, ({ slug }) => run(() => { deletePost(slug); return { deleted: slug }; }));
}
