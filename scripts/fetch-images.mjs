// Squarespace serves WebP for these URLs, so files are saved as .webp.
// Pulls the client's current images off their Squarespace CDN into /public so the
// site never hotlinks. Swap these for the original full-res files when Shift 4 sends them.
import fs from "node:fs/promises";
import path from "node:path";

const B = "https://images.squarespace-cdn.com/content/v1/685e1ada128ba76afb260750/";
const X = (ids) => ids.map((i) => `${i}/image-asset.jpeg`);
const OUT = path.resolve("public");

const projects = {
  moroccanoil: ["1530ca49-4fbf-4bbe-8e07-05dfa152aff7/IMG_2811.jpeg","a2a0360b-83fc-444f-997d-7369ecfa3d58/IMG_2809.jpeg","ab36d1e3-8a0f-4159-a156-20e1371b41a7/IMG_2810.jpeg","0cb6d665-3bbc-493d-9f5b-da028d172fe5/IMG_2813.jpeg","65473763-4722-48c0-830c-92e269909d75/IMG_2862.jpg","51b18cef-3b82-49b2-a110-5a58ef909887/IMG_2812.jpeg"],
  indiewire: ["363b0300-1002-456c-8df6-865d227d323f/image0.jpeg","c1a026c0-576d-4391-9fac-05f553ca9e71/image1.jpeg","9bdff48d-ff60-49a9-819e-fd78e4419b03/image2.jpeg","a1a78026-0472-42e8-95d2-2bcad2e9bc0f/image3.jpeg"],
  "monterey-car-week": ["b8dd9203-c50c-4c02-a3fd-a31b022865e2/image0.jpeg","5c92dfa8-78b0-410e-926c-4b2778e1e6dd/image1.jpeg","377b1ff6-fbee-45b5-81ec-929b6ea2948b/image2.jpeg","cf031c3b-58de-47c4-a74d-14372160a5b5/image3.jpeg","d1d3f1d9-3bb8-45d0-b5e0-5d9300637edf/image4.jpeg"],
  hulu: ["d72b4ffb-2f1b-4167-a32a-bff843aa1d74/09_11_2023_AgenCxHuluxDrive_097.jpg"],
  "mtv-challenge": ["51bf6547-851d-40f5-aaab-1eb5a4b814d6/CHALLENGE40_ClarkStudio_0030.jpg","e4e110a2-26a6-4d09-85bc-4b997d76409d/CHALLENGE40_ClarkStudio_0415.jpg"],
  "amazon-countdown": ["05a888f4-86da-4247-b6b1-7045b799a121/Countdown_Amzn_Clarkstudio_1040.jpg"],
  instyle: ["64bff30f-72e5-4973-85f5-9368db323bc0/InStyle_shift-4-projects-7.jpg"],
  "video-village": ["0847ecc9-aa20-4619-b446-d8e095829ea9/BE8E9885-37C4-44F3-8AC1-15320E462F8C.JPG"],
  "agenc-led": X(["1791857189668-BWOSSKABC9NCH81KGB0S","1791857189668-RDLJAT99YNII6TPRMBTK","1791857189668-PPJCKT010V7F03N30DKE"]),
  "dr-martens": X(["1791924204442-CEP0C5IOJBJ2C9I0VRNW"]),
  "new-era-timberland": X(["1787853287396-XD6ES4P1D1KUGAK1TOE6","1787853287396-QUHEZ7AYQMU1DUVVJ4GH","1787853287396-QVJJDKWK8LIIQQ516G6K"]),
  cerave: X(["1786672255830-MUGIGV7IQWJ2RJM1XGBV","1786672257225-SW7VNA632M2RK1CB2YT8"]),
  macys: X(["1787927274316-P6YC5C1UBTFTQ82UOGXQ"]),
  "custom-dj-booth": X(["1791924204442-WZF3QCW2AQAK3PDH7DQ8"]),
  pixelbricks: X(["1791924204441-H1MN3IA689IBFQPQ40FM"]),
};

const misc = {
  "img/svc-video.webp": "08325327-2818-463b-a046-6b13aaf13341/481013054_10202833540670071_8437899950606761504_n.jpg",
  "img/svc-audio.webp": "1236775c-dd3f-44ce-9783-7245f6abb3c9/Shif-4-projects-audio.JPG",
  "img/svc-lighting.webp": "c576ec68-a6ee-4f2b-ae99-2ae90c0d6088/DSC06966.jpg",
  "img/about.webp": "ba3d13e6-5a19-4263-8f0b-ed7e4402602f/A30A2CB1-AD71-43BF-9B08-A1392DB75DD7.JPG",
  "img/animation.webp": "1787927274323-3GQ4FH5FS99CRA9912I0/image-asset.jpeg",
};

async function get(src, dest, w) {
  try { await fs.access(dest); return; } catch {}
  const res = await fetch(`${B}${src}?format=${w}w`);
  if (!res.ok) throw new Error(`${res.status} ${src}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log("saved", path.relative(OUT, dest));
}

const jobs = [];
for (const [slug, srcs] of Object.entries(projects)) {
  srcs.forEach((src, i) => {
    const n = String(i + 1).padStart(2, "0");
    jobs.push(get(src, path.join(OUT, "work", slug, `${n}.webp`), 2500));
    jobs.push(get(src, path.join(OUT, "work", slug, `${n}-sm.webp`), 1000));
  });
}
for (const [dest, src] of Object.entries(misc)) jobs.push(get(src, path.join(OUT, dest), 2500));
await Promise.all(jobs);
