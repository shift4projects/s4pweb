# Shift 4 Projects site

Vite + React 19 + Motion + Lenis on the front, a small Express server on the back.
Inquiries are saved to built-in SQLite (`node:sqlite`, no Supabase) and emailed via Resend.

```
npm install
npm run dev        # http://localhost:5260 (Vite middleware inside Express)
npm run build && npm start
```

## Where things live
- `src/data/projects.ts`: every project (copy, scope, location, credits, image count). Add a project here.
- `public/work/<slug>/NN.webp` + `NN-sm.webp`: project photos (full + thumb). Drop in full-res originals with the same names.
- `public/video/`: hero loop (desktop + mobile), motion loop, full reel with audio, posters.
- `scripts/fetch-images.mjs`: re-pulls images from the client's current Squarespace CDN.
- `server/`: `/api/contact` (validate, honeypot, rate limit, save, email + auto-reply), `/api/admin/*` (admin panel API),
  OAuth (`oauth.ts`), MCP (`mcp.ts`), tracking tags (`tracking.ts`) and the legacy `/api/leads.csv?token=ADMIN_TOKEN`.
- `admin.html` + `src/admin/`: the /admin panel (its own Vite entry, so none of it ships in the public bundle).

## Env (see .env.example)
| Var | What it does | Unset |
|---|---|---|
| `ADMIN_PASSWORD` | Login for /admin and for the MCP OAuth connector | /admin shows "not set up", OAuth off |
| `MCP_TOKEN` | Bearer token (Claude Code) and the `/mcp/<token>` fallback URL | only OAuth works |
| `RESEND_API_KEY`, `CONTACT_TO`, `CONTACT_FROM` | Inquiry email to Shift 4 + auto-reply to the sender (`CONTACT_FROM` must be a Resend-verified domain) | leads still save to the DB, no email |
| `AUTO_REPLY=off` | Turns the auto-reply off without removing Resend | auto-reply on |
| `GA_MEASUREMENT_ID` | Google tag (G-..., comma-separate to add an AW- tag) | no Google tag |
| `GOOGLE_ADS_CONVERSION` | Optional `AW-123/label` fired on each inquiry | none |
| `META_PIXEL_ID` | Meta Pixel | no pixel |
| `SITE_URL` | Base URL for links (MCP results, email logo). Also the host OAuth answers on | |
| `OAUTH_HOSTS` | Extra hostnames for OAuth (comma list). SITE_URL, its www/apex twin and the Railway domain are automatic | |
| `DATA_DIR`, `ADMIN_TOKEN` | SQLite location; legacy CSV token | |

## Admin panel (/admin)
Password login (`ADMIN_PASSWORD`, 30-day HttpOnly session cookie, 10 failed tries per IP per 15 min).
Projects: add, edit text, show/hide, home-page feature, reorder (drag on desktop, arrows on phones).
Photos: upload (multi-select or drag in, up to 30MB each, resized to 2500 + 1000px WebP), reorder, set cover, remove.
Version history per project with one-click restore. Inquiries: newest first, reply link, CSV export.
It calls the same `server/projects.ts` functions as the MCP, so history and image handling are identical. Design and videos are not editable.

## Tracking (Meta Pixel + Google tag)
Injected server-side into the public pages only when the IDs are set (never on /admin). Page views: GA4 counts SPA
route changes itself (enhanced measurement, on by default); Meta gets a `PageView` per route change.
Conversion: a successful contact form fires GA4 `generate_lead` and Meta `Lead` (plus the Google Ads conversion if
`GOOGLE_ADS_CONVERSION` is set). In GA4, mark `generate_lead` as a key event to import it into Google Ads.

## Automation: instant auto-reply
Every new inquiry gets a branded (dark + orange) "Got it" email with a recap of what they sent; replies go to `CONTACT_TO`.
Skipped when `RESEND_API_KEY` or `CONTACT_FROM` is unset, and at most once per email address per 24h so the form can't be used to spam someone.
`leads.auto_replied` records whether it went out. For testing, `RESEND_API_URL` can point at a local mock instead of Resend.

## Deploy (Railway)
Dockerfile included. One service, attach a volume at `/data` so the SQLite file survives redeploys.

`.railwayignore` keeps `dist/` and `node_modules/` out of the upload (Railway rejects uploads over ~200MB). Patterns are root-anchored so `src/data/` is still uploaded.

Video loops are cut in one pass from the 1080p source (`../assets/raw`), with native 9:16 crops for phones so nothing gets upscaled.

## MCP (update the site by asking Claude)
Projects live in SQLite (`server/projects.ts`); `src/data/projects.ts` is only the first-boot seed. The server injects
the live list into every page as `window.__PROJECTS__`. Every change is snapshotted to `project_history`.

Endpoint: `POST /mcp` (stateless Streamable HTTP). Three ways in:
- **OAuth** (claude.ai custom connector): Settings > Connectors > Add custom connector, URL `https://<site>/mcp`, no client ID/secret.
  Connect opens a Shift 4 login page; the `ADMIN_PASSWORD` approves it. The site is its own OAuth 2.1 server
  (discovery, dynamic client registration, PKCE, refresh rotation, revoke; MCP SDK handlers in `server/oauth.ts`).
  Access tokens last 24h, refresh tokens 90 days, all stored hashed in SQLite. Changing `ADMIN_PASSWORD` does not kill
  existing tokens; to cut everyone off, clear the `oauth_tokens` table.
- Header `Authorization: Bearer <MCP_TOKEN>` (Claude Code, Claude Desktop, Cursor)
- Secret path `/mcp/<MCP_TOKEN>` (fallback for clients with no auth support). Treat that URL like a password.

Tools: list_projects, get_project, create_project, update_project, hide_project, reorder_projects,
add_project_photo (URL or base64, auto-resized to 2500 + 1000px WebP in `/data/uploads`), set_project_photos,
project_history, restore_project_version, list_inquiries. No delete tool on purpose: hide instead.

Connect from Claude Code (token lives in `~/.claude/.secrets/shift4.env`):
```
set -a; source ~/.claude/.secrets/shift4.env; set +a
claude mcp add --transport http shift4 "$SHIFT4_MCP_URL" --header "Authorization: Bearer $SHIFT4_MCP_TOKEN"
```
Smoke tests:
- `MCP_URL=... MCP_TOKEN=... node scripts/mcp-smoke.mjs` (add `--write` only against local)
- `SITE=https://... ADMIN_PASSWORD=... node scripts/oauth-smoke.mjs` runs the full claude.ai-style OAuth flow, calls the MCP with the token, then revokes it.

Admin password lives in `~/.claude/.secrets/shift4.env` as `SHIFT4_ADMIN_PASSWORD` (Railway var `ADMIN_PASSWORD`).
