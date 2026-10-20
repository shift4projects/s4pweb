import Lenis from "lenis";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { reducedMotion } from "./hooks";

const Ctx = createContext<{ current: Lenis | null }>({ current: null });

/** Smooth, weighted scrolling (the "glide"). Native scroll is kept for reduced motion. */
export function SmoothScroll({ children }: { children: ReactNode }) {
  const ref = useRef<Lenis | null>(null);
  useEffect(() => {
    if (reducedMotion()) return;
    const lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
    ref.current = lenis;
    let raf = 0;
    const loop = (t: number) => { lenis.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); lenis.destroy(); ref.current = null; };
  }, []);
  return <Ctx.Provider value={ref}>{children}</Ctx.Provider>;
}

export const useLenis = () => useContext(Ctx);
