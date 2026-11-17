import { useEffect, useState } from "react";
import "./AIPredictionTab.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

function biasFromCall(call) {
  if (call === "BUY") return "Bullish";
  if (call === "SELL") return "Bearish";
  return "Neutral";
}

// Heuristic split derived transparently from the technical gauge score (-1..1).
// Not a model output — labeled as such in the UI.
function scenarioProbabilities(score) {
  const bullish = Math.max(0, Math.round(33 + score * 40));
  const bearish = Math.max(0, Math.round(33 - score * 40));
  const neutral = Math.max(0, 100 - bullish - bearish);
  return { bullish, bearish, neutral };
}

export default function AIPredictionTab() {
  const [prediction, setPrediction] = useState(null);
  const [verdictData, setVerdictData] = useState(null);
  const [backtest, setBacktest] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [pRes, vRes, bRes] = await Promise.all([
          fetch(`${API_BASE}/api/prediction`),
          fetch(`${API_BASE}/api/verdict`),
          fetch(`${API_BASE}/api/backtest`),
        ]);
        if (!pRes.ok) throw new Error(`Prediction request failed: ${pRes.status}`);
        if (!vRes.ok) throw new Error(`Verdict request failed: ${vRes.status}`);
        if (!bRes.ok) throw new Error(`Backtest request failed: ${bRes.status}`);
        const p = await pRes.json();
        const v = await vRes.json();
        const b = await bRes.json();
        if (!cancelled) {
          setPrediction(p);
          setVerdictData(v);
          setBacktest(b);
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

  if (status === "loading") return <div className="state-msg">Running AI prediction…</div>;
  if (status === "error")
    return <div className="state-msg state-msg--error">Couldn't load prediction: {error}</div>;

  const { short_term, shap } = prediction;
  const { verdict, gauge } = verdictData;

  const bias = biasFromCall(verdict.call);
  const signalScore = Math.round(((gauge.score + 1) / 2) * 100); // -1..1 -> 0..100
  const forecast7d = short_term.forecast["7d"];
  const forecast30d = short_term.forecast["30d"];
  const currentPrice = short_term.current_price;
  const std = backtest.residual_std || currentPrice * 0.01;

  const entryLow = currentPrice - std;
  const entryHigh = currentPrice + std;
  const stopLoss =
    bias === "Bearish" ? currentPrice + std * 2 : currentPrice - std * 2;

  const probs = scenarioProbabilities(gauge.score);
  const maxAbs = Math.max(...shap.contributions.map((c) => Math.abs(c.shap_value)));

  return (
    <div className="pred-wrap">
      <div className="pred-bias-row">
        <span className="pred-bias-label">Overall Bias:</span>
        <span className={`pill pill--${bias.toLowerCase()}`}>{bias}</span>
      </div>

      <div className="pred-grid">
        <div className="card pred-card">
          <div className="pred-card__title">AI Signal</div>
          <div className={`pred-signal pred-signal--${bias.toLowerCase()}`}>
            {bias.toUpperCase()} <span className="pred-signal__score">{signalScore}/100</span>
          </div>
          <div className="pred-signal-track">
            <div className="pred-signal-fill" style={{ width: `${signalScore}%` }} />
          </div>
          <ul className="pred-mini-list">
            <li>{gauge.verdict} technical reading</li>
            <li>
              {forecast7d
                ? `7-day model forecast ${forecast7d.pct_change >= 0 ? "+" : ""}${forecast7d.pct_change}%`
                : "7-day forecast unavailable"}
            </li>
          </ul>
        </div>

        <div className="card pred-card">
          <div className="pred-card__title">Trade Plan · 1M Horizon</div>
          <div className="pred-plan-row">
            <span>Entry Zone</span>
            <strong>
              ${entryLow.toLocaleString(undefined, { maximumFractionDigits: 0 })}–$
              {entryHigh.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </strong>
          </div>
          <div className="pred-plan-row">
            <span>Stop-Loss</span>
            <strong>${stopLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
          </div>
          <div className="pred-plan-row">
            <span>1W Target</span>
            <strong>{forecast7d ? `$${forecast7d.price.toLocaleString()}` : "—"}</strong>
          </div>
          <div className="pred-plan-row">
            <span>1M Target</span>
            <strong>{forecast30d ? `$${forecast30d.price.toLocaleString()}` : "—"}</strong>
          </div>
        </div>

        <div className="card pred-card">
          <div className="pred-card__title">Scenario Probabilities</div>
          <div className="scenario-row">
            <span className="scenario-label up">Bullish ↑</span>
            <div className="scenario-track"><div className="scenario-fill up" style={{ width: `${probs.bullish}%` }} /></div>
            <span className="scenario-pct">{probs.bullish}%</span>
          </div>
          <div className="scenario-row">
            <span className="scenario-label down">Bearish ↓</span>
            <div className="scenario-track"><div className="scenario-fill down" style={{ width: `${probs.bearish}%` }} /></div>
            <span className="scenario-pct">{probs.bearish}%</span>
          </div>
          <div className="scenario-row">
            <span className="scenario-label neutral">Neutral</span>
            <div className="scenario-track"><div className="scenario-fill neutral" style={{ width: `${probs.neutral}%` }} /></div>
            <span className="scenario-pct">{probs.neutral}%</span>
          </div>
          <p className="scenario-note">Derived from the live technical gauge score.</p>
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">Market Regime Score Components</h3>
        <ul className="regime-list">
          {gauge.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      <div className="card shap-card">
        <h3 className="card__title">Why The Model Predicts This</h3>
        <p className="shap-summary">{shap.summary}</p>
        <div className="shap-bars">
          {shap.contributions.map((c) => (
            <div className="shap-row" key={c.feature}>
              <div className="shap-row__label">{c.feature.toUpperCase()}</div>
              <div className="shap-row__track">
                <div
                  className={`shap-row__bar ${c.shap_value >= 0 ? "up" : "down"}`}
                  style={{ width: `${(Math.abs(c.shap_value) / maxAbs) * 100}%` }}
                />
              </div>
              <div className="shap-row__value">
                {c.shap_value >= 0 ? "+" : ""}
                {c.shap_value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="pred-disclaimer">{verdict.disclaimer}</p>
    </div>
  );
}
