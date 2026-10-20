// Service hero images: /img/services/<slug>.webp, from Will's Drive "service heroes" folder.
// The one list of services. Home cards, the Services page, the footer and the contact
// form all read from here so they always agree. Copy is Shift 4's own, except where
// `pending` is set (written from their project facts, waiting on Will to confirm).
import type { Discipline } from "./projects";

export type Service = {
  slug: string;
  /** Short name used in chips, filters and the footer. */
  name: string;
  /** Display title on cards. */
  title: string;
  copy: string;
  list: string[];
  /** `focus` is the CSS object-position that keeps the subject in frame on narrow (phone) crops. */
  media: { type: "img"; src: string; focus?: string } | { type: "video"; src: string; mobileSrc: string; poster: string; mobilePoster: string };
  /** Deeper page for this service, if it has one. */
  page?: string;
  /** Project filter that shows this service's work. */
  discipline?: Discipline;
  /** Will (10/18): Video, Audio, Lighting, Animation, Event Capture are the main services; WiFi is listed under "Additional Services". Staging was dropped as a service (still a project filter). */
  group: "main" | "addon";
  pending?: boolean;
};

export const SERVICES: Service[] = [
  {
    slug: "video",
    group: "main",
    name: "Video",
    title: "Video",
    copy: "We bring creative visions to life through LED walls, projection, and playback systems. Our video services include high-resolution LED design, live content playback, and seamless integration with motion graphics and camera feeds. From pre-production to load-out, we ensure every pixel performs.",
    list: ["LED Walls", "Projection Mapping", "Playback Systems", "Video Walls", "Content Management", "Live Streaming"],
    media: { type: "img", src: "/img/svc-video.webp" },
    discipline: "Video",
  },
  {
    slug: "audio",
    group: "main",
    name: "Audio",
    title: "Audio",
    copy: "Clean, powerful, and balanced, that’s our sound. Shift4Projects engineers scalable audio systems for any environment, from intimate panels to large-scale performances. We handle sound reinforcement, RF coordination, and live mixing to deliver clarity and impact that connect audiences to the experience.",
    list: ["Front of House", "Stage Monitoring", "DJ Tech Rider", "Livestream & Broadcast", "Comms & Intercom Integration"],
    media: { type: "img", src: "/img/services/audio.webp", focus: "30% 50%" },
    discipline: "Audio",
  },
  {
    slug: "lighting",
    group: "main",
    name: "Lighting",
    title: "Lighting",
    copy: "From ambient washes to precision key lighting, our lighting design elevates every moment on stage and on camera. We create tailored systems that balance creativity and control for live events, film sets, and branded experiences, delivering intentional, cinematic looks every time.",
    list: ["Stage & Show Lighting Package", "Ambient Lighting", "Outdoor & Event Lighting", "Lighting Control & Programming", "LED & Pixel-Mapped Systems"],
    media: { type: "img", src: "/img/services/lighting.webp", focus: "60% 50%" },
    discipline: "Lighting",
  },
  {
    slug: "animation-motion",
    group: "main",
    name: "Animation & Motion",
    title: "Animation & Motion",
    copy: "Bring your ideas to life with custom motion graphics and animation designed for live events, branded experiences, LED walls, social content, and digital displays. From concept development to final delivery, we create visually engaging content that transforms spaces and tells your story with impact.",
    list: ["2D & 3D Animation", "LED Wall Content", "Event Visuals", "Brand Storytelling", "Digital Content"],
    media: { type: "video", src: "/video/anim-loop.mp4", mobileSrc: "/video/anim-loop-mobile.mp4", poster: "/video/anim-poster.jpg", mobilePoster: "/video/anim-poster-mobile.jpg" },
    page: "/animation-motion-design",
  },
  {
    slug: "event-capture",
    group: "main",
    name: "Event Capture",
    title: "Event Capture",
    // Pending: Will asked for this service on 10/18; copy and hero image are stand-ins until he sends his own.
    // The current photo is Clark Studio's InStyle press line, not Shift 4's own capture work.
    copy: "Photo and video coverage of your event, from arrivals to the last song, so you walk away with content ready for socials, recaps and your next pitch.",
    list: ["Event Photography", "Event Videography", "Highlight & Recap Reels", "Social-Ready Content"],
    media: { type: "img", src: "/img/services/event-capture.webp" },
    pending: true,
  },
  {
    slug: "wifi",
    group: "addon",
    name: "WiFi",
    title: "WiFi Solutions",
    copy: "We’ve deployed reliable WiFi in the desert, on private estates, at rooftop activations and in underground venues. Shift4 Projects brings enterprise-level connectivity to locations standard providers can’t reach, because the best events don’t wait for perfect conditions.",
    list: ["Site Survey & Network Planning", "Enterprise-Grade Hardware", "Dedicated Bandwidth", "Scalable Coverage", "On-Site Tech Support"],
    media: { type: "img", src: "/work/video-village/01.webp" },
    page: "/wifi-solutions",
  },
];

export const SERVICE_NAMES = SERVICES.map((s) => s.name);
export const MAIN_SERVICES = SERVICES.filter((s) => s.group === "main");
export const ADDON_SERVICES = SERVICES.filter((s) => s.group === "addon");
/** Pages that belong under "Services" in the nav. */
export const SERVICE_PATHS = ["/services", ...SERVICES.flatMap((s) => (s.page ? [s.page] : []))];
