import { AnimatePresence, motion, useMotionValue, useSpring } from "motion/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { srcSet, thumb, type Project } from "../data/projects";

/** Numbered project list. Desktop: image trails the cursor. Mobile: thumbs inline. */
export default function WorkIndex({ items, numberFrom = 1 }: { items: Project[]; numberFrom?: number }) {
  const [hover, setHover] = useState<Project | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 30, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 260, damping: 30, mass: 0.6 });

  return (
    <div onMouseMove={(e) => { x.set(e.clientX + 24); y.set(e.clientY - 130); }} onMouseLeave={() => setHover(null)}>
      <ul className="index-list">
        {items.map((p, i) => (
          <li key={p.slug}>
            <Link to={`/projects/${p.slug}`} className="index-row" onMouseEnter={() => setHover(p.photos.length ? p : null)}>
              <span className="n mono">{String(numberFrom + i).padStart(2, "0")}</span>
              <span className="t">{p.client}</span>
              <span className="c mono">{p.title}</span>
              <span className="tags mono mute">{p.disciplines.map((d) => <span key={d}>{d}</span>)}</span>
              <span className="cnt mono" style={{ textAlign: "right" }}>{p.photos.length ? `[${p.photos.length}]` : ""}</span>
              {p.photos.length > 0 && (
                <span className="thumb"><img src={thumb(p.photos[0])} srcSet={srcSet(p.photos[0])} sizes="100vw" alt="" loading="lazy" decoding="async" /></span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <motion.div className="cursor-preview" style={{ x: sx, y: sy }} aria-hidden>
        <AnimatePresence mode="popLayout">
          {hover && (
            <motion.img key={hover.slug} src={thumb(hover.photos[0])} alt=""
              initial={{ opacity: 0, scale: 1.15 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
