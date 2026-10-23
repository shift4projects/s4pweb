import { Link, useParams } from "react-router-dom";
import Reveal from "../components/Reveal";
import { useTitle } from "../lib/hooks";
import NotFound from "./NotFound";

// The Insights section (articles). Hidden until the server enables it; posts arrive as rendered HTML
// in window.__POSTS__, written and published through the MCP.

export type PublicPost = {
  slug: string; title: string; excerpt: string | null; cover: string | null; tags: string[]; faq: { q: string; a: string }[];
  html: string; text: string; words: number; reading_min: number; published_at: string | null; updated_at: string;
};
declare global { interface Window { __POSTS__?: PublicPost[] } }
const POSTS: PublicPost[] = (typeof window !== "undefined" && window.__POSTS__) || [];

const when = (iso: string | null) => (iso ? new Date(iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export function InsightsIndex() {
  useTitle("Insights");
  if (!POSTS.length) return <NotFound />;
  return (
    <>
      <header className="page-head">
        <p className="mono mute">Insights</p>
        <h1 className="display xl" style={{ marginTop: 14 }}>Notes from<br />the floor</h1>
      </header>
      <section className="wrap" style={{ paddingBottom: 120 }}>
        <ul className="post-list">
          {POSTS.map((p, i) => (
            <Reveal key={p.slug} delay={i * 0.04}>
              <li>
                <Link to={`/insights/${p.slug}`} className="post-row">
                  {p.cover && <span className="ph"><img src={p.cover} alt="" loading="lazy" decoding="async" /></span>}
                  <span className="meta">
                    <span className="mono mute">{when(p.published_at)} · {p.reading_min} min read</span>
                    <b className="display">{p.title}</b>
                    {p.excerpt && <span className="body">{p.excerpt}</span>}
                  </span>
                </Link>
              </li>
            </Reveal>
          ))}
        </ul>
      </section>
    </>
  );
}

export function PostPage() {
  const { slug } = useParams();
  const p = POSTS.find((x) => x.slug === slug);
  useTitle(p?.title ?? "Not found");
  if (!p) return <NotFound />;
  return (
    <article className="post">
      <header className="page-head">
        <Link to="/insights" className="mono mute">← Insights</Link>
        <h1 className="display lg" style={{ marginTop: 28 }}>{p.title}</h1>
        <p className="mono mute" style={{ marginTop: 18 }}>{when(p.published_at)} · {p.reading_min} min read{p.tags.length ? ` · ${p.tags.join(" · ")}` : ""}</p>
      </header>
      {p.cover && <div className="wrap"><img className="post-cover" src={p.cover} alt="" /></div>}
      <div className="wrap post-body" dangerouslySetInnerHTML={{ __html: p.html }} />
      {p.faq.length > 0 && (
        <section className="wrap post-faq">
          <h2 className="display md">FAQ</h2>
          {p.faq.map((f) => (
            <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>
          ))}
        </section>
      )}
      <footer className="wrap" style={{ paddingBottom: 120 }}>
        <Link to="/contact" className="btn">Tell us about your event <span className="arrow">→</span></Link>
      </footer>
    </article>
  );
}
