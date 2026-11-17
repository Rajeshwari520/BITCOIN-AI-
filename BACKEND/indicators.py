"""
Historical BTC data + technical indicators + rule-based trend gauge.

Feeds dashboard features #4 (Technical Analysis) and #5 (Market Trend Gauge).
Also the shared historical-price source that #2, #3, #6, #7, #8 will build on.
"""

import os

import httpx
import pandas as pd
import ta

COINGECKO_BASE = "https://api.coingecko.com/api/v3"
COINGECKO_API_KEY = os.getenv("COINGECKO_API_KEY", "")
COINGECKO_HEADERS = (
    {"x-cg-demo-api-key": COINGECKO_API_KEY} if COINGECKO_API_KEY else {}
)


async def fetch_ohlc_history(days: int = 90) -> pd.DataFrame:
    """
    Pull daily BTC price history from CoinGecko (free, no key).
    CoinGecko's market_chart gives close-price + volume at regular intervals;
    that's enough to compute standard indicators (RSI/MACD/ADX/CCI/MA need
    close price; ADX/CCI ideally want high/low too, so we approximate
    high/low from rolling price swings when not directly available).
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{COINGECKO_BASE}/coins/bitcoin/market_chart",
            params={"vs_currency": "usd", "days": days, "interval": "daily"},
            headers=COINGECKO_HEADERS,
        )
    resp.raise_for_status()
    data = resp.json()

    prices = pd.DataFrame(data["prices"], columns=["timestamp", "close"])
    volumes = pd.DataFrame(data["total_volumes"], columns=["timestamp", "volume"])

    df = prices.merge(volumes, on="timestamp")
    df["date"] = pd.to_datetime(df["timestamp"], unit="ms")
    df = df.drop(columns=["timestamp"]).set_index("date")

    # Approximate daily high/low from a short rolling window of close prices —
    # CoinGecko's free tier doesn't expose true daily OHLC at this granularity.
    df["high"] = df["close"].rolling(2, min_periods=1).max()
    df["low"] = df["close"].rolling(2, min_periods=1).min()

    return df


def compute_indicators(df: pd.DataFrame) -> dict:
    """Compute MA20, MA50, RSI, MACD, ADX, CCI from a close-price history."""
    close, high, low = df["close"], df["high"], df["low"]

    ma20 = close.rolling(20).mean()
    ma50 = close.rolling(50).mean()
    rsi = ta.momentum.RSIIndicator(close, window=14).rsi()
    macd_obj = ta.trend.MACD(close)
    macd_line = macd_obj.macd()
    macd_signal = macd_obj.macd_signal()
    adx = ta.trend.ADXIndicator(high, low, close, window=14).adx()
    cci = ta.trend.CCIIndicator(high, low, close, window=20).cci()

    def last(series):
        val = series.dropna()
        return round(float(val.iloc[-1]), 2) if not val.empty else None

    return {
        "ma20": last(ma20),
        "ma50": last(ma50),
        "rsi": last(rsi),
        "macd": last(macd_line),
        "macd_signal": last(macd_signal),
        "adx": last(adx),
        "cci": last(cci),
        "close": round(float(close.iloc[-1]), 2),
    }


def trend_gauge(indicators: dict) -> dict:
    """
    Rule-based Market Trend Gauge: Strong Sell / Sell / Neutral / Buy / Strong Buy.
    Each indicator casts a vote; the average vote maps to a verdict.
    This is a transparent heuristic, not a trained model — documented as such
    in the API response so the frontend can label it honestly.
    """
    votes = []
    reasons = []

    rsi = indicators.get("rsi")
    if rsi is not None:
        if rsi > 70:
            votes.append(-1); reasons.append(f"RSI {rsi} is overbought")
        elif rsi < 30:
            votes.append(1); reasons.append(f"RSI {rsi} is oversold")
        else:
            votes.append(0); reasons.append(f"RSI {rsi} is neutral")

    macd, macd_signal = indicators.get("macd"), indicators.get("macd_signal")
    if macd is not None and macd_signal is not None:
        if macd > macd_signal:
            votes.append(1); reasons.append("MACD is above its signal line (bullish)")
        else:
            votes.append(-1); reasons.append("MACD is below its signal line (bearish)")

    ma20, ma50, close = indicators.get("ma20"), indicators.get("ma50"), indicators.get("close")
    if ma20 is not None and ma50 is not None and close is not None:
        if close > ma20 > ma50:
            votes.append(1); reasons.append("Price is above both MA20 and MA50 (uptrend)")
        elif close < ma20 < ma50:
            votes.append(-1); reasons.append("Price is below both MA20 and MA50 (downtrend)")
        else:
            votes.append(0); reasons.append("Price is mixed relative to MA20/MA50")

    adx = indicators.get("adx")
    if adx is not None:
        reasons.append(
            f"ADX {adx} indicates a {'strong' if adx > 25 else 'weak'} trend (direction from the votes above)"
        )

    cci = indicators.get("cci")
    if cci is not None:
        if cci > 100:
            votes.append(1); reasons.append(f"CCI {cci} suggests overbought momentum")
        elif cci < -100:
            votes.append(-1); reasons.append(f"CCI {cci} suggests oversold momentum")
        else:
            votes.append(0)

    score = sum(votes) / len(votes) if votes else 0

    if score >= 0.6:
        verdict = "Strong Buy"
    elif score >= 0.2:
        verdict = "Buy"
    elif score > -0.2:
        verdict = "Neutral"
    elif score > -0.6:
        verdict = "Sell"
    else:
        verdict = "Strong Sell"

    vote_counts = {
        "buy": sum(1 for v in votes if v > 0),
        "neutral": sum(1 for v in votes if v == 0),
        "sell": sum(1 for v in votes if v < 0),
    }

    return {
        "verdict": verdict,
        "score": round(score, 2),
        "reasons": reasons,
        "vote_counts": vote_counts,
    }
