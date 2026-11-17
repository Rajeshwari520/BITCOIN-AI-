import { useEffect, useState } from "react";
import Gauge from "./Gauge";
import "./ShortTermTab.css";
import "./SignalsTab.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const ROWS = [
  { key: "rsi", label: "RSI (14)" },
  { key: "macd", label: "MACD" },
  { key: "macd_signal", label: "MACD Signal" },
  { key: "adx", label: "ADX (14)" },
  { key: "cci", label: "CCI (20)" },
  { key: "ma20", label: "MA 20" },
  { key: "ma50", label: "MA 50" },
];

export default function SignalsTab() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/signals?days=180`);
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

  const { gauge, indicators } = data;

  return (
    <div className="short-wrap">
      <div className="card">
        <h3 className="card__title">Technical Analysis for BTC/USD (180D)</h3>
        <Gauge score={gauge.score} verdict={gauge.verdict} voteCounts={gauge.vote_counts} />
      </div>

      <div className="card">
        <h3 className="card__title">Indicator Values</h3>
        <table className="indicator-table">
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key}>
                <td className="indicator-table__label">{row.label}</td>
                <td className="indicator-table__value">
                  {indicators[row.key] != null ? indicators[row.key] : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
