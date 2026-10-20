import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { DISCIPLINES, type Discipline } from "../data/projects";
import { api, thumb, when, type Fields, type StoredProject, type Version } from "./api";
import { move, useDragSort } from "./sort";

type Form = { client: string; title: string; disciplines: Discipline[]; summary: string; scope: string; location: string; credits: string; featured: boolean };
const EMPTY: Form = { client: "", title: "", disciplines: [], summary: "", scope: "", location: "", credits: "", featured: false };

const toForm = (p: StoredProject): Form => ({
  client: p.client, title: p.title, disciplines: p.disciplines, summary: p.summary, scope: p.scope.join("\n"),
  location: p.location ?? "", credits: p.credits ?? "", featured: !!p.featured,
});
const toFields = (f: Form): Fields => ({
  client: f.client, title: f.title, disciplines: f.disciplines, summary: f.summary,
  scope: f.scope.split("\n").map((s) => s.trim()).filter(Boolean), location: f.location, credits: f.credits, featured: f.featured,
});

type Msg = { text: string; err?: boolean } | null;

const ACTIONS: Record<string, string> = {
  seed: "Original site content", create: "Created", update: "Edited (Claude)", "admin edit": "Edited (admin)",
  "add photo": "Photo added", "set photos": "Photos reordered or removed", hide: "Hidden", show: "Shown",
};
const label = (a: string) => ACTIONS[a] ?? a.replace(/^restore #(\d+)$/, "Restored an earlier version");

export default function Editor({ onAuth }: { onAuth: (e: unknown) => void }) {
  const { slug } = useParams();
  const nav = useNavigate();
  const isNew = !slug;
  const [project, setProject] = useState<StoredProject | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [publish, setPublish] = useState(false);
  const created = !!(useLocation().state as { created?: boolean } | null)?.created;
  const [msg, setMsg] = useState<Msg>(created ? { text: "Project created. Add photos below." } : null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<string>("");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fail = (e: unknown) => { onAuth(e); setMsg({ text: (e as Error).message, err: true }); };
  const load = (p: StoredProject) => { setProject(p); setForm(toForm(p)); };

  useEffect(() => {
    if (isNew) return;
    api<StoredProject>(`/projects/${slug}`).then(load).catch(fail);
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = isNew ? form.client !== "" || form.title !== "" : !!project && JSON.stringify(toForm(project)) !== JSON.stringify(form);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleD = (d: Discipline) => set("disciplines", form.disciplines.includes(d) ? form.disciplines.filter((x) => x !== d) : [...form.disciplines, d]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (isNew) {
        const p = await api<StoredProject>("/projects", { body: { ...toFields(form), hidden: !publish } });
        nav(`/projects/${p.slug}`, { replace: true, state: { created: true } });
      } else {
        load(await api<StoredProject>(`/projects/${slug}`, { method: "PUT", body: toFields(form) }));
        setMsg({ text: project?.hidden ? "Saved. (This project is hidden, so it isn’t on the site yet.)" : "Saved. It’s live on the site." });
        setVersions(null);
      }
    } catch (x) { fail(x); } finally { setBusy(false); }
  }

  async function setPhotos(photos: string[], note: string) {
    if (!project) return;
    const prev = project;
    setProject({ ...project, photos });
    try {
      setProject(await api<StoredProject>(`/projects/${project.slug}/photos`, { method: "PUT", body: { photos } }));
      setMsg({ text: note }); setVersions(null);
    } catch (x) { setProject(prev); fail(x); }
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!project) return;
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(f.name));
    if (!list.length) return setMsg({ text: "Those don’t look like images.", err: true });
    setMsg(null);
    let latest = project, done = 0;
    for (const f of list) {
      setUpload(`Uploading ${done + 1} of ${list.length}…`);
      if (f.size > 30 * 1024 * 1024) { setMsg({ text: `${f.name} is over 30MB, skipped.`, err: true }); continue; }
      try {
        latest = await api<StoredProject>(`/projects/${project.slug}/photos`, { raw: f });
        setProject(latest);
        done++;
      } catch (x) { fail(x); setMsg({ text: `${f.name}: ${(x as Error).message}`, err: true }); }
    }
    setUpload("");
    if (done) { setMsg({ text: `${done} photo${done === 1 ? "" : "s"} added and optimized.` }); setVersions(null); }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function toggleHidden() {
    if (!project) return;
    try {
      const u = await api<StoredProject>(`/projects/${project.slug}/hidden`, { body: { hidden: !project.hidden } });
      setProject(u);
      setMsg({ text: u.hidden ? "Hidden from the site." : "Live on the site." });
      setVersions(null);
    } catch (x) { fail(x); }
  }

  async function restore(v: Version) {
    if (!project || !confirm(`Restore the version from ${when(v.at)}? Your current version stays in the history.`)) return;
    try {
      load(await api<StoredProject>(`/history/${v.id}/restore`, { body: { slug: project.slug } }));
      setMsg({ text: "Restored." });
      setVersions(null);
    } catch (x) { fail(x); }
  }

  const showHistory = () => api<Version[]>(`/projects/${project!.slug}/history`).then(setVersions).catch(fail);
  const photos = project?.photos ?? [];
  const drag = useDragSort(photos, (u) => u, (next) => setPhotos(next, "Photo order saved."));

  if (!isNew && !project) return <section className="page"><p className="mute">{msg?.text || "Loading…"}</p></section>;

  return (
    <section className="page editor">
      <p className="mono"><Link to="/" className="mute">← All projects</Link></p>
      <div className="page-head">
        <div>
          <h1>{isNew ? "New project" : project!.client}</h1>
          {!isNew && <p className="mute">{project!.title}</p>}
        </div>
        {!isNew && (
          <div className="head-actions">
            {!project!.hidden && <a className="btn" href={`/projects/${project!.slug}`} target="_blank" rel="noreferrer">View ↗</a>}
            <button className={`btn ${project!.hidden ? "solid" : ""}`} onClick={toggleHidden}>{project!.hidden ? "Show on site" : "Hide from site"}</button>
          </div>
        )}
      </div>
      {!isNew && project!.hidden && <p className="note">Hidden. Visitors can’t see this project until you show it.</p>}
      {msg && <p className={msg.err ? "err" : "ok"} role="status">{msg.text}</p>}

      <form className="fields" onSubmit={save}>
        <div className="two">
          <label><span className="lbl">Client *</span><input value={form.client} onChange={(e) => set("client", e.target.value)} required maxLength={120} placeholder="e.g. Hulu" /></label>
          <label><span className="lbl">Title *</span><input value={form.title} onChange={(e) => set("title", e.target.value)} required maxLength={160} placeholder="e.g. Screening and After-Party" /></label>
        </div>
        <div>
          <span className="lbl">Disciplines *</span>
          <div className="chips">
            {DISCIPLINES.map((d) => <button type="button" key={d} aria-pressed={form.disciplines.includes(d)} onClick={() => toggleD(d)}>{d}</button>)}
          </div>
        </div>
        <label><span className="lbl">Summary *</span><textarea value={form.summary} onChange={(e) => set("summary", e.target.value)} required rows={4} maxLength={1200} /></label>
        <label><span className="lbl">Scope <em>one per line</em></span><textarea value={form.scope} onChange={(e) => set("scope", e.target.value)} rows={4} placeholder={"LED wall\nRed carpet lighting"} /></label>
        <div className="two">
          <label><span className="lbl">Location</span><input value={form.location} onChange={(e) => set("location", e.target.value)} maxLength={160} placeholder="Venue, city" /></label>
          <label><span className="lbl">Credits</span><input value={form.credits} onChange={(e) => set("credits", e.target.value)} maxLength={240} placeholder="Production: …" /></label>
        </div>
        <label className="check"><input type="checkbox" checked={form.featured} onChange={(e) => set("featured", e.target.checked)} /> Show in Selected work on the home page</label>
        {isNew && <label className="check"><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Put it on the site right away (otherwise it stays hidden until you show it)</label>}
        <div className="save-row">
          <button className="btn solid" disabled={busy || !dirty}>{busy ? "Saving…" : isNew ? "Create project" : "Save changes"}</button>
          {!isNew && dirty && <button type="button" className="btn" onClick={() => setForm(toForm(project!))}>Discard</button>}
        </div>
      </form>

      {!isNew && (
        <>
          <div className="section-head">
            <h2>Photos <span className="mute">{photos.length}</span></h2>
            <button className="btn solid" disabled={!!upload} onClick={() => fileRef.current?.click()}>{upload || "Upload photos"}</button>
            <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
          </div>
          <p className="mute small">The first photo is the cover. Drag to reorder (or use the arrows). Uploads are resized and optimized automatically, up to 30MB each.</p>
          <div
            className="drop"
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.currentTarget.classList.add("over"); } }}
            onDragLeave={(e) => e.currentTarget.classList.remove("over")}
            onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); e.currentTarget.classList.remove("over"); uploadFiles(e.dataTransfer.files); } }}
          >
            {photos.length === 0 && <p className="mute">No photos yet. Upload or drop images here.</p>}
            <ol className="photos">
              {photos.map((u, i) => (
                <li key={u} {...drag(u)}>
                  <img src={thumb(u)} alt={`Photo ${i + 1}`} loading="lazy" draggable={false} />
                  {i === 0 && <em className="tag cover">Cover</em>}
                  <div className="ph-actions">
                    <button className="icon" aria-label="Move left" disabled={i === 0} onClick={() => setPhotos(move(photos, i, i - 1), "Photo order saved.")}>←</button>
                    <button className="icon" aria-label="Move right" disabled={i === photos.length - 1} onClick={() => setPhotos(move(photos, i, i + 1), "Photo order saved.")}>→</button>
                    {i > 0 && <button className="icon" aria-label="Make cover" title="Make cover" onClick={() => setPhotos(move(photos, i, 0), "New cover set.")}>★</button>}
                    <button className="icon danger" aria-label="Remove photo" onClick={() => confirm("Remove this photo from the project? You can bring it back from Version history.") && setPhotos(photos.filter((x) => x !== u), "Photo removed.")}>×</button>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="section-head">
            <h2>Version history</h2>
            {!versions && <button className="btn small" onClick={showHistory}>Show</button>}
          </div>
          {versions && (
            <ol className="versions">
              {versions.map((v, i) => (
                <li key={v.id}>
                  <span className="mono">{when(v.at)}</span>
                  <span>{label(v.action)}</span>
                  <span className="mute">{v.photos} photo{v.photos === 1 ? "" : "s"}{v.hidden ? ", hidden" : ""}</span>
                  {i === 0 ? <span className="mono mute">current</span> : <button className="btn small" onClick={() => restore(v)}>Restore</button>}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
