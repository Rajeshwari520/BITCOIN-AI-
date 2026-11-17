import "./Gauge.css";

// Maps a -1..1 score to an angle across a 180° semicircle (left = Strong Sell, right = Strong Buy).
function scoreToAngle(score) {
  const clamped = Math.max(-1, Math.min(1, score));
  return -90 + ((clamped + 1) / 2) * 180;
}

export default function Gauge({ score, verdict, voteCounts }) {
  const angle = scoreToAngle(score ?? 0);
  const rad = (angle * Math.PI) / 180;
  const cx = 150;
  const cy = 150;
  const r = 110;
  const needleX = cx + r * Math.sin(rad);
  const needleY = cy - r * Math.cos(rad);

  const verdictClass = (verdict || "").toLowerCase().replace(" ", "-");

  return (
    <div className="gauge-wrap">
      <svg viewBox="0 0 300 175" className="gauge-svg">
        <path d="M 20 150 A 130 130 0 0 1 280 150" fill="none" stroke="#f3f4f6" strokeWidth="18" />
        <path
          d="M 20 150 A 130 130 0 0 1 280 150"
          fill="none"
          stroke="url(#gaugeGradient)"
          strokeWidth="18"
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#dc2626" />
            <stop offset="50%" stopColor="#e5e7eb" />
            <stop offset="100%" stopColor="#16a34a" />
          </linearGradient>
        </defs>
        <line
          x1={cx}
          y1={cy}
          x2={needleX}
          y2={needleY}
          stroke="#111827"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="7" fill="#111827" />
        <text x="20" y="170" fontSize="11" fill="#9ca3af">Strong Sell</text>
        <text x="150" y="30" fontSize="11" fill="#9ca3af" textAnchor="middle">Neutral</text>
        <text x="280" y="170" fontSize="11" fill="#9ca3af" textAnchor="end">Strong Buy</text>
      </svg>
      <div className={`gauge-verdict gauge-verdict--${verdictClass}`}>{verdict}</div>

      {voteCounts && (
        <div className="gauge-counts">
          <div className="gauge-count gauge-count--sell">
            <div className="gauge-count__label">Sell</div>
            <div className="gauge-count__value">{voteCounts.sell}</div>
          </div>
          <div className="gauge-count gauge-count--neutral">
            <div className="gauge-count__label">Neutral</div>
            <div className="gauge-count__value">{voteCounts.neutral}</div>
          </div>
          <div className="gauge-count gauge-count--buy">
            <div className="gauge-count__label">Buy</div>
            <div className="gauge-count__value">{voteCounts.buy}</div>
          </div>
        </div>
      )}
    </div>
  );
}
