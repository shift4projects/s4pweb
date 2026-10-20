import { Link } from "react-router-dom";
import { CITIES } from "../data/projects";
import { SERVICES } from "../data/services";
import { timeIn, useNow } from "../lib/hooks";
import { NAV } from "./Header";

export default function Footer() {
  const now = useNow();
  return (
    <footer className="footer">
      <Link to="/contact" className="cta">
        <span className="mono mute">Start a project</span>
        <span className="display xl" style={{ display: "block", marginTop: 14 }}>
          Let’s build your <br />next event <span className="arrow accent">→</span>
        </span>
      </Link>

      <div className="grid">
        <div>
          <p className="mono mute" style={{ marginBottom: 12 }}>Local time</p>
          {CITIES.map((c) => (
            <div className="clock mono" key={c.name}>
              <span>{c.name}</span>
              <span className="mute">{timeIn(c.tz, now)}</span>
            </div>
          ))}
        </div>
        <div className="mono">
          <p className="mute" style={{ marginBottom: 12 }}>Pages</p>
          <Link to="/">Home</Link>
          {NAV.map((n) => <Link key={n.to} to={n.to}>{n.label}</Link>)}
        </div>
        <div className="mono">
          <p className="mute" style={{ marginBottom: 12 }}>Services</p>
          {SERVICES.map((s) => (
            <Link key={s.slug} to={s.page ?? `/services#${s.slug}`}>{s.title}</Link>
          ))}
        </div>
        <div className="mono">
          <p className="mute" style={{ marginBottom: 12 }}>Follow</p>
          <a href="https://instagram.com/shift4projects" target="_blank" rel="noreferrer">Instagram ↗</a>
        </div>
      </div>

      <div className="base mono mute">
        <span>© {now.getFullYear()} Shift 4 Projects</span>
        <span>Event technology &amp; production</span>
      </div>
    </footer>
  );
}
