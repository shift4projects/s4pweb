// Mirror the live site's projects (text, order, visibility, photos) into the local dev database,
// so localhost shows the same content as production. Reads live through the site's own MCP.
// Usage: set -a; source ~/.claude/.secrets/shift4.env; set +a; node scripts/pull-live.mjs
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.SHIFT4_MCP_URL;
const TOKEN = process.env.SHIFT4_MCP_TOKEN;
if (!MCP_URL || !TOKEN) throw new Error("Load ~/.claude/.secrets/shift4.env first");
const LIVE = new URL(MCP_URL).origin;
const DATA = path.resolve(process.env.DATA_DIR || "data");

const c = new Client({ name: "pull-live", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
const call = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return JSON.parse(r.content[0].text);
};

const list = await call("list_projects");
const projects = [];
for (const s of list) projects.push(await call("get_project", { slug: s.slug }));

// Uploaded photos only exist on the live volume, so copy them (full size + thumbnail).
let downloaded = 0;
for (const p of projects) {
  for (const url of p.photos.filter((u) => u.startsWith("/uploads/"))) {
    for (const u of [url, url.replace(/\.webp$/, "-sm.webp")]) {
      const dest = path.join(DATA, u);
      if (fs.existsSync(dest)) continue;
      const res = await fetch(LIVE + u);
      if (!res.ok) { console.warn("  missing on live:", u); continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      downloaded++;
    }
  }
}

const db = new DatabaseSync(path.join(DATA, "shift4.db"));
db.exec("BEGIN");
db.exec("DELETE FROM projects");
const ins = db.prepare("INSERT INTO projects (slug, position, hidden, data) VALUES (?, ?, ?, ?)");
const hist = db.prepare("INSERT INTO project_history (slug, action, data, hidden) VALUES (?, ?, ?, ?)");
projects.forEach((p, i) => {
  const { slug, hidden, position, updated_at, url, ...data } = p;
  const json = JSON.stringify(data);
  ins.run(slug, (i + 1) * 10, hidden ? 1 : 0, json);
  hist.run(slug, "pulled from live", json, hidden ? 1 : 0);
});
db.exec("COMMIT");

console.log(`Mirrored ${projects.length} projects (${projects.filter((p) => !p.hidden).length} visible), downloaded ${downloaded} photo files.`);
await c.close();
process.exit(0);
