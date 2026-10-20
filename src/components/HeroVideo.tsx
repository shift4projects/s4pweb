import { useEffect, useRef } from "react";
import { reducedMotion, useMedia } from "../lib/hooks";

type Props = {
  src: string; mobileSrc?: string; poster: string; mobilePoster?: string;
  /** Called every frame with the playhead and duration (for progress bars / timecode). */
  onFrame?: (time: number, duration: number) => void;
};

/** Muted looping background video. Phones get a native vertical cut (no upscaling); reduced-motion gets the poster. */
export default function HeroVideo({ src, mobileSrc, poster, mobilePoster, onFrame }: Props) {
  const small = useMedia("(max-width: 760px)");
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { ref.current?.play().catch(() => {}); }, [small]);
  const frame = useRef(onFrame);
  frame.current = onFrame;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = ref.current;
      if (v && v.duration) frame.current?.(v.currentTime, v.duration);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const still = small && mobilePoster ? mobilePoster : poster;
  if (reducedMotion()) return <img className="poster" src={still} alt="" />;
  return (
    <video ref={ref} key={small ? "m" : "d"} src={small && mobileSrc ? mobileSrc : src} poster={still}
      autoPlay muted loop playsInline preload="auto" aria-hidden />
  );
}
