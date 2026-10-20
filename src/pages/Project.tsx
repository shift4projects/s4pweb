import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import Reveal from "../components/Reveal";
import { PROJECTS, ratioOf, srcSet, thumb } from "../data/projects";
import { useTitle } from "../lib/hooks";
import { useLenis } from "../lib/scroll";
import NotFound from "./NotFound";

/**
 * Lays photos out in rows that keep their real shape: pairs share a row at equal height,
 * and a landscape that follows a pair gets a full-width row of its own for rhythm.
 */
function galleryRows(photos: string[]): string[][] {
  const rows: string[][] = [];
  let lastWasPair = false;
  for (let i = 0; i < photos.length; ) {
    const wide = ratioOf(photos[i]) >= 1.25;
    if ((wide && lastWasPair) || i === photos.length - 1) {
      rows.push([photos[i]]); lastWasPair = false; i += 1;
    } else {
      rows.push([photos[i], photos[i + 1]]); lastWasPair = true; i += 2;
    }
  }
  return rows;
}

function Lightbox({ photos, index, onClose, onGo }: { photos: string[]; index: number; onClose: () => void; onGo: (i: number) => void }) {
  const count = photos.length;
  const lenis = useLenis();
  useEffect(() => {
    lenis.current?.stop();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onGo((index + 1) % count);
      if (e.key === "ArrowLeft") onGo((index - 1 + count) % count);
    };
    window.addEventListener("keydown", key);
    return () => { lenis.current?.start(); window.removeEventListener("keydown", key); };
  }, [index, count, onClose, onGo, lenis]);

  return (
    <motion.div className="lightbox" role="dialog" aria-modal="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <div className="lb-bar mono"><span>{String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}</span><button onClick={onClose}>Close ✕</button></div>
      <AnimatePresence mode="wait">
        <motion.img key={index} src={photos[index]} alt="" onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} />
      </AnimatePresence>
      {count > 1 && (
        <div className="lb-nav mono" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onGo((index - 1 + count) % count)}>← Prev</button>
          <button onClick={() => onGo((index + 1) % count)}>Next →</button>
        </div>
      )}
    </motion.div>
  );
}

