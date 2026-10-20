import { Link } from "react-router-dom";
import Reveal from "../components/Reveal";
import ScrollWords from "../components/ScrollWords";
import { img } from "../data/projects";
import { useTitle } from "../lib/hooks";

const LIST = [
  "Site survey and network planning prior to event day",
  "Enterprise-grade hardware deployed and configured on-site",
  "Dedicated bandwidth, no shared public networks",
  "Scalable coverage for small gatherings to large-scale productions",
  "On-site technical support throughout the event",
  "Compatible with live streaming, digital activations, POS systems and production comms",
];
const PLACES = ["The desert", "Private estates", "Rooftop activations", "Underground venues"];

export default function Wifi() {
  useTitle("WiFi Solutions");
  return (
    <div>
      <section className="media-hero">
        <img src={img("video-village", 1)} alt="" />
        <div className="inner">
          <p className="mono" style={{ marginBottom: 16 }}>WiFi solutions</p>
          <h1 className="display lg">Any venue.<br />Any terrain.<br /><span className="accent">Always connected.</span></h1>
        </div>
      </section>

      <div className="glide">
        <section className="block manifesto">
          <p className="mono mute">Deployed in</p>
          <div>
            <ScrollWords className="statement" text="We’ve deployed reliable WiFi in the desert, on private estates, at rooftop activations and in underground venues." />
            <Reveal>
              <div className="split" style={{ marginTop: 40 }}>
                <p className="body-lg mute">
                  If your event is happening there, we can get a signal there. Shift4 Projects brings enterprise-level connectivity to locations
                  standard providers can’t reach, because the best events don’t wait for perfect conditions.
                </p>
                <div className="mono" style={{ display: "grid", gap: 10 }}>
                  {PLACES.map((p) => <span key={p}><span className="accent">● </span>{p}</span>)}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="wrap" style={{ paddingBottom: 140 }}>
          <div className="sec-head"><h2 className="display md">What you get</h2><span className="mono mute">06</span></div>
          <ul className="rows">
            {LIST.map((t, i) => <li key={t}><span className="n mono">0{i + 1}</span><h3>{t}</h3><p /></li>)}
          </ul>
          <Reveal>
            <p className="statement" style={{ marginTop: 80, maxWidth: "22ch" }}>
              Tell us where you’re producing and we’ll engineer a solution built for that exact environment.
            </p>
            <div style={{ marginTop: 34 }}><Link to="/contact?service=WiFi" className="btn solid">Request a quote <span className="arrow">→</span></Link></div>
          </Reveal>
        </section>
      </div>
    </div>
  );
}
