import { useEffect, useState } from "react";
import "./LongTermTab.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const LABELS = { "3m": "3 Months", "6m": "6 Months", "1y": "1 Year", "5y": "5 Years" };

function TrendChart({ historical, forecast }) {
  const width = 700;
  const height = 260;

  const allPrices = [...historical.map((p) => p.price), ...forecast.map((p) => p.price)];
  const min = Math.min(...allPrices);
  const max = Math.max(...allPrices);
  const range = max - min || 1;
  const totalPoints = historical.length + forecast.length;

  const toXY = (i, price) => {
    const x = (i / (totalPoints - 1)) * width;
    const y = height - ((price - min) / range) * height;
    return [x, y];
  };

  const histCoords = historical.map((p, i) => toXY(i, p.price));
  const fcCoords = forecast.map((p, i) => toXY(historical.length + i, p.price));

  // connect the forecast line starting from the last historical point
  const fcPath = [histCoords[histCoords.length - 1], ...fcCoords]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" L");

  const histPath = histCoords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  const areaPath = `M${histPath} L${histCoords[histCoords.length - 1][0]},${height} L0,${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="trend-chart" preserveAspectRatio="none">
      <path d={areaPath} fill="#16a34a" opacity="0.06" />
      <path d={`M${histPath}`} fill="none" stroke="#2563eb" strokeWidth="2.5" />
      <path d={`M${fcPath}`} fill="none" stroke="#9333ea" strokeWidth="2.5" strokeDasharray="6 5" />
    </svg>
  );
}

export default function LongTermTab() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/forecast/long-term`);
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

  if (status === "loading") return <div className="state-msg">Projecting long-term trend…</div>;
  if (status === "error")
    return <div className="state-msg state-msg--error">Couldn't load forecast: {error}</div>;

  // Thin the daily historical path down so the chart isn't overcrowded.
  const histFull = data.historical_path || [];
  const step = Math.max(1, Math.floor(histFull.length / 90));
  const historical = histFull.filter((_, i) => i % step === 0);
  const forecast = (data.forecast_path || []).filter((_, i) => i % 3 === 0); // every ~3 months

  return (
    <div className="long-wrap">
      <div className="card">
        <div className="long-header">
          <h3 className="card__title">BTC/USD</h3>
          <div className="long-legend">
            <span><span className="dot dot--hist" /> Historical</span>
            <span><span className="dot dot--fc" /> Forecasted</span>
          </div>
        </div>
        <TrendChart historical={historical} forecast={forecast} />
      </div>

      <div className="card">
        <h3 className="card__title">Projected Price Targets</h3>
        <div className="long-grid">
          {Object.entries(LABELS).map(([key, label]) => {
            const f = data.forecast[key];
            return (
              <div className="long-card" key={key}>
                <div className="long-card__label">{label}</div>
                <div className="long-card__price">${f.price.toLocaleString()}</div>
                <div className={`long-card__pct ${f.pct_change >= 0 ? "up" : "down"}`}>
                  {f.pct_change >= 0 ? "+" : ""}
                  {f.pct_change}%
                </div>
              </div>
            );
          })}
        </div>
        <p className="long-note">
          Method: {data.method}. {data.confidence_note}
        </p>
      </div>
    </div>
  );
}
