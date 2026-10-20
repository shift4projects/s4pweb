import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { CITIES } from "../data/projects";
import { trackLead } from "../lib/analytics";
import { SERVICE_NAMES as SERVICES } from "../data/services";
import { timeIn, useNow, useTitle } from "../lib/hooks";

type Status = { state: "idle" | "sending" | "sent" | "error"; msg?: string };

export default function Contact() {
  useTitle("Contact");
  const now = useNow();
  const [params] = useSearchParams();
  const [picked, setPicked] = useState<string[]>(() => {
    const s = params.get("service");
    return s && SERVICES.includes(s) ? [s] : [];
  });
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const toggle = (s: string) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setStatus({ state: "sending" });
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, services: picked }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Something went wrong. Please try again.");
      trackLead(picked);
      setStatus({ state: "sent" });
    } catch (err) {
      setStatus({ state: "error", msg: (err as Error).message });
    }
  }

  return (
    <>
      <header className="page-head">
        <p className="mono mute">Get in touch</p>
        <h1 className="display xl" style={{ marginTop: 14 }}>Tell us about<br />your event</h1>
      </header>

      <section className="wrap split" style={{ paddingTop: 30, paddingBottom: 140 }}>
        <div>
          {status.state === "sent" ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <p className="display lg accent">Got it.</p>
              <p className="body-lg" style={{ marginTop: 18 }}>Thanks for reaching out. We’ll be in touch shortly to talk through the details.</p>
            </motion.div>
          ) : (
            <form className="form" onSubmit={submit} noValidate={false}>
              <div className="two-col">
                <label className="field"><span className="mono mute">Name *</span><input name="name" required autoComplete="name" /></label>
                <label className="field"><span className="mono mute">Email *</span><input name="email" type="email" required autoComplete="email" /></label>
              </div>
              <div className="two-col">
                <label className="field"><span className="mono mute">Company</span><input name="company" autoComplete="organization" /></label>
                <label className="field"><span className="mono mute">Phone</span><input name="phone" type="tel" autoComplete="tel" /></label>
              </div>
              <div className="field">
                <span className="mono mute">What do you need?</span>
                <div className="chips">
                  {SERVICES.map((s) => (
                    <button type="button" key={s} aria-pressed={picked.includes(s)} onClick={() => toggle(s)}>{s}</button>
                  ))}
                </div>
              </div>
              <div className="two-col">
                <label className="field"><span className="mono mute">Event date</span><input name="date" type="text" placeholder="Month, day or range" /></label>
                <label className="field">
                  <span className="mono mute">City</span>
                  <select name="city" defaultValue="">
                    <option value="" disabled>Select</option>
                    {CITIES.map((c) => <option key={c.name}>{c.name}</option>)}
                    <option>Somewhere else</option>
                  </select>
                </label>
              </div>
              <label className="field"><span className="mono mute">Event details *</span><textarea name="message" required rows={5} placeholder="Venue, headcount, the vibe, anything we should know" /></label>
              <label className="hp" aria-hidden>Leave this empty<input name="website" tabIndex={-1} autoComplete="off" /></label>
              <div>
                <button className="btn solid" type="submit" disabled={status.state === "sending"}>
                  {status.state === "sending" ? "Sending…" : <>Send inquiry <span className="arrow">→</span></>}
                </button>
                {status.state === "error" && <p className="form-msg err mono">{status.msg}</p>}
              </div>
            </form>
          )}
        </div>

        <aside>
          <p className="mono mute" style={{ marginBottom: 14 }}>Where we work</p>
          {CITIES.map((c) => (
            <div key={c.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid var(--line)", padding: "12px 0" }}>
              <span className="display" style={{ fontSize: "clamp(30px, 4vw, 56px)" }}>{c.name}</span>
              <span className="mono mute">{timeIn(c.tz, now)}</span>
            </div>
          ))}
          <div className="mono" style={{ marginTop: 34, display: "grid", gap: 8 }}>
            <a href="https://instagram.com/shift4projects" target="_blank" rel="noreferrer">Instagram @shift4projects ↗</a>
          </div>
        </aside>
      </section>
    </>
  );
}
