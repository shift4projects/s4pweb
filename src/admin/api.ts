import type { Discipline, Project } from "../data/projects";

export type StoredProject = Project & { hidden: boolean; position: number; updated_at: string };
export type Version = { id: number; action: string; at: string; title: string; photos: number; hidden: boolean };
export type Inquiry = {
  id: number; created_at: string; name: string; email: string; company?: string; phone?: string;
  services?: string; event_date?: string; city?: string; message: string; emailed: number; auto_replied: number;
};
export type Fields = {
  client: string; title: string; disciplines: Discipline[]; summary: string; scope: string[];
  location?: string; credits?: string; video?: string; featured?: boolean;
};

export class AuthError extends Error {}

/** JSON fetch against /api/admin. Throws the server's error message; AuthError when the session is gone. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; raw?: Blob } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method || (opts.body !== undefined || opts.raw ? "POST" : "GET"), credentials: "same-origin" };
  if (opts.raw) {
    init.body = opts.raw;
    init.headers = { "Content-Type": opts.raw.type && opts.raw.type.startsWith("image/") ? opts.raw.type : "image/jpeg" };
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await fetch(`/api/admin${path}`, init);
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") throw new AuthError(json.error || "Please sign in again.");
  if (res.status === 413) throw new Error("That file is too big (30MB max).");
  if (!res.ok) throw new Error(json.error || `Something went wrong (${res.status})`);
  return json as T;
}

export const thumb = (url: string) => url.replace(/\.webp$/, "-sm.webp");

/** SQLite stores UTC as "YYYY-MM-DD HH:MM:SS". */
export const when = (s: string) =>
  new Date(s.replace(" ", "T") + "Z").toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
