// Meta Pixel + Google tag, injected into the public pages only when their IDs are set.
// The contact form fires the conversion (see src/lib/analytics.ts). /admin never gets these tags.
//   GA_MEASUREMENT_ID       G-XXXXXXX (comma-separate to also load e.g. a Google Ads AW- tag)
//   GOOGLE_ADS_CONVERSION   optional AW-123456789/AbCdEf label for a Google Ads "Lead" conversion
//   META_PIXEL_ID           numeric pixel ID

const list = (v?: string) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);

export function trackingTags(): string {
  const google = list(process.env.GA_MEASUREMENT_ID).filter((id) => {
    const ok = /^(G|AW|GT|DC)-[A-Z0-9]+$/i.test(id);
    if (!ok) console.warn(`[tracking] ignoring malformed GA_MEASUREMENT_ID "${id}"`);
    return ok;
  });
  const adsLead = (process.env.GOOGLE_ADS_CONVERSION || "").trim();
  const ads = /^AW-\d+\/[\w-]+$/.test(adsLead) ? adsLead : undefined;
  if (adsLead && !ads) console.warn(`[tracking] ignoring malformed GOOGLE_ADS_CONVERSION "${adsLead}"`);
  const pixel = (process.env.META_PIXEL_ID || "").trim();
  const meta = /^\d{5,20}$/.test(pixel) ? pixel : undefined;
  if (pixel && !meta) console.warn(`[tracking] ignoring malformed META_PIXEL_ID "${pixel}"`);

  if (!google.length && !meta) {
    console.log("[tracking] no GA_MEASUREMENT_ID / META_PIXEL_ID; tags skipped");
    return "";
  }
  console.log(`[tracking] google: ${google.join(", ") || "off"}, meta pixel: ${meta ? "on" : "off"}`);

  let out = `<script>window.__TRACK__=${JSON.stringify({ google, ads, meta: !!meta })}</script>`;
  if (google.length) {
    out += `<script async src="https://www.googletagmanager.com/gtag/js?id=${google[0]}"></script>` +
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());` +
      google.map((id) => `gtag('config','${id}');`).join("") + `</script>`;
  }
  if (meta) {
    out += `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};` +
      `if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;` +
      `s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
      `fbq('init','${meta}');fbq('track','PageView');</script>`;
  }
  return out;
}
