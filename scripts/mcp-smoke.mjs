// End-to-end check of the site's MCP server using the official MCP client.
// Usage: MCP_URL=http://localhost:5260/mcp MCP_TOKEN=... node scripts/mcp-smoke.mjs [--write]
// Without --write it only runs read tools. With --write it creates a hidden test project,
// adds a photo, edits it, checks history/restore, then leaves it hidden.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_URL || "http://localhost:5260/mcp");
const token = process.env.MCP_TOKEN;
const write = process.argv.includes("--write");

const client = new Client({ name: "shift4-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  if (r.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
};
const ok = (label, v) => console.log(`✓ ${label}`, v === undefined ? "" : v);

const { tools } = await client.listTools();
ok("tools", tools.map((t) => t.name).join(", "));
const list = await call("list_projects");
ok("list_projects", `${list.length} projects, first: ${list[0].slug}`);
const one = await call("get_project", { slug: list[0].slug });
ok("get_project", `${one.client}: ${one.title} (${one.photos.length} photos)`);
const leads = await call("list_inquiries", { limit: 3 });
ok("list_inquiries", `${leads.length} returned`);

if (write) {
  const created = await call("create_project", {
    client: "Smoke Test", title: "MCP Check", disciplines: ["Video"], summary: "Created by the MCP smoke test.",
    scope: ["Test"], publish: false,
  });
  ok("create_project (hidden)", created.slug);
  const photoSrc = process.env.PHOTO_URL || new URL("/work/hulu/01.webp", url).href;
  const withPhoto = await call("add_project_photo", { slug: created.slug, image_url: photoSrc });
  ok("add_project_photo", withPhoto.photo_urls[0]);
  const thumbRes = await fetch(new URL(withPhoto.photo_urls[0].replace(/\.webp$/, "-sm.webp"), url));
  ok("thumbnail served", `${thumbRes.status} ${thumbRes.headers.get("content-type")}`);
  await call("update_project", { slug: created.slug, title: "MCP Check Edited", location: "Los Angeles" });
  const hist = await call("project_history", { slug: created.slug });
  ok("project_history", hist.map((h) => `#${h.id} ${h.action}`).join(" | "));
  const before = hist.find((h) => h.action === "add photo");
  const restored = await call("restore_project_version", { history_id: before.id });
  ok("restore_project_version", `title back to "${restored.title}"`);
  const pub = await (await fetch(new URL("/api/projects", url))).json();
  ok("hidden project not public", !pub.some((p) => p.slug === created.slug));
  await call("hide_project", { slug: created.slug, hidden: true });
  ok("left hidden", created.slug);
}

let unauthorized = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
ok("no token rejected", unauthorized.status);
await client.close();
