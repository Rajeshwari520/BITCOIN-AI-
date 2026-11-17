import { useEffect, useState } from "react";
import Gauge from "./Gauge";
import "./ShortTermTab.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export default function ShortTermTab() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/signals`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setStatus("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setStatus("error");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") return <div className="state-msg">Reading technical indicators…</div>;
  if (status === "error")
    return <div className="state-msg state-msg--error">Couldn't load signals: {error}</div>;

  const { gauge, as_of, note } = data;

  return (
    <div className="short-wrap">
      <div className="card">
        <h3 className="card__title">Technical Analysis for BTC/USD</h3>
        <Gauge score={gauge.score} verdict={gauge.verdict} voteCounts={gauge.vote_counts} />
        <button className="details-toggle" onClick={() => setShowDetails((v) => !v)}>
          Detailed analysis {showDetails ? "▲" : "▼"}
        </button>
        {showDetails && (
          <ul className="reasons-list">
            {gauge.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </div>

      <p className="short-footnote">
        {note} As of {new Date(as_of).toLocaleString()}.
      </p>
    </div>
  );
}
