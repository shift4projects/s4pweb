import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, thumb, type StoredProject } from "./api";
import { move, useDragSort } from "./sort";

export default function ProjectList({ onAuth }: { onAuth: (e: unknown) => void }) {
  const [items, setItems] = useState<StoredProject[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  const fail = (e: unknown) => { onAuth(e); setMsg({ text: (e as Error).message, err: true }); };
  useEffect(() => { api<StoredProject[]>("/projects").then(setItems).catch(fail); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveOrder(next: StoredProject[]) {
    const prev = items;
    setItems(next);
    try {
      setItems(await api<StoredProject[]>("/reorder", { body: { slugs: next.map((p) => p.slug) } }));
      setMsg({ text: "Order saved. It’s live on the site." });
    } catch (e) { setItems(prev); fail(e); }
  }

  async function toggle(p: StoredProject) {
    try {
      const u = await api<StoredProject>(`/projects/${p.slug}/hidden`, { body: { hidden: !p.hidden } });
      setItems((list) => list?.map((x) => (x.slug === u.slug ? u : x)) ?? null);
      setMsg({ text: u.hidden ? `${u.client} is hidden from the site.` : `${u.client} is live on the site.` });
    } catch (e) { fail(e); }
  }

  const drag = useDragSort(items ?? [], (p) => p.slug, saveOrder);
  const live = items?.filter((p) => !p.hidden).length ?? 0;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="mute">{items ? `${live} live, ${items.length - live} hidden. Top of the list shows first on the site.` : "Loading…"}</p>
        </div>
        <Link className="btn solid" to="/projects/new">Add project</Link>
      </div>
      {msg && <p className={msg.err ? "err" : "ok"} role="status">{msg.text}</p>}
      <ol className="plist">
        {items?.map((p, i) => (
          <li key={p.slug} className={p.hidden ? "is-hidden" : ""} {...drag(p)}>
            <span className="grip" aria-hidden>⋮⋮</span>
            <Link to={`/projects/${p.slug}`} className="prow">
              {p.photos[0] ? <img src={thumb(p.photos[0])} alt="" loading="lazy" /> : <span className="noimg mono">No photo</span>}
              <span className="ptext">
                <strong>{p.client}</strong>
                <span>{p.title}</span>
                <span className="mono mute tags">
                  {p.disciplines.join(" / ")} · {p.photos.length} photo{p.photos.length === 1 ? "" : "s"}
                  {p.featured && <em className="tag">Home</em>}
                  {p.hidden && <em className="tag off">Hidden</em>}
                </span>
              </span>
            </Link>
            <span className="row-actions">
              <button className="icon" aria-label={`Move ${p.client} up`} disabled={i === 0} onClick={() => saveOrder(move(items, i, i - 1))}>↑</button>
              <button className="icon" aria-label={`Move ${p.client} down`} disabled={i === items.length - 1} onClick={() => saveOrder(move(items, i, i + 1))}>↓</button>
              <button className="btn small" onClick={() => toggle(p)}>{p.hidden ? "Show" : "Hide"}</button>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
