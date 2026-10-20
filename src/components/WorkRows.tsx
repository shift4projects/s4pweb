import { Link } from "react-router-dom";
import { srcSet, thumb, type Project } from "../data/projects";
import Reveal from "./Reveal";

/** Image-forward take on the numbered list: every row shows its cover, no hover needed. */
export default function WorkRows({ items }: { items: Project[] }) {
  return (
    <ul className="work-rows">
      {items.map((p, i) => (
        <li key={p.slug}>
          <Reveal y={40}>
            <Link to={`/projects/${p.slug}`} className="wr-row">
              <span className="n mono">{String(i + 1).padStart(2, "0")}</span>
              <span className="wr-text">
                <span className="wr-title">{p.client}</span>
                <span className="mono mute">{p.title}</span>
                <span className="mono mute wr-tags">{p.disciplines.join(" · ")}</span>
                <span className="mono wr-view">View project <span className="arrow">→</span></span>
              </span>
              {p.photos[0] && (
                <span className="wr-img">
                  <img src={thumb(p.photos[0])} srcSet={srcSet(p.photos[0])} sizes="(min-width: 900px) 40vw, 100vw" alt={`${p.client}: ${p.title}`} loading="lazy" decoding="async" />
                </span>
              )}
            </Link>
          </Reveal>
        </li>
      ))}
    </ul>
  );
}
