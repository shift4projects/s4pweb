import { useState, type ReactNode } from "react";

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

/** YouTube or Vimeo link → embed details, or null if it isn't one we know. */
export function parseVideo(url: string): { embed: string; poster?: string } | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return {
    embed: `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0&modestbranding=1&playsinline=1`,
    poster: `https://i.ytimg.com/vi/${yt[1]}/maxresdefault.jpg`,
  };
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { embed: `https://player.vimeo.com/video/${vm[1]}?dnt=1` };
  return null;
}

/** 16:9 video block. Shows a still with a play button and only loads the player when tapped. */
export default function ProjectVideo({ url, title }: { url: string; title: string }) {
  const v = parseVideo(url);
  const [playing, setPlaying] = useState(!v?.poster);
  if (!v) return null;
  return (
    <div className="proj-video">
      {playing ? (
        <iframe src={v.embed} title={title} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen />
      ) : (
        <button onClick={() => setPlaying(true)} aria-label={`Play video: ${title}`}>
          <img src={v.poster} alt="" loading="lazy" decoding="async" />
          <span className="play mono"><span className="dot" aria-hidden>▶</span> Play video</span>
        </button>
      )}
    </div>
  );
}
