import PlayIcon from "../components/PlayIcon";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import HeroVideo from "../components/HeroVideo";
import ReelModal from "../components/ReelModal";
import Reveal from "../components/Reveal";
import ScrollWords from "../components/ScrollWords";
import { useTitle } from "../lib/hooks";

const MAKE = [
  ["LED Wall Content", "High-resolution motion graphics and branded video assets sized, formatted and optimized for large-format LED displays."],
  ["Projection Mapping", "Custom visual content designed to wrap, align and transform architectural surfaces, stages and scenic elements."],
  ["Scenic Video Integration", "Motion content woven into the physical environment, so the tech and the design feel like one."],
  ["Brand & Event Loops", "Ambient motion content between moments: logo animations, transition graphics and environmental visuals."],
];
const PROCESS = [
  ["Concept & Pre-Viz", ""],
  ["2D Pixel Mapping", ""],
  ["Themed Environment Design", ""],
  ["AV & Show Technology", "Projection, lighting, sound design"],
];
// Placeholder chapters cut from the main reel until dedicated motion reels arrive.
const REELS = [
  { start: 5, poster: "/video/reel-20.jpg", len: "0:50" },
  { start: 60, poster: "/video/reel-62.jpg", len: "0:30" },
  { start: 120, poster: "/video/reel-130.jpg", len: "1:00" },
];

export default function Animation() {
  useTitle("Animation & Motion Design");
  const [reel, setReel] = useState<number | null>(null);

  return (
    <>
      <div>
        <section className="media-hero">
          <HeroVideo src="/video/anim-loop.mp4" mobileSrc="/video/anim-loop-mobile.mp4" poster="/video/anim-poster.jpg" mobilePoster="/video/anim-poster-mobile.jpg" />
          <div className="inner">
            <p className="mono" style={{ marginBottom: 16 }}>Motion &amp; visual assets</p>
            <h1 className="display xl">Animation &amp;<br />motion design</h1>
          </div>
        </section>

        <div className="glide">
          <section className="block manifesto">
            <p className="mono mute">In-house creative</p>
            <div>
              <ScrollWords className="statement" text="We eliminate the back-and-forth by bringing creative production in-house, under one roof, with one point of contact." />
              <Reveal>
                <p className="body-lg mute" style={{ marginTop: 34 }}>
                  Motion and video assets for LED walls, projection mapping, scenic integration, social media, web and digital, built for live events and beyond.
                </p>
              </Reveal>
            </div>
          </section>

          <section className="wrap" style={{ paddingBottom: 120 }}>
            <div className="sec-head"><h2 className="display md">What we make</h2><span className="mono mute">04</span></div>
            <ul className="rows">
              {MAKE.map(([t, d], i) => (
                <li key={t}><span className="n mono">0{i + 1}</span><h3>{t}</h3><p>{d}</p></li>
              ))}
            </ul>
          </section>

          <section className="wrap" style={{ paddingBottom: 120 }}>
            <div className="sec-head"><h2 className="display md">Sample reels</h2><span className="mono mute">Play</span></div>
            <div className="reels" style={{ marginTop: 24 }}>
              {REELS.map((r, i) => (
                <button key={i} className="reel-card" onClick={() => setReel(r.start)} aria-label={`Play reel ${i + 1}`}>
                  <img src={r.poster} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                  <span className="cap mono"><span>Reel 0{i + 1}</span><span><PlayIcon size={9} /> {r.len}</span></span>
                </button>
              ))}
            </div>
          </section>

          <section className="wrap" style={{ paddingBottom: 140 }}>
            <div className="sec-head"><h2 className="display md">What we do</h2><span className="mono mute">Process</span></div>
            <ul className="rows">
              {PROCESS.map(([t, d], i) => (
                <li key={t}><span className="n mono">0{i + 1}</span><h3>{t}</h3><p>{d}</p></li>
              ))}
            </ul>
            <div style={{ marginTop: 40 }}>
              <Link to="/contact" className="btn solid">Start a motion project <span className="arrow">→</span></Link>
            </div>
          </section>
        </div>
      </div>
      <AnimatePresence>{reel !== null && <ReelModal start={reel} onClose={() => setReel(null)} />}</AnimatePresence>
    </>
  );
}
