import { motion } from "motion/react";
import { useEffect } from "react";
import { useLenis } from "../lib/scroll";

export default function ReelModal({ onClose, start = 0 }: { onClose: () => void; start?: number }) {
  const lenis = useLenis();
  useEffect(() => {
    lenis.current?.stop();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => { lenis.current?.start(); window.removeEventListener("keydown", key); };
  }, [onClose, lenis]);

  return (
    <motion.div className="reel-modal" role="dialog" aria-modal="true" aria-label="Showreel"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <button className="close btn" onClick={onClose}>Close ✕</button>
      <video src={`/video/full-reel.mp4#t=${start}`} poster="/video/hero-poster.jpg" controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
    </motion.div>
  );
}
