import { useEffect, useState } from "react";
import "./LivePriceTab.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

function formatUsd(n) {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

function Sparkline({ points, up }) {
  if (!points || points.length < 2) return null;

  const width = 700;
  const height = 220;
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p.price - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePath = `M${coords.join(" L")}`;
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const stroke = up ? "#16a34a" : "#dc2626";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="price-chart" preserveAspectRatio="none">
      <path d={areaPath} fill={stroke} opacity="0.08" />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

const RANGES = [
  { label: "1D", days: 1 },
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
  { label: "MAX", days: 1825 },
];

export default function LivePriceTab() {
  const [price, setPrice] = useState(null);
  const [history, setHistory] = useState(null);
  const [range, setRange] = useState(1);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [priceRes, historyRes] = await Promise.all([
          fetch(`${API_BASE}/api/price`),
          fetch(`${API_BASE}/api/price-history?days=${range}`),
        ]);
        if (!priceRes.ok) throw new Error(`Price request failed: ${priceRes.status}`);
        if (!historyRes.ok) throw new Error(`History request failed: ${historyRes.status}`);
        const priceJson = await priceRes.json();
        const historyJson = await historyRes.json();
        if (!cancelled) {
          setPrice(priceJson);
          setHistory(historyJson.points);
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
    const interval = setInterval(load, 30 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [range]);

  if (status === "loading") return <div className="price-state">Loading live price…</div>;
  if (status === "error")
    return <div className="price-state price-state--error">Couldn't load price: {error}</div>;

  const isUp = price.change_24h_pct >= 0;

  return (
    <div className="card price-wrap">
      <div className="price-header">
        <div>
          <div className="price-label">Bitcoin</div>
          <div className="price-main">
            ${price.price_usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            <span className={`price-change ${isUp ? "price-change--up" : "price-change--down"}`}>
              {isUp ? "▲" : "▼"} {Math.abs(price.change_24h_pct).toFixed(2)}% (24h)
            </span>
          </div>
        </div>
        <div className="price-updated">
          Live · updated {new Date(price.last_updated).toLocaleTimeString()}
        </div>
      </div>

      <div className="price-stats">
        <div className="price-stat">
          <div className="price-stat__label">Market Cap</div>
          <div className="price-stat__value">{formatUsd(price.market_cap)}</div>
        </div>
        <div className="price-stat">
          <div className="price-stat__label">24h Volume</div>
          <div className="price-stat__value">{formatUsd(price.volume_24h)}</div>
        </div>
        <div className="price-stat">
          <div className="price-stat__label">FDV</div>
          <div className="price-stat__value">{formatUsd(price.fdv)}</div>
        </div>
        <div className="price-stat">
          <div className="price-stat__label">Vol/Market Cap</div>
          <div className="price-stat__value">
            {price.vol_to_mcap_pct != null ? `${price.vol_to_mcap_pct}%` : "—"}
          </div>
        </div>
      </div>

      <div className="price-range-tabs">
        {RANGES.map((r) => (
          <button
            key={r.label}
            className={`price-range-btn ${range === r.days ? "price-range-btn--active" : ""}`}
            onClick={() => setRange(r.days)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <Sparkline points={history} up={isUp} />
    </div>
  );
}
