import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { PROJECTS } from "../data/projects";
import { SERVICES } from "../data/services";
import HeroVideo from "./HeroVideo";

/**
 * Full-screen service cards that slide up over each other. Used on Home and on /services.
 * `children` render inside the stack so a following panel can glide over the last card.
 */
export default function ServiceStack({ children }: { children?: ReactNode }) {
  const { hash } = useLocation();

  // /services#lighting: jump to that card once the page has settled.
  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => {
      const el = document.getElementById(hash.slice(1));
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY);
    }, 120);
    return () => clearTimeout(t);
  }, [hash]);

  return (
    <div className="stack">
      {SERVICES.map((s, i) => {
        const count = s.discipline ? PROJECTS.filter((p) => p.disciplines.includes(s.discipline!)).length : 0;
        return (
          <section className="stack-card" id={s.slug} key={s.slug} aria-label={s.title}>
            <div className="bg">
              {s.media.type === "video"
                ? <HeroVideo src={s.media.src} mobileSrc={s.media.mobileSrc} poster={s.media.poster} mobilePoster={s.media.mobilePoster} />
                : <img src={s.media.src} alt="" loading="lazy" decoding="async" style={s.media.focus ? { objectPosition: s.media.focus } : undefined} />}
            </div>
            <div className="num mono">
              <span>{s.group === "addon" ? "Additional Services" : "Services"}</span>
              <span>{String(i + 1).padStart(2, "0")} / {String(SERVICES.length).padStart(2, "0")}</span>
            </div>
            <div className="inner">
              <h2 className="display lg">{s.title}</h2>
              <div>
                <p style={{ marginBottom: 22, maxWidth: "52ch", color: "rgba(242,240,235,.82)" }}>{s.copy}</p>
                <ul className="mono">{s.list.map((l) => <li key={l}>{l}</li>)}</ul>
                <div className="card-ctas">
                  <Link to={`/contact?service=${encodeURIComponent(s.name)}`} className="btn solid">
                    Get a quote <span className="arrow">→</span>
                  </Link>
                  {s.page ? (
                    <Link to={s.page} className="text-link mono">Explore {s.title.toLowerCase()} <span className="arrow">→</span></Link>
                  ) : count > 0 ? (
                    <Link to={`/projects?f=${s.discipline}`} className="text-link mono">
                      See {s.name.toLowerCase()} work<sup>{count}</sup><span className="arrow">→</span>
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        );
      })}
      {children}
    </div>
  );
}
