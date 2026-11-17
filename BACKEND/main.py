"""
Crypto Dashboard backend — News + Trade Crypto (Exchanges) + live BTC price.

Endpoints:
    GET /api/news        -> latest Bitcoin/crypto news (NewsAPI.org), with real article links
    GET /api/exchanges    -> live "where to trade" exchange comparison (CoinGecko, no key needed)
    GET /api/price         -> live BTC price + 24h stats (CoinGecko, no key needed)
    GET /health

Run:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
"""

import os
import time
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from indicators import fetch_ohlc_history, compute_indicators, trend_gauge
import forecasting as fc

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

NEWSAPI_KEY = os.getenv("NEWSAPI_KEY", "")
NEWSAPI_URL = "https://newsapi.org/v2/everything"
COINGECKO_BASE = "https://api.coingecko.com/api/v3"
COINGECKO_API_KEY = os.getenv("COINGECKO_API_KEY", "")
COINGECKO_HEADERS = (
    {"x-cg-demo-api-key": COINGECKO_API_KEY} if COINGECKO_API_KEY else {}
)

FRONTEND_ORIGINS = os.getenv(
    "FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")

app = FastAPI(title="Crypto Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------------------------------
# Tiny in-memory TTL cache (avoids hammering free-tier rate limits)
# --------------------------------------------------------------------------

_cache: dict[str, tuple[float, Any]] = {}


def cache_get(key: str, ttl: int) -> Any | None:
    hit = _cache.get(key)
    if not hit:
        return None
    ts, value = hit
    if time.time() - ts > ttl:
        return None
    return value


def cache_set(key: str, value: Any) -> None:
    _cache[key] = (time.time(), value)


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/api/price")
async def get_price() -> dict:
    """Live BTC price + 24h market stats (CoinGecko simple/price + markets)."""
    cached = cache_get("price", ttl=30)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{COINGECKO_BASE}/coins/markets",
            params={
                "vs_currency": "usd",
                "ids": "bitcoin",
                "price_change_percentage": "24h",
            },
            headers=COINGECKO_HEADERS,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="CoinGecko price fetch failed")

    data = resp.json()
    if not data:
        raise HTTPException(status_code=502, detail="No price data returned")

    coin = data[0]
    market_cap = coin["market_cap"]
    volume_24h = coin["total_volume"]
    result = {
        "price_usd": coin["current_price"],
        "change_24h_pct": coin["price_change_percentage_24h"],
        "market_cap": market_cap,
        "volume_24h": volume_24h,
        "fdv": coin.get("fully_diluted_valuation"),
        "vol_to_mcap_pct": round(volume_24h / market_cap * 100, 2) if market_cap else None,
        "last_updated": coin["last_updated"],
    }
    cache_set("price", result)
    return result


@app.get("/api/price-history")
async def get_price_history(days: int = Query(1, ge=1, le=3650)) -> dict:
    """Price series for the Live Price chart (#1). CoinGecko auto-picks granularity by range."""
    cache_key = f"price-history:{days}"
    cached = cache_get(cache_key, ttl=60 if days <= 1 else 300)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{COINGECKO_BASE}/coins/bitcoin/market_chart",
            params={"vs_currency": "usd", "days": days},
            headers=COINGECKO_HEADERS,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="CoinGecko history fetch failed")

    raw = resp.json()
    points = [{"t": t, "price": round(p, 2)} for t, p in raw.get("prices", [])]
    result = {"points": points}
    cache_set(cache_key, result)
    return result


@app.get("/api/exchanges")
async def get_exchanges(limit: int = Query(10, ge=1, le=50)) -> dict:
    """Live 'where to trade' comparison, ranked by CoinGecko trust score."""
    cache_key = f"exchanges:{limit}"
    cached = cache_get(cache_key, ttl=300)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{COINGECKO_BASE}/exchanges",
            params={"per_page": limit, "page": 1},
            headers=COINGECKO_HEADERS,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="CoinGecko exchange fetch failed")

    raw = resp.json()
    exchanges = [
        {
            "id": ex["id"],
            "name": ex["name"],
            "logo": ex.get("image"),
            "url": ex.get("url"),
            "trust_score": ex.get("trust_score"),
            "trust_score_rank": ex.get("trust_score_rank"),
            "volume_24h_btc": ex.get("trade_volume_24h_btc"),
            "year_established": ex.get("year_established"),
            "country": ex.get("country"),
        }
        for ex in raw
    ]
    result = {"exchanges": exchanges}
    cache_set(cache_key, result)
    return result


