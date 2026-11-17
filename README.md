[README.md](https://github.com/user-attachments/files/34964906/README.md)
# BITCOIN-PREDICTION


All 14 features from your spec. No dataset file needed anywhere — every
number is either live from an API or trained fresh from live historical
data on each request.

## Feature → source map

| # | Feature | Endpoint | Source |
|---|---|---|---|
| 1 | Live BTC Price | `/api/price`, `/api/price-history` | CoinGecko (live) |
| 2 | Short-Term Forecast (24H/48H/7D/30D) | `/api/forecast/short-term` | XGBoost, trained fresh each request |
| 3 | Long-Term Forecast (3M/6M/1Y/5Y) | `/api/forecast/long-term` | Log-linear trend extrapolation (see note below) |
| 4 | Technical Analysis (MA20/50, RSI, MACD, ADX, CCI) | `/api/signals` | Computed with the `ta` library |
| 5 | Market Trend Gauge | `/api/signals` | Rule-based, from #4's indicators |
| 6 | AI Prediction | `/api/prediction` | Same XGBoost model as #2 |
| 7 | Daily & Weekly Forecast | `/api/forecast/short-term` (`path`) | Aggregated in the frontend from #2's daily path |
| 8 | Actual vs Predicted (R²/MAE/RMSE) | `/api/backtest` | Time-ordered holdout backtest |
| 9 | Monthly Consensus (BUY/WAIT/SELL) | `/api/verdict` | Rule-based, combines #5 + #2 + #8 |
| 10 | SHAP Feature Explanation | `/api/prediction` | `shap.TreeExplainer` on the XGBoost model |
| 11 | Feature Explanation (what MA20/RSI/etc. mean) | — | Static text, `indicatorExplanations.js` |
| 12 | Latest BTC News | `/api/news` | NewsAPI.org (needs a free key) |
| 13 | Crypto Trading / Exchanges | `/api/exchanges` | CoinGecko (live) |
| 14 | Bitcoin Verdict | `/api/verdict` | Same as #9 |

## Be honest with your evaluators about one thing

**#2 and #3 are NOT the same kind of model**, on purpose:
- Short-term (#2) is a real one-step XGBoost model, applied recursively day
  by day. Error compounds with each step, which is why it's only trusted out
  to 30 days.
- Long-term (#3) is a **trend extrapolation**, not the trained model — a
  next-day model has no statistical basis for a 5-year claim. The API
  response includes a `confidence_note` saying exactly this; the frontend
  displays it. If a professor or evaluator asks "how does your model predict
  5 years out," the honest answer is "it doesn't — that's a straight-line
  trend projection, clearly labeled as such," which is a *better* answer
  than pretending otherwise.

This is a legitimate, defensible design choice for an academic project —
it shows you understand the difference between interpolation and
wildly-extrapolated forecasting, rather than papering over it.

## 1. Backend setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows PowerShell
pip install -r requirements.txt

copy .env.example .env
# paste a free key from https://newsapi.org into .env

uvicorn main:app --reload --port 8000
```

Check it's alive:
- http://localhost:8000/docs — interactive Swagger UI for every endpoint
- http://localhost:8000/api/signals — works immediately, no key needed
- http://localhost:8000/api/verdict — trains the model on first call (takes
  a second or two), then serves from cache for 15 minutes

## 2. Frontend setup

```bash
cd frontend
npm create vite@latest . -- --template react   # if not scaffolded yet
npm install
```

Copy everything under `src/api/` and `src/components/` into your project.

```jsx
import LivePriceTab from "./components/LivePriceTab";
import ForecastTab from "./components/ForecastTab";        // Short-Term + Long-Term + Weekly (#2, #3, #7)
import SignalsTab from "./components/SignalsTab";           // Technical Analysis + Gauge (#4, #5)
import AIPredictionTab from "./components/AIPredictionTab"; // AI Prediction + SHAP (#6, #10)
import VerdictTab from "./components/VerdictTab";           // Actual vs Predicted + Consensus + Verdict (#8, #9, #14)
import NewsTab from "./components/NewsTab";                 // #12
import TradeCryptoTab from "./components/TradeCryptoTab";   // #13

{activeTab === "live" && <LivePriceTab />}
{activeTab === "forecast" && <ForecastTab />}
{activeTab === "signals" && <SignalsTab />}
{activeTab === "prediction" && <AIPredictionTab />}
{activeTab === "verdict" && <VerdictTab />}
{activeTab === "news" && <NewsTab />}
{activeTab === "trade" && <TradeCryptoTab />}
```

`.env` in the frontend root if your backend isn't on localhost:8000:
```
VITE_API_BASE=http://localhost:8000
```

```bash
npm run dev
```

## How the model works (for your report/viva)

1. **Data**: CoinGecko `/coins/bitcoin/market_chart`, 365 days of daily
   closes + volume. High/low are approximated from a 2-day rolling window
   (CoinGecko's free tier doesn't expose true daily OHLC at this
   granularity — worth a sentence in your report's limitations section).
2. **Features**: MA5/MA20/MA50, RSI(14), MACD + signal, ADX(14), CCI(20),
   volume, and 1/2/3-day lagged returns.
3. **Model**: `XGBRegressor` (150 trees, depth 3, lr 0.05) predicting
   next-day % return — trained fresh on every cache miss, not saved to disk.
4. **Short-term forecast**: the model is applied recursively — predict day
   1, append it to the price series, recompute all features, predict day 2,
   and so on out to 30 days.
5. **Backtest**: last 20% of days held out in time order (not shuffled —
   this is a time series). A separate model is trained on the earlier 80%
   and evaluated one-step-ahead on the held-out days using their *real*
   prior-day features (not recursive) — this is what R²/MAE/RMSE measure.
6. **SHAP**: `TreeExplainer` on the live model, evaluated at the most recent
   feature row, to show which indicator is driving today's prediction.
7. **Verdict**: a transparent rule combining the technical gauge's score,
   the 7-day forecast's direction, and the backtest R² as a confidence
   multiplier — not a separate trained model.

## Caching

All the modeling endpoints share one cached training run
(`run_full_analysis`, 15-minute TTL) so switching between Forecast, AI
Prediction, and Verdict tabs doesn't retrain the model 3 times. `/api/news`,
`/api/exchanges`, and `/api/price` have their own shorter caches.

## Notes on API limits

- CoinGecko's free public endpoints are rate-limited (~10-30 calls/min) —
  the caching above protects you during dev and demos.
- NewsAPI's free tier only allows server-side calls, which is why News goes
  through the FastAPI backend rather than React calling it directly.
