import { useEffect, useRef, useState, type ReactNode } from "react";

/** Turns "[AGENC](https://www.agen-c.com/)" inside a line of text into a real link. */
export function Linked({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (let m; (m = re.exec(text)); last = re.lastIndex) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<a key={m.index} href={m[2]} target="_blank" rel="noreferrer" className="inline-link">{m[1]}</a>);
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

type Parsed = { kind: "youtube" | "vimeo"; embed: string; poster?: string };

/**
 * YouTube or Vimeo link → embed details, or null if it isn't one we know.
 * Browsers only allow autoplay when muted, so it starts muted and loops; viewers unmute with the player controls.
 */
export function parseVideo(url: string): Parsed | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return {
    kind: "youtube",
    embed: `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&mute=1&loop=1&playlist=${yt[1]}&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`,
    poster: `https://i.ytimg.com/vi/${yt[1]}/maxresdefault.jpg`,
  };
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { kind: "vimeo", embed: `https://player.vimeo.com/video/${vm[1]}?autoplay=1&muted=1&loop=1&playsinline=1&dnt=1` };
  return null;
}

/** 16:9 video that starts playing (muted) when it scrolls into view and pauses when it leaves. */
export default function ProjectVideo({ url, title }: { url: string; title: string }) {
  const v = parseVideo(url);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || !v) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setMounted(true);
      // Pause off screen, resume on return (player API messages; harmless before it loads).
      const w = frame.current?.contentWindow;
      if (!w) return;
      if (v.kind === "youtube") w.postMessage(JSON.stringify({ event: "command", func: e.isIntersecting ? "playVideo" : "pauseVideo", args: [] }), "*");
      else w.postMessage({ method: e.isIntersecting ? "play" : "pause" }, "*");
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [v?.embed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!v) return null;
  return (
    <div className="proj-video" ref={box}>
      {v.poster && <img src={v.poster} alt="" loading="lazy" decoding="async" />}
      {mounted && <iframe ref={frame} src={v.embed} title={title} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen />}
    </div>
  );
}
