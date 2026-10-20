import { StrictMode, useCallback, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, AuthError, when, type Inquiry } from "./api";
import ProjectList from "./ProjectList";
import Editor from "./Editor";
import "./admin.css";

type Me = { enabled: boolean; signedIn: boolean };

function Login({ enabled, onIn }: { enabled: boolean; onIn: () => void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api("/login", { body: { password: new FormData(e.currentTarget).get("password") } });
      onIn();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <main className="login">
      <img src="/img/logo-white.png" alt="Shift 4 Projects" />
      <h1>Site admin</h1>
      {enabled ? (
        <form onSubmit={submit}>
          <label className="lbl" htmlFor="pw">Password</label>
          <input id="pw" name="password" type="password" autoComplete="current-password" required autoFocus />
          <button className="btn solid wide" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          {err && <p className="err">{err}</p>}
        </form>
      ) : (
        <p className="mute">Admin isn’t switched on yet. Set ADMIN_PASSWORD on the server.</p>
      )}
    </main>
  );
}

function Inquiries({ onAuth }: { onAuth: (e: unknown) => void }) {
  const [rows, setRows] = useState<Inquiry[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api<Inquiry[]>("/inquiries").then(setRows).catch((e) => { onAuth(e); setErr(e.message); }); }, [onAuth]);
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Inquiries</h1>
          <p className="mute">{rows ? `${rows.length} from the contact form, newest first` : "Loading…"}</p>
        </div>
        <a className="btn" href="/api/admin/inquiries.csv" download>Export CSV</a>
      </div>
      {err && <p className="err">{err}</p>}
      {rows?.length === 0 && <p className="empty">No inquiries yet. They show up here the moment someone sends the contact form.</p>}
      <div className="inq-list">
        {rows?.map((r) => (
          <article key={r.id} className="inq">
            <header>
              <div>
                <h2>{r.name}{r.company && <span className="mute"> · {r.company}</span>}</h2>
                <p className="mono mute">{when(r.created_at)}</p>
              </div>
              <a className="btn small" href={`mailto:${r.email}?subject=${encodeURIComponent("Re: your Shift 4 Projects inquiry")}`}>Reply</a>
            </header>
            <dl>
              <div><dt>Email</dt><dd><a href={`mailto:${r.email}`}>{r.email}</a></dd></div>
              {r.phone && <div><dt>Phone</dt><dd><a href={`tel:${r.phone}`}>{r.phone}</a></dd></div>}
              {r.services && <div><dt>Services</dt><dd>{r.services}</dd></div>}
              {r.event_date && <div><dt>Date</dt><dd>{r.event_date}</dd></div>}
              {r.city && <div><dt>City</dt><dd>{r.city}</dd></div>}
            </dl>
            <p className="msg">{r.message}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Nav() {
  const inq = useLocation().pathname.startsWith("/inquiries");
  return (
    <nav>
      <Link to="/" className={inq ? "" : "on"}>Projects</Link>
      <Link to="/inquiries" className={inq ? "on" : ""}>Inquiries</Link>
    </nav>
  );
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const refresh = useCallback(() => { api<Me>("/me").then(setMe).catch(() => setMe({ enabled: false, signedIn: false })); }, []);
  useEffect(refresh, [refresh]);
  // Any API call that comes back 401 drops us to the login screen.
  const onAuth = useCallback((e: unknown) => { if (e instanceof AuthError) setMe((m) => (m ? { ...m, signedIn: false } : m)); }, []);

  if (!me) return null;
  if (!me.signedIn) return <Login enabled={me.enabled} onIn={refresh} />;

  const signOut = async () => { await api("/logout", { body: {} }).catch(() => {}); refresh(); };
  return (
    <>
      <header className="bar">
        <a href="/admin" className="brand"><img src="/img/logo-white.png" alt="Shift 4 Projects" /><span className="mono">Admin</span></a>
        <Nav />
        <div className="bar-end">
          <a href="/" target="_blank" rel="noreferrer" className="mono">View site ↗</a>
          <button className="mono link" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<ProjectList onAuth={onAuth} />} />
        <Route path="/projects/new" element={<Editor key="new" onAuth={onAuth} />} />
        <Route path="/projects/:slug" element={<Editor onAuth={onAuth} />} />
        <Route path="/inquiries" element={<Inquiries onAuth={onAuth} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/admin">
      <App />
    </BrowserRouter>
  </StrictMode>
);
