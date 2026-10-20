import { motion } from "motion/react";
import { useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import HeroVideo from "../components/HeroVideo";
import ServiceStack from "../components/ServiceStack";
import Marquee from "../components/Marquee";
import Reveal from "../components/Reveal";
import ScrollWords from "../components/ScrollWords";
import WorkIndex from "../components/WorkIndex";
import WorkRows from "../components/WorkRows";
import { CITIES, FEATURED_PROJECTS, PROJECTS } from "../data/projects";
import { timeIn, useNow, useTitle } from "../lib/hooks";


const ease = [0.22, 1, 0.36, 1] as const;

/** HH:MM:SS:FF at 30fps, like a playback monitor. */
const timecode = (t: number) => {
  const p = (n: number) => String(Math.floor(n)).padStart(2, "0");
  return `${p(t / 3600)}:${p((t / 60) % 60)}:${p(t % 60)}:${p((t % 1) * 30)}`;
};

export default function Home({ onReel }: { onReel: () => void }) {
  useTitle();
  const now = useNow();
  const featured = FEATURED_PROJECTS.slice(0, 8);
  // Side-by-side comparison: /?work=images shows the always-visible image version.
  const [params] = useSearchParams();
  const imagesFirst = params.get("work") === "images";
  const barRef = useRef<HTMLSpanElement>(null);
  const tcRef = useRef<HTMLSpanElement>(null);
  // Updates the DOM directly each frame (no React re-render).
  const onFrame = useCallback((t: number, d: number) => {
    if (barRef.current) barRef.current.style.transform = `scaleX(${t / d})`;
    if (tcRef.current) tcRef.current.textContent = timecode(t);
  }, []);

  return (
    <>
      {/* 01: pinned reel hero, the first panel glides up over it */}
      <div>
        <section className="hero" aria-label="Showreel">
          <HeroVideo src="/video/hero-loop.mp4" mobileSrc="/video/hero-loop-mobile.mp4" poster="/video/hero-poster.jpg" mobilePoster="/video/hero-poster-mobile.jpg" onFrame={onFrame} />
          <div className="hero-top mono">
            <span>Full-service event technology<br />&amp; production</span>
            <div className="clocks">
              {CITIES.map((c) => <span key={c.name}>{c.name}</span>)}
              {CITIES.map((c) => <span key={c.name} className="mute">{timeIn(c.tz, now)}</span>)}
            </div>
          </div>
          <div className="hero-inner">
            <h1 className="display xl">
              {["Event technology", "& production"].map((l, i) => (
                <span className="line" key={l}>
                  <motion.span initial={{ y: "105%" }} animate={{ y: 0 }} transition={{ duration: 1.1, delay: 0.25 + i * 0.09, ease }}>
                    {l}
                  </motion.span>
                </span>
              ))}
            </h1>
            <motion.div className="hero-reel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9, duration: 0.8 }}>
              <button className="reel-btn" onClick={onReel}>
                <span className="mono tc" ref={tcRef} aria-hidden>00:00:00:00</span>
                <span className="mono">Play full reel</span>
                <span className="dot" aria-hidden>▶</span>
              </button>
            </motion.div>
          </div>
          {/* playhead for the loop running behind the headline */}
          <div className="reel-progress" aria-hidden><span ref={barRef} /></div>
        </section>

        <div className="glide">
          <section className="block manifesto">
            <p className="mono mute">About us</p>
            <div>
              <ScrollWords
                className="statement"
                text="A full-service event technology and production company based in Los Angeles. Event tech rentals and hands-on production support, from LED walls to audio systems, for projects of any scale, from single-day installs to multi-city activations."
              />
              <Reveal>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 40 }}>
                  <Link to="/projects" className="btn solid">See the work <span className="arrow">→</span></Link>
                  <Link to="/contact" className="btn">Get in touch</Link>
                </div>
              </Reveal>
            </div>
          </section>

          <section className="wrap" style={{ paddingBottom: 110 }}>
            <div className="sec-head">
              <h2 className="display md">Selected work</h2>
              <span className="mono mute">{String(PROJECTS.length).padStart(2, "0")} projects</span>
            </div>
            {imagesFirst ? <WorkRows items={featured} /> : <WorkIndex items={featured} />}
            <div style={{ marginTop: 36 }}>
              <Link to="/projects" className="btn">All projects <span className="arrow">→</span></Link>
            </div>
          </section>

          <Marquee />
        </div>
      </div>

      {/* 02: services, each card glides over the last */}
      <ServiceStack>
        <div className="glide ink">
          <section className="block">
            <p className="mono mute" style={{ marginBottom: 24 }}>Any scale</p>
            <h2 className="display lg">No job too big… <br />or too small</h2>
            <div className="split" style={{ marginTop: 50 }}>
              <p className="body-lg">
                From intimate gatherings to large-scale productions, we approach every project with the same level of care,
                precision, and attention to detail. Whether you’re planning a small showcase or a major brand moment, we’ve got you covered.
              </p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                <Link to="/contact" className="btn" style={{ borderColor: "#0a0a0b" }}>Tell us about your event <span className="arrow">→</span></Link>
                <Link to="/services" className="btn" style={{ borderColor: "#0a0a0b" }}>All services <span className="arrow">→</span></Link>
              </div>
            </div>
          </section>
        </div>
      </ServiceStack>
    </>
  );
}
