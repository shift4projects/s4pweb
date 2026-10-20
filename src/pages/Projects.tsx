import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import WorkIndex from "../components/WorkIndex";
import { DISCIPLINES, PROJECTS, srcSet, thumb, type Discipline } from "../data/projects";
import { useTitle } from "../lib/hooks";

function Count({ value }: { value: number }) {
  const mv = useMotionValue(value);
  const txt = useTransform(mv, (v) => String(Math.round(v)).padStart(2, "0"));
  useEffect(() => { const c = animate(mv, value, { duration: 0.6, ease: "easeOut" }); return c.stop; }, [value, mv]);
  return <motion.sup>{txt}</motion.sup>;
}

export default function Projects() {
  useTitle("Projects");
  const [params, setParams] = useSearchParams();
  const f = (params.get("f") as Discipline | null) ?? "All";
  const view = params.get("v") === "index" ? "index" : "grid";
  const list = f === "All" ? PROJECTS : PROJECTS.filter((p) => p.disciplines.includes(f as Discipline));

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <>
      <header className="page-head">
        <h1 className="display xl">Projects<Count value={list.length} /></h1>
      </header>

      <div className="toolbar mono">
        <div className="filters" role="group" aria-label="Filter by discipline">
          {(["All", ...DISCIPLINES] as const).map((d) => (
            <button key={d} aria-pressed={f === d} onClick={() => set("f", d === "All" ? null : d)}>
              {d}<sup>{d === "All" ? PROJECTS.length : PROJECTS.filter((p) => p.disciplines.includes(d)).length}</sup>
            </button>
          ))}
        </div>
        <div className="view-toggle" role="group" aria-label="View">
          <button aria-pressed={view === "grid"} onClick={() => set("v", null)}>Grid</button>
          <button aria-pressed={view === "index"} onClick={() => set("v", "index")}>Index</button>
        </div>
      </div>

      {view === "grid" ? (
        <motion.div layout className="work-grid">
          <AnimatePresence mode="popLayout">
            {list.map((p, i) => (
              <motion.div key={p.slug} layout initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.7, delay: Math.min(i, 6) * 0.05, ease: [0.22, 1, 0.36, 1] }}>
                <Link to={`/projects/${p.slug}`} className="tile">
                  <div className="ph">
                    {p.photos.length
                      ? <img src={thumb(p.photos[0])} srcSet={srcSet(p.photos[0])} sizes="(min-width: 1100px) 33vw, (min-width: 700px) 50vw, 100vw" alt={`${p.client}: ${p.title}`} loading="lazy" decoding="async" />
                      : <div className="need mono mute">Photos coming</div>}
                    {p.photos.length > 1 && <span className="count mono">{p.photos.length} photos</span>}
                    <span className="view mono" aria-hidden>View project →</span>
                  </div>
                  <div className="meta">
                    <div>
                      <b>{p.client}</b>
                      <span className="mono mute">{p.title}</span>
                    </div>
                    <span className="mono mute" style={{ textAlign: "right" }}>{p.disciplines.join(" · ")}</span>
                  </div>
                </Link>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      ) : (
        <div className="wrap" style={{ paddingBottom: 110 }}>
          <WorkIndex items={list} />
        </div>
      )}
    </>
  );
}