async def run_full_analysis(days: int = 365) -> dict:
    """
    One shared training run behind all forecast/prediction endpoints, so we
    don't retrain the model 5x for 5 tabs. Cached for 15 min — training on
    a year of daily data takes well under a second, but there's no reason
    to redo it on every tab switch.
    """
    cached = cache_get("full_analysis", ttl=900)
    if cached:
        return cached

    feature_df = await fc.get_training_data(days=days)
    model, clean = fc._train_model(feature_df)

    close, high, low = feature_df["close"], feature_df["high"], feature_df["low"]
    ind_vals = compute_indicators(feature_df)
    gauge = trend_gauge(ind_vals)

    short_term = fc.short_term_forecast(model, feature_df)
    long_term = fc.long_term_forecast(close)
    bt = fc.backtest(model, clean)
    shap_result = fc.shap_explanation(model, clean)
    final_verdict = fc.verdict(gauge, short_term, bt)

    result = {
        "indicators": ind_vals,
        "gauge": gauge,
        "short_term": short_term,
        "long_term": long_term,
        "backtest": bt,
        "shap": shap_result,
        "verdict": final_verdict,
    }
    cache_set("full_analysis", result)
    return result


@app.get("/api/forecast/short-term")
async def get_short_term_forecast() -> dict:
    """#2 Short-Term Forecast (24H/48H/7D/30D)."""
    analysis = await run_full_analysis()
    return analysis["short_term"]


@app.get("/api/forecast/long-term")
async def get_long_term_forecast() -> dict:
    """#3 Long-Term Forecast (3M/6M/1Y/5Y) — trend extrapolation, clearly labeled low-confidence."""
    analysis = await run_full_analysis()
    return analysis["long_term"]


@app.get("/api/backtest")
async def get_backtest() -> dict:
    """#8 Actual vs Predicted, with R²/MAE/RMSE."""
    analysis = await run_full_analysis()
    return analysis["backtest"]


@app.get("/api/prediction")
async def get_prediction() -> dict:
    """#6 AI Prediction + #10 SHAP Feature Explanation, bundled for one tab."""
    analysis = await run_full_analysis()
    return {
        "short_term": analysis["short_term"],
        "shap": analysis["shap"],
        "backtest_confidence": {"r2": analysis["backtest"]["r2"], "mae": analysis["backtest"]["mae"]},
    }


@app.get("/api/verdict")
async def get_verdict() -> dict:
    """#9 Monthly Consensus + #14 Bitcoin Verdict (BUY/WAIT/SELL)."""
    analysis = await run_full_analysis()
    return {"verdict": analysis["verdict"], "gauge": analysis["gauge"]}


@app.get("/api/signals")
async def get_signals(days: int = Query(90, ge=30, le=365)) -> dict:
    """
    Technical Analysis (#4) + Market Trend Gauge (#5).
    Indicators computed from CoinGecko historical prices — no dataset needed.
    """
    cache_key = f"signals:{days}"
    cached = cache_get(cache_key, ttl=300)
    if cached:
        return cached

    try:
        df = await fetch_ohlc_history(days=days)
    except httpx.HTTPStatusError:
        raise HTTPException(status_code=502, detail="CoinGecko history fetch failed")

    if len(df) < 50:
        raise HTTPException(
            status_code=422,
            detail="Not enough history to compute MA50/ADX reliably — increase 'days'.",
        )

    ind = compute_indicators(df)
    gauge = trend_gauge(ind)

    result = {
        "indicators": ind,
        "gauge": gauge,
        "as_of": df.index[-1].isoformat(),
        "note": "Rule-based gauge from live technical indicators, not a trained model.",
    }
    cache_set(cache_key, result)
    return result


@app.get("/api/news")
async def get_news(query: str = Query("bitcoin OR cryptocurrency"), page_size: int = Query(12, ge=1, le=50)) -> dict:
    """Latest crypto news via NewsAPI.org, with real, clickable article links."""
    if not NEWSAPI_KEY:
        raise HTTPException(
            status_code=500,
            detail="NEWSAPI_KEY not set. Get a free key at https://newsapi.org and set it as an env var.",
        )

    cache_key = f"news:{query}:{page_size}"
    cached = cache_get(cache_key, ttl=180)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            NEWSAPI_URL,
            params={
                "q": query,
                "language": "en",
                "sortBy": "publishedAt",
                "pageSize": page_size,
                "apiKey": NEWSAPI_KEY,
            },
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"NewsAPI fetch failed: {resp.text}")

    data = resp.json()
    articles = [
        {
            "title": a["title"],
            "description": a.get("description"),
            "url": a["url"],
            "source": a["source"]["name"],
            "author": a.get("author"),
            "published_at": a["publishedAt"],
            "image": a.get("urlToImage"),
        }
        for a in data.get("articles", [])
        if a.get("title") and a.get("title") != "[Removed]"
    ]
    result = {"articles": articles}
    cache_set(cache_key, result)
    return result
