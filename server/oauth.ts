import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { db } from "./db";
import { adminEnabled, checkPassword, lockedOut, randomToken, sha256 } from "./auth";

// OAuth 2.1 for the site MCP, so Shift 4 can add it in claude.ai as a normal custom connector:
// paste https://<site>/mcp, click Connect, enter the admin password, done.
// This server is its own authorization server (dynamic client registration + PKCE, handled by the MCP SDK).
// Clients, codes and tokens live in SQLite (tokens hashed) so connections survive redeploys.

db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    challenge TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    resource TEXT,
    scopes TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    token_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    client_id TEXT NOT NULL,
    resource TEXT,
    scopes TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const ACCESS_TTL = 24 * 3600; // seconds
const REFRESH_TTL = 90 * 86400;
const CODE_TTL = 10 * 60;
const now = () => Math.floor(Date.now() / 1000);

type CodeRow = { client_id: string; challenge: string; redirect_uri: string; resource: string | null; scopes: string; expires_at: number };
type TokenRow = { kind: string; client_id: string; resource: string | null; scopes: string; expires_at: number };

function issueTokens(clientId: string, scopes: string[], resource?: string | null): OAuthTokens {
  const access = `s4at_${randomToken()}`, refresh = `s4rt_${randomToken()}`;
  const ins = db.prepare("INSERT INTO oauth_tokens (token_hash, kind, client_id, resource, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run(sha256(access), "access", clientId, resource ?? null, scopes.join(" "), now() + ACCESS_TTL);
  ins.run(sha256(refresh), "refresh", clientId, resource ?? null, scopes.join(" "), now() + REFRESH_TTL);
  db.prepare("DELETE FROM oauth_tokens WHERE expires_at < ?").run(now());
  return { access_token: access, token_type: "bearer", expires_in: ACCESS_TTL, refresh_token: refresh, ...(scopes.length ? { scope: scopes.join(" ") } : {}) };
}

const esc = (s = "") => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The login page shown when Claude (or another MCP client) asks to connect. Posts back to /authorize. */
function loginPage(client: OAuthClientInformationFull, p: AuthorizationParams, error?: string) {
  const hidden: Record<string, string | undefined> = {
    client_id: client.client_id, redirect_uri: p.redirectUri, response_type: "code",
    code_challenge: p.codeChallenge, code_challenge_method: "S256",
    scope: p.scopes?.length ? p.scopes.join(" ") : undefined, state: p.state, resource: p.resource?.href,
  };
  const app = esc(client.client_name || "An MCP client");
  const dest = esc(new URL(p.redirectUri).host);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Connect to Shift 4 Projects</title>
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
<style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0b;color:#f2f0eb;
  font:16px/1.5 "Helvetica Neue",Arial,sans-serif;padding:16px}
  main{width:100%;max-width:400px}img{width:140px;display:block;margin-bottom:40px}
  h1{font-size:30px;line-height:1.05;letter-spacing:-.02em;margin:0 0 12px}
  p{color:#8c8b88;margin:0 0 28px}b{color:#f2f0eb;font-weight:600}
  label{display:block;font:12px/1 Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#8c8b88;margin-bottom:10px}
  input{width:100%;font:inherit;color:inherit;background:#111113;border:1px solid rgba(242,240,235,.16);padding:15px 16px;outline:none}
  input:focus{border-color:#f2f0eb}
  button{margin-top:18px;width:100%;font:12px/1 Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:#0a0a0b;background:#f2f0eb;border:0;padding:17px;cursor:pointer}
  button:hover{background:#ffffff}
  .err{color:#f2f0eb;font:13px/1.4 Menlo,monospace;margin:14px 0 0}
  small{display:block;margin-top:26px;color:#5a5a5c;font-size:13px}
</style></head><body><main>
<img src="/img/logo-white.png" alt="Shift 4 Projects">
<h1>Connect your site</h1>
<p><b>${app}</b> wants to manage projects on the Shift 4 Projects website. Enter your admin password to allow it.</p>
<form method="post" action="/authorize">
  ${Object.entries(hidden).filter(([, v]) => v !== undefined).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("")}
  <label for="pw">Admin password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">Allow access</button>
  ${error ? `<p class="err">${esc(error)}</p>` : ""}
</form>
<small>You’ll be sent back to ${dest}. It can edit project text and photos and read inquiries. It can’t change the design or videos.</small>
</main></body></html>`;
}

const provider: OAuthServerProvider = {
  clientsStore: {
    getClient(id) {
      const r = db.prepare("SELECT data FROM oauth_clients WHERE client_id = ?").get(id) as { data: string } | undefined;
      return r ? JSON.parse(r.data) : undefined;
    },
    registerClient(c) {
      const client = c as OAuthClientInformationFull;
      db.prepare("INSERT INTO oauth_clients (client_id, data) VALUES (?, ?)").run(client.client_id, JSON.stringify(client));
      return client;
    },
  },

  async authorize(client, params, res) {
    const req = res.req as Request;
    res.set({ "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" });
    const page = (err?: string, status = 200) => res.status(status).type("html").send(loginPage(client, params, err));
    if (req.method !== "POST" || req.body?.password === undefined) return void page();

    const ip = req.ip || "unknown";
    if (lockedOut(ip)) return void page("Too many attempts. Try again in 15 minutes.", 429);
    if (!checkPassword(ip, req.body.password)) return void page("Wrong password.", 401);

    const code = randomToken();
    db.prepare("INSERT INTO oauth_codes (code_hash, client_id, challenge, redirect_uri, resource, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(sha256(code), client.client_id, params.codeChallenge, params.redirectUri, params.resource?.href ?? null, (params.scopes || []).join(" "), now() + CODE_TTL);
    const to = new URL(params.redirectUri);
    to.searchParams.set("code", code);
    if (params.state !== undefined) to.searchParams.set("state", params.state);
    res.redirect(302, to.href);
  },

  async challengeForAuthorizationCode(client, code) {
    const r = db.prepare("SELECT * FROM oauth_codes WHERE code_hash = ?").get(sha256(code)) as CodeRow | undefined;
    if (!r || r.client_id !== client.client_id || r.expires_at < now()) throw new InvalidGrantError("Invalid or expired authorization code");
    return r.challenge;
  },

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
    const hash = sha256(code);
    const r = db.prepare("SELECT * FROM oauth_codes WHERE code_hash = ?").get(hash) as CodeRow | undefined;
    db.prepare("DELETE FROM oauth_codes WHERE code_hash = ? OR expires_at < ?").run(hash, now()); // single use
    if (!r || r.client_id !== client.client_id || r.expires_at < now()) throw new InvalidGrantError("Invalid or expired authorization code");
    if (redirectUri && redirectUri !== r.redirect_uri) throw new InvalidGrantError("redirect_uri does not match");
    return issueTokens(client.client_id, r.scopes ? r.scopes.split(" ") : [], r.resource);
  },

  async exchangeRefreshToken(client, refreshToken) {
    const hash = sha256(refreshToken);
    const r = db.prepare("SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'").get(hash) as TokenRow | undefined;
    if (!r || r.client_id !== client.client_id || r.expires_at < now()) throw new InvalidGrantError("Invalid or expired refresh token");
    db.prepare("DELETE FROM oauth_tokens WHERE token_hash = ?").run(hash); // rotate
    return issueTokens(client.client_id, r.scopes ? r.scopes.split(" ") : [], r.resource);
  },

  async verifyAccessToken(token): Promise<AuthInfo> {
    const r = db.prepare("SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'").get(sha256(token)) as TokenRow | undefined;
    if (!r || r.expires_at < now()) throw new InvalidTokenError("Invalid or expired access token");
    return { token, clientId: r.client_id, scopes: r.scopes ? r.scopes.split(" ") : [], expiresAt: r.expires_at, resource: r.resource ? new URL(r.resource) : undefined };
  },

  async revokeToken(client, { token }) {
    db.prepare("DELETE FROM oauth_tokens WHERE token_hash = ? AND client_id = ?").run(sha256(token), client.client_id);
  },
};

/** Hosts OAuth answers on: SITE_URL (+ www/apex twin), the Railway domain, OAUTH_HOSTS, and localhost in dev. */
function allowedHosts(): Set<string> {
  const hosts = new Set<string>();
  const add = (h?: string) => h && hosts.add(h.toLowerCase());
  try {
    const site = new URL(process.env.SITE_URL || "https://shift4-projects.com").host;
    add(site);
    add(site.startsWith("www.") ? site.slice(4) : `www.${site}`);
  } catch { /* ignore a malformed SITE_URL */ }
  add(process.env.RAILWAY_PUBLIC_DOMAIN);
  (process.env.OAUTH_HOSTS || "").split(",").map((s) => s.trim()).forEach(add);
  if (process.env.NODE_ENV !== "production") {
    const port = process.env.PORT || "5260";
    add(`localhost:${port}`); add(`127.0.0.1:${port}`);
  }
  return hosts;
}

const isLocal = (host: string) => /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
const HOSTS = allowedHosts();

/** Public origin of this request if it's one we serve OAuth on, e.g. https://shift4-projects.com */
export function originOf(req: Request): string | undefined {
  const host = (req.get("host") || "").toLowerCase();
  if (!HOSTS.has(host)) return undefined;
  return `${isLocal(host) ? "http" : "https"}://${host}`;
}

const OAUTH_PATH = /^\/(authorize|token|register|revoke|\.well-known\/oauth-(authorization-server|protected-resource)(\/mcp)?)\/?$/;
// One SDK auth router per public origin (metadata URLs must match the host the client used).
// Built at startup: the SDK's rate limiters must not be created inside a request.
const routers = new Map<string, RequestHandler>();
function buildRouters() {
  for (const host of HOSTS) {
    const origin = `${isLocal(host) ? "http" : "https"}://${host}`;
    routers.set(origin, mcpAuthRouter({
      provider,
      issuerUrl: new URL(origin),
      resourceServerUrl: new URL(`${origin}/mcp`),
      resourceName: "Shift 4 Projects website",
      serviceDocumentationUrl: new URL(origin),
    }));
  }
}

/** Bearer token check for /mcp. Returns false for anything that isn't a live OAuth access token. */
export async function verifyOAuthToken(token: string): Promise<boolean> {
  if (!token.startsWith("s4at_")) return false;
  try { await provider.verifyAccessToken(token); return true; } catch { return false; }
}

export const protectedResourceMetadataUrl = (req: Request) => {
  const o = originOf(req);
  return o && `${o}/.well-known/oauth-protected-resource/mcp`;
};

/** Mounts the OAuth endpoints at the root. Only active when ADMIN_PASSWORD is set (it's the login). */
export function mountOAuth(app: Express) {
  if (!adminEnabled()) return;
  buildRouters();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!OAUTH_PATH.test(req.path) || !adminEnabled()) return next();
    const router = routers.get(originOf(req) || "");
    if (!router) return next();
    // Some clients look for the resource metadata at the bare well-known path; answer the same document there.
    if (req.path.replace(/\/$/, "") === "/.well-known/oauth-protected-resource") req.url = "/.well-known/oauth-protected-resource/mcp";
    router(req, res, next);
  });
  console.log(`[oauth] ready on ${[...routers.keys()].join(", ")} (login with ADMIN_PASSWORD)`);
}
