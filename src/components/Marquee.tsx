import { CLIENT_LOGOS } from "../data/projects";

/** Client logos drifting slowly at a constant speed. Pauses on hover; still for reduced motion. */
export default function Marquee() {
  const set = (copy: number) => (
    <div className="mq-set" aria-hidden={copy > 0}>
      {CLIENT_LOGOS.map((l) => (
        <img key={l.file} className={`mq-logo${l.raw ? " raw" : ""}`} src={`/logos/${l.file}`} alt={copy ? "" : l.name}
          style={{ height: `calc(var(--logo-h) * ${l.scale})` }} loading="lazy" decoding="async" />
      ))}
    </div>
  );

  return (
    <div className="mq" aria-label="Clients">
      <div className="mq-track">
        {set(0)}
        {set(1)}
      </div>
    </div>
  );
}
