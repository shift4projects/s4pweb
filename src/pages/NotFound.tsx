import { Link } from "react-router-dom";
import { useTitle } from "../lib/hooks";

export default function NotFound() {
  useTitle("Not found");
  return (
    <section className="page-head" style={{ minHeight: "70svh" }}>
      <p className="mono mute">404 · Signal lost</p>
      <h1 className="display xl" style={{ marginTop: 16 }}>Nothing on<br />this channel</h1>
      <Link to="/" className="btn" style={{ marginTop: 34 }}>Back home <span className="arrow">→</span></Link>
    </section>
  );
}
