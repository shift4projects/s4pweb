import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { SERVICE_PATHS } from "../data/services";
import { useLenis } from "../lib/scroll";

export const NAV = [
  { to: "/projects", label: "Projects" },
  { to: "/services", label: "Services" },
  { to: "/contact", label: "Contact" },
];
// "Services" stays highlighted on the Animation and WiFi pages too.
const isOn = (to: string, path: string) => (to === "/services" ? SERVICE_PATHS.includes(path) : path.startsWith(to));

export default function Header() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const lenis = useLenis();
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);

  // Always visible so navigation is one tap away. Once you scroll it compacts onto a frosted bar.
  useMotionValueEvent(scrollY, "change", (y) => setSolid(y > 40));

  useEffect(() => setOpen(false), [pathname]);

  // Sticky bars (like the Projects filter) dock right under the header, tracking its height as it compacts.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => document.documentElement.style.setProperty("--hdr-offset", `${el.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (open) lenis.current?.stop(); else lenis.current?.start();
    document.body.style.overflow = open ? "hidden" : "";
  }, [open, lenis]);

  return (
    <>
      <header ref={ref} className={`hdr${solid && !open ? " solid" : ""}`}>
        <Link to="/" className="logo" aria-label="Shift 4 Projects, home">
          <img src="/img/logo-white.png" alt="Shift 4 Projects" width={139} height={60} />
        </Link>
        <nav className="mono" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={isOn(n.to, pathname) ? "on" : ""}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button className={`menu-btn${open ? " open" : ""}`} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span /><span />
        </button>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            className="mnav"
            initial={{ clipPath: "inset(0 0 100% 0)" }}
            animate={{ clipPath: "inset(0 0 0% 0)" }}
            exit={{ clipPath: "inset(0 0 100% 0)" }}
            transition={{ duration: 0.6, ease: [0.76, 0, 0.24, 1] }}
          >
            {[{ to: "/", label: "Home" }, ...NAV].map((n, i) => (
              <motion.div key={n.to} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 + i * 0.05, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
                <NavLink to={n.to} end className={({ isActive }) => `big${isActive ? " on" : ""}`}>
                  <span className="mono mute">0{i + 1}</span>
                  <span className="display">{n.label}</span>
                </NavLink>
              </motion.div>
            ))}
            <div className="foot mono mute">
              <span>LA · LV · DAL · NYC</span>
              <a href="https://instagram.com/shift4projects" target="_blank" rel="noreferrer">Instagram ↗</a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
