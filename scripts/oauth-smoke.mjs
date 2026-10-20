// End-to-end check of the MCP OAuth flow, the way claude.ai runs it:
// 401 + resource metadata -> discovery -> dynamic registration -> login page -> password -> code (PKCE)
// -> token -> MCP call with the access token -> refresh -> revoke.
// Usage: SITE=http://localhost:5260 ADMIN_PASSWORD=... node scripts/oauth-smoke.mjs
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const site = (process.env.SITE || "http://localhost:5260").replace(/\/$/, "");
const password = process.env.ADMIN_PASSWORD;
const redirect = "https://claude.ai/api/mcp/auth_callback";
const ok = (label, v = "") => console.log(`✓ ${label}`, v);
const must = (cond, msg) => { if (!cond) { console.error(`✗ ${msg}`); process.exit(1); } };

const unauth = await fetch(`${site}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
const www = unauth.headers.get("www-authenticate") || "";
must(unauth.status === 401 && www.includes("resource_metadata="), `expected 401 with resource_metadata, got ${unauth.status} ${www}`);
const prmUrl = www.match(/resource_metadata="([^"]+)"/)[1];
ok("401 points at", prmUrl);

const prm = await (await fetch(prmUrl)).json();
ok("protected resource", `${prm.resource} -> ${prm.authorization_servers}`);
const asm = await (await fetch(new URL("/.well-known/oauth-authorization-server", prm.authorization_servers[0]))).json();
ok("auth server metadata", `${asm.authorization_endpoint} | ${asm.token_endpoint} | ${asm.registration_endpoint}`);

const reg = await (await fetch(asm.registration_endpoint, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "OAuth smoke test", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
})).json();
must(reg.client_id, `registration failed ${JSON.stringify(reg)}`);
ok("registered client", reg.client_id);

const verifier = crypto.randomBytes(32).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const q = { client_id: reg.client_id, redirect_uri: redirect, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "xyz", resource: prm.resource };
const page = await fetch(`${asm.authorization_endpoint}?${new URLSearchParams(q)}`);
const html = await page.text();
must(page.status === 200 && html.includes('name="password"'), `login page missing (${page.status})`);
ok("login page", "renders password form");

const post = (pw) => fetch(asm.authorization_endpoint, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...q, password: pw }) });
const bad = await post("definitely-wrong");
must(bad.status === 401, `wrong password should be 401, got ${bad.status}`);
ok("wrong password rejected", bad.status);
if (!password) { console.log("(set ADMIN_PASSWORD to finish the flow)"); process.exit(0); }

const good = await post(password);
const loc = new URL(good.headers.get("location") || "about:blank");
must(good.status === 302 && loc.searchParams.get("code") && loc.searchParams.get("state") === "xyz", `expected redirect with code, got ${good.status} ${loc}`);
ok("redirected with code", `${loc.origin}${loc.pathname}`);

const token = async (params) => (await fetch(asm.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: reg.client_id, ...params }) })).json();
const t1 = await token({ grant_type: "authorization_code", code: loc.searchParams.get("code"), code_verifier: verifier, redirect_uri: redirect, resource: prm.resource });
must(t1.access_token, `token exchange failed ${JSON.stringify(t1)}`);
ok("tokens", `expires_in ${t1.expires_in}, refresh ${!!t1.refresh_token}`);
const replay = await token({ grant_type: "authorization_code", code: loc.searchParams.get("code"), code_verifier: verifier, redirect_uri: redirect });
must(!replay.access_token, "code reuse should fail");
ok("code is single use", replay.error);

const callMcp = async (access) => {
  const c = new Client({ name: "oauth-smoke", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(prm.resource), { requestInit: { headers: { Authorization: `Bearer ${access}` } } }));
  const { tools } = await c.listTools();
  const r = await c.callTool({ name: "list_projects", arguments: {} });
  await c.close();
  return `${tools.length} tools, ${JSON.parse(r.content[0].text).length} projects`;
};
ok("MCP with OAuth token", await callMcp(t1.access_token));

const t2 = await token({ grant_type: "refresh_token", refresh_token: t1.refresh_token });
must(t2.access_token && t2.refresh_token !== t1.refresh_token, `refresh failed ${JSON.stringify(t2)}`);
ok("refresh rotates", "new access + refresh token");
const old = await token({ grant_type: "refresh_token", refresh_token: t1.refresh_token });
must(!old.access_token, "old refresh token should be dead");
ok("old refresh token rejected", old.error);
ok("MCP with refreshed token", await callMcp(t2.access_token));

if (asm.revocation_endpoint) {
  await fetch(asm.revocation_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: reg.client_id, token: t2.access_token }) });
  const after = await fetch(prm.resource, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${t2.access_token}` }, body: "{}" });
  must(after.status === 401, `revoked token should be 401, got ${after.status}`);
  ok("revoked token rejected", after.status);
  await fetch(asm.revocation_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: reg.client_id, token: t2.refresh_token }) });
}
console.log("OAuth flow OK");
