import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db";

// One password (ADMIN_PASSWORD) unlocks both the /admin panel and the OAuth login for the MCP connector.
// Sessions are random tokens; only their SHA-256 is stored, so a leaked DB can't be replayed.
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const adminEnabled = () => !!process.env.ADMIN_PASSWORD;

// Failed password attempts: 10 per IP per 15 minutes, shared by /admin and the OAuth login page.
const fails = new Map<string, number[]>();
const WINDOW = 15 * 60_000;
export const lockedOut = (ip: string) => (fails.get(ip) || []).filter((t) => Date.now() - t < WINDOW).length >= 10;

/** Checks the password (constant time) and counts failures per IP. */
export function checkPassword(ip: string, password: unknown): boolean {
  const real = process.env.ADMIN_PASSWORD;
  if (!real || typeof password !== "string") return false;
  const ok = safeEqual(sha256(password), sha256(real));
  if (!ok) fails.set(ip, [...(fails.get(ip) || []).filter((t) => Date.now() - t < WINDOW), Date.now()]);
  return ok;
}

const COOKIE = "s4_admin";
const SESSION_DAYS = 30;

const readCookie = (req: Request, name: string) => {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
};

export function startSession(res: Response) {
  const token = randomToken();
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)").run(sha256(token), expires);
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: SESSION_DAYS * 86_400_000,
  });
}

export function endSession(req: Request, res: Response) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(sha256(token));
  res.clearCookie(COOKIE, { path: "/" });
}

export function hasSession(req: Request): boolean {
  if (!adminEnabled()) return false;
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const row = db.prepare("SELECT expires_at FROM admin_sessions WHERE token_hash = ?").get(sha256(token)) as { expires_at: number } | undefined;
  return !!row && row.expires_at > Date.now();
}

/** Guards admin API routes. Mutations must be JSON or an image upload, which (with SameSite=strict) blocks CSRF from plain forms. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!hasSession(req)) return res.status(401).json({ error: "Please sign in again." });
  if (req.method !== "GET" && !/^(application\/json|image\/)/.test(req.headers["content-type"] || "")) {
    return res.status(415).json({ error: "Unsupported content type" });
  }
  next();
}
