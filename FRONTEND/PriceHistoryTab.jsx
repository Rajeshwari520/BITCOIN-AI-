import { useEffect, useState } from "react";
import "./PriceHistoryTab.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const RANGES = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "1Y", days: 365 },
];

export default function PriceHistoryTab() {
  const [points, setPoints] = useState(null);
  const [range, setRange] = useState(30);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus("loading");
      try {
        const res = await fetch(`${API_BASE}/api/price-history?days=${range}`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setPoints(json.points);
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
  }, [range]);

  if (status === "loading") return <div className="state-msg">Loading price history…</div>;
  if (status === "error")
    return <div className="state-msg state-msg--error">Couldn't load history: {error}</div>;

  // One row per day, newest first.
  const daily = [];
  const seenDates = new Set();
  for (let i = points.length - 1; i >= 0; i--) {
    const d = new Date(points[i].t).toISOString().slice(0, 10);
    if (!seenDates.has(d)) {
      seenDates.add(d);
      daily.push({ date: d, price: points[i].price });
    }
  }

  const prices = daily.map((d) => d.price);
  const high = Math.max(...prices);
  const low = Math.min(...prices);

  return (
    <div className="hist-wrap">
      <div className="card">
        <div className="hist-header">
          <h3 className="card__title">BTC/USD Price History</h3>
          <div className="hist-range-tabs">
            {RANGES.map((r) => (
              <button
                key={r.label}
                className={`hist-range-btn ${range === r.days ? "hist-range-btn--active" : ""}`}
                onClick={() => setRange(r.days)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="hist-summary">
          <div>
            <span>Period High</span>
            <strong>${high.toLocaleString()}</strong>
          </div>
          <div>
            <span>Period Low</span>
            <strong>${low.toLocaleString()}</strong>
          </div>
        </div>

        <div className="hist-table-scroll">
          <table className="hist-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Price</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((row, i) => {
                const prev = daily[i + 1];
                const change = prev ? ((row.price - prev.price) / prev.price) * 100 : null;
                return (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>${row.price.toLocaleString()}</td>
                    <td className={change == null ? "" : change >= 0 ? "up" : "down"}>
                      {change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