export default function ProjectPage() {
  const { slug } = useParams();
  const i = PROJECTS.findIndex((p) => p.slug === slug);
  const p = PROJECTS[i];
  useTitle(p ? `${p.client}: ${p.title}` : "Not found");
  const [lb, setLb] = useState<number | null>(null);
  const close = useCallback(() => setLb(null), []);
  if (!p) return <NotFound />;

  const n = PROJECTS.length;
  const prev = PROJECTS[(i - 1 + n) % n];
  const next = PROJECTS[(i + 1) % n];
  // The next three projects that have photos, wrapping around the list.
  const more = PROJECTS.slice(i + 1).concat(PROJECTS.slice(0, i)).filter((x) => x.photos.length).slice(0, 3);
  const [cover, ...rest] = p.photos;
  // With just one extra photo, it sits beside the description instead of alone in a gallery.
  const lone = rest.length === 1 ? rest[0] : null;

  return (
    <>
      <div>
        {cover ? (
          <section className="media-hero proj-cover" aria-label={`${p.client}: ${p.title}`}>
            <img src={cover} srcSet={srcSet(cover)} sizes="100vw" alt={`${p.client}: ${p.title}`} />
            <div className="inner">
              <Link to="/projects" className="mono back">← All projects</Link>
              <h1 className="display xl" style={{ marginTop: 28 }}>{p.client}</h1>
              <p className="mono" style={{ marginTop: 14, fontSize: 13 }}>{p.title}</p>
              <div className="cover-bar mono">
                <span>{p.disciplines.join(" · ")}</span>
                {p.location && <span className="mute">{p.location}</span>}
                <button onClick={() => setLb(0)}>{p.photos.length > 1 ? `${p.photos.length} photos` : "View photo"} <span className="arrow">↗</span></button>
              </div>
            </div>
          </section>
        ) : (
          <header className="proj-hero">
            <Link to="/projects" className="mono mute">← All projects</Link>
            <h1 className="display lg" style={{ marginTop: 36 }}>{p.client}</h1>
            <p className="mono" style={{ marginTop: 14 }}>{p.title}</p>
            <p className="mono mute" style={{ marginTop: 24 }}>Project photography coming soon</p>
          </header>
        )}

        <div className={cover ? "glide" : ""}>
          <section className={`block proj-info${lone ? " with-photo" : ""}`}>
            <div className="proj-cols">
              <div>
              <Reveal><p className="statement proj-summary">{p.summary}</p></Reveal>
              <Reveal delay={0.1}>
                <div className="proj-meta mono">
                  <div><span className="mute">Client</span><span>{p.client}</span></div>
                  <div><span className="mute">Disciplines</span><span>{p.disciplines.join(" · ")}</span></div>
                  <div><span className="mute">Scope</span><span>{p.scope.join(" / ")}</span></div>
                  {p.location && <div><span className="mute">Location</span><span>{p.location}</span></div>}
                  {p.credits && <div><span className="mute">Credits</span><span>{p.credits}</span></div>}
                </div>
              </Reveal>
              </div>
              {lone && (
                <Reveal delay={0.15} className="lone-photo">
                  <button onClick={() => setLb(1)} aria-label="Open image 2" style={{ aspectRatio: String(ratioOf(lone)) }}>
                    <img src={lone} srcSet={srcSet(lone)} sizes="(min-width: 980px) 45vw, 100vw" alt={`${p.client}: ${p.title}, image 2`} loading="lazy" decoding="async" />
                  </button>
                </Reveal>
              )}
            </div>
          </section>

          {rest.length > 1 && (
            <section className="gallery" aria-label="Gallery">
              {galleryRows(rest).map((row, r) => (
                <Reveal key={r} y={50} className="g-row"
                  // Cap each row at ~88% of the screen height: width = 88vh × (sum of photo ratios) + gaps.
                  style={{ maxWidth: `calc(88vh * ${row.reduce((t, u) => t + ratioOf(u), 0).toFixed(3)} + ${(row.length - 1) * 18}px)` }}>
                  {row.map((src) => {
                    const k = p.photos.indexOf(src);
                    const ratio = ratioOf(src);
                    return (
                      <button key={src} onClick={() => setLb(k)} aria-label={`Open image ${k + 1}`}
                        style={{ "--r": ratio, aspectRatio: String(ratio) } as CSSProperties}>
                        <img src={src} srcSet={srcSet(src)} sizes={row.length === 2 ? "(min-width: 760px) 50vw, 100vw" : "100vw"}
                          alt={`${p.client}: ${p.title}, image ${k + 1}`} loading="lazy" decoding="async" />
                      </button>
                    );
                  })}
                </Reveal>
              ))}
            </section>
          )}
        </div>
      </div>

      <section className="more-work wrap" aria-label="More projects">
        <div className="sec-head">
          <h2 className="display md">More projects</h2>
          <Link to="/projects" className="text-link mono">All projects <span className="arrow">→</span></Link>
        </div>
        <div className="more-grid">
          {more.map((m) => (
            <Link key={m.slug} to={`/projects/${m.slug}`} className="tile">
              <div className="ph">
                <img src={thumb(m.photos[0])} srcSet={srcSet(m.photos[0])} sizes="(min-width: 900px) 33vw, 80vw" alt={`${m.client}: ${m.title}`} loading="lazy" decoding="async" />
                <span className="view mono" aria-hidden>View project →</span>
              </div>
              <div className="meta">
                <div>
                  <b>{m.client}</b>
                  <span className="mono mute">{m.title}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <nav className="prev-next mono" aria-label="Project navigation">
        <Link to={`/projects/${prev.slug}`}>← {prev.client}</Link>
        <Link to="/projects" className="mute">Index</Link>
        <Link to={`/projects/${next.slug}`}>{next.client} →</Link>
      </nav>

      <AnimatePresence>{lb !== null && <Lightbox photos={p.photos} index={lb} onClose={close} onGo={setLb} />}</AnimatePresence>
    </>
  );
}
