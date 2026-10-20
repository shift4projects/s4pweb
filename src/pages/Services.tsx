import { Link } from "react-router-dom";
import Reveal from "../components/Reveal";
import ServiceStack from "../components/ServiceStack";
import { ADDON_SERVICES, MAIN_SERVICES, SERVICES } from "../data/services";
import { useTitle } from "../lib/hooks";

export default function Services() {
  useTitle("Services");
  return (
    <>
      <header className="page-head">
        <h1 className="display xl">Services<sup>{String(SERVICES.length).padStart(2, "0")}</sup></h1>
        <Reveal>
          <p className="statement" style={{ marginTop: 34, maxWidth: "30ch" }}>
            Event tech rentals and hands-on production support, for projects of any scale.
          </p>
        </Reveal>
        {[{ label: "Main services", items: MAIN_SERVICES }, { label: "Additional Services", items: ADDON_SERVICES }].map((g) => (
          <nav key={g.label} className="svc-group" aria-label={g.label}>
            <p className="mono mute">{g.label}</p>
            <div className="svc-index">
              {g.items.map((s) => (
                <a key={s.slug} href={`#${s.slug}`} className="svc-jump">
                  <span className="mono mute">{String(SERVICES.indexOf(s) + 1).padStart(2, "0")}</span>
                  <span className="svc-jump-t">{s.title}</span>
                  <span className="arrow mono" aria-hidden>↓</span>
                </a>
              ))}
            </div>
          </nav>
        ))}
      </header>

      <ServiceStack>
        <div className="glide ink">
          <section className="block">
            <p className="mono mute" style={{ marginBottom: 24 }}>One team, one point of contact</p>
            <h2 className="display lg">Tell us about<br />your event</h2>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 40 }}>
              <Link to="/contact" className="btn" style={{ borderColor: "#0a0a0b" }}>Get a quote <span className="arrow">→</span></Link>
              <Link to="/projects" className="btn" style={{ borderColor: "#0a0a0b" }}>See the work <span className="arrow">→</span></Link>
            </div>
          </section>
        </div>
      </ServiceStack>
    </>
  );
}
