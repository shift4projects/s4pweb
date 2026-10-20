import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Header from "./components/Header";
import Footer from "./components/Footer";
import ReelModal from "./components/ReelModal";
import { SmoothScroll, useLenis } from "./lib/scroll";
import { trackPageView } from "./lib/analytics";
import Home from "./pages/Home";
import Projects from "./pages/Projects";
import Services from "./pages/Services";
import ProjectPage from "./pages/Project";
import Animation from "./pages/Animation";
import Wifi from "./pages/Wifi";
import Contact from "./pages/Contact";
import NotFound from "./pages/NotFound";

function ScrollReset() {
  const { pathname } = useLocation();
  const lenis = useLenis();
  useEffect(() => {
    lenis.current?.scrollTo(0, { immediate: true });
    window.scrollTo(0, 0);
  }, [pathname, lenis]);
  return null;
}

/** Meta Pixel PageView on client-side navigation (the first view is tracked by the base tag). */
function RouteTracking() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    trackPageView();
  }, [pathname]);
  return null;
}

export default function App() {
  const location = useLocation();
  const [reel, setReel] = useState(false);

  return (
    <SmoothScroll>
      <a className="skip" href="#main">Skip to content</a>
      <ScrollReset />
      <RouteTracking />
      <Header />
      {/* initial={false}: no fade on the very first load, so the hero video is on screen immediately. Page changes still fade. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          id="main"
          key={location.pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
        >
          <Routes location={location}>
            <Route path="/" element={<Home onReel={() => setReel(true)} />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:slug" element={<ProjectPage />} />
            <Route path="/services" element={<Services />} />
            <Route path="/animation-motion-design" element={<Animation />} />
            <Route path="/wifi-solutions" element={<Wifi />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <Footer />
        </motion.main>
      </AnimatePresence>
      <AnimatePresence>{reel && <ReelModal onClose={() => setReel(false)} />}</AnimatePresence>
    </SmoothScroll>
  );
}
