"""
BTC forecasting pipeline. Feeds dashboard features:
    #2 Short-Term Forecast (24H/48H/7D/30D)
    #3 Long-Term Forecast (3M/6M/1Y/5Y)
    #6 AI Prediction
    #7 Daily & Weekly Forecast
    #8 Actual vs Predicted (R²/MAE/RMSE)
    #9 Monthly Consensus (BUY/WAIT/SELL)
    #10 SHAP Feature Explanation
    #14 Bitcoin Verdict

Trained fresh on every request from live CoinGecko history — no stored
dataset or model file. This keeps it always up to date, at the cost of a
few hundred ms per request (cached at the API layer).

Honesty built in, not bolted on: short-term forecasts (24H-30D) come from a
real one-step model applied recursively; long-term forecasts (3M-5Y) are
explicitly a trend extrapolation, not the same model, because a next-day
model has no business making 5-year claims. The UI should say so.
"""

import numpy as np
import pandas as pd
import shap
import ta
from xgboost import XGBRegressor

from indicators import fetch_ohlc_history

FEATURE_COLS = [
    "ma5", "ma20", "ma50", "rsi", "macd", "macd_signal",
    "adx", "cci", "volume", "lag1_ret", "lag2_ret", "lag3_ret",
]


def _build_features(close: pd.Series, high: pd.Series, low: pd.Series, volume: pd.Series) -> pd.DataFrame:
    df = pd.DataFrame({"close": close, "high": high, "low": low, "volume": volume})
    df["ma5"] = close.rolling(5).mean()
    df["ma20"] = close.rolling(20).mean()
    df["ma50"] = close.rolling(50).mean()
    df["rsi"] = ta.momentum.RSIIndicator(close, window=14).rsi()
    macd_obj = ta.trend.MACD(close)
    df["macd"] = macd_obj.macd()
    df["macd_signal"] = macd_obj.macd_signal()
    df["adx"] = ta.trend.ADXIndicator(high, low, close, window=14).adx()
    df["cci"] = ta.trend.CCIIndicator(high, low, close, window=20).cci()
    df["lag1_ret"] = close.pct_change(1)
    df["lag2_ret"] = close.pct_change(2)
    df["lag3_ret"] = close.pct_change(3)
    df["target_ret"] = close.pct_change().shift(-1)  # next-day return, what the model learns
    return df


def _train_model(feature_df: pd.DataFrame) -> tuple[XGBRegressor, pd.DataFrame]:
    clean = feature_df.dropna(subset=FEATURE_COLS + ["target_ret"])
    X, y = clean[FEATURE_COLS], clean["target_ret"]

    model = XGBRegressor(
        n_estimators=150,
        max_depth=3,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
    )
    model.fit(X, y)
    return model, clean


async def get_training_data(days: int = 365) -> pd.DataFrame:
    df = await fetch_ohlc_history(days=days)
    return _build_features(df["close"], df["high"], df["low"], df["volume"])


def recursive_forecast(model: XGBRegressor, feature_df: pd.DataFrame, horizon_days: int) -> list[dict]:
    """
    Walk the model forward one day at a time. Each predicted price is fed
    back in to recompute indicators for the next step — this compounds
    model error, which is exactly why we only trust it out to ~30 days.
    """
    close = feature_df["close"].copy()
    high = feature_df["high"].copy()
    low = feature_df["low"].copy()
    volume = feature_df["volume"].copy()

    path = []
    for step in range(1, horizon_days + 1):
        feats = _build_features(close, high, low, volume)
        last_row = feats[FEATURE_COLS].iloc[[-1]]
        if last_row.isna().any(axis=None):
            break  # not enough history to keep extending safely

        pred_ret = float(model.predict(last_row)[0])
        last_price = float(close.iloc[-1])
        next_price = last_price * (1 + pred_ret)

        next_date = close.index[-1] + pd.Timedelta(days=1)
        close.loc[next_date] = next_price
        high.loc[next_date] = max(next_price, last_price)
        low.loc[next_date] = min(next_price, last_price)
        volume.loc[next_date] = volume.iloc[-1]  # carry volume forward, unknown otherwise

        path.append({"day": step, "date": next_date.isoformat(), "price": round(float(next_price), 2)})

    return path


def short_term_forecast(model: XGBRegressor, feature_df: pd.DataFrame) -> dict:
    horizons = {"24h": 1, "48h": 2, "7d": 7, "30d": 30}
    max_h = max(horizons.values())
    path = recursive_forecast(model, feature_df, max_h)
    current_price = float(feature_df["close"].iloc[-1])

    by_day = {p["day"]: p for p in path}
    result = {}
    for label, h in horizons.items():
        if h in by_day:
            price = by_day[h]["price"]
            result[label] = {
                "price": price,
                "pct_change": round(float(price / current_price - 1) * 100, 2),
            }
        else:
            result[label] = None

    return {"current_price": round(current_price, 2), "forecast": result, "path": path}


def long_term_forecast(close: pd.Series) -> dict:
    """
    Trend extrapolation (log-linear regression on price vs time), NOT the
    same ML model — a one-step-ahead model compounding daily error out to
    5 years is not a meaningful forecast, so this is deliberately a
    simpler, clearly-labeled trend line instead.
    """
    log_price = np.log(close.values)
    t = np.arange(len(close))
    slope, intercept = np.polyfit(t, log_price, 1)

    current_price = float(close.iloc[-1])
    horizons_days = {"3m": 90, "6m": 180, "1y": 365, "5y": 365 * 5}

    result = {}
    for label, days_ahead in horizons_days.items():
        future_t = len(close) - 1 + days_ahead
        projected_log_price = intercept + slope * future_t
        projected_price = float(np.exp(projected_log_price))
        result[label] = {
            "price": round(projected_price, 2),
            "pct_change": round((projected_price / current_price - 1) * 100, 2),
        }

    daily_growth_pct = round((np.exp(slope) - 1) * 100, 3)

    # Monthly-resolution path (recent history + projected trend) so the UI
    # can draw a continuous historical -> forecast line, not just 4 points.
    last_date = close.index[-1]
    hist_path = [
        {"date": d.isoformat(), "price": round(float(p), 2)}
        for d, p in close.items()
    ]
    forecast_path = []
    for months_ahead in range(1, 61):  # out to 5 years, monthly steps
        days_ahead = months_ahead * 30
        future_t = len(close) - 1 + days_ahead
        projected_price = float(np.exp(intercept + slope * future_t))
        forecast_path.append({
            "date": (last_date + pd.Timedelta(days=days_ahead)).isoformat(),
            "price": round(projected_price, 2),
        })

    return {
        "current_price": round(current_price, 2),
        "forecast": result,
        "method": "log-linear trend extrapolation",
        "implied_daily_growth_pct": daily_growth_pct,
        "historical_path": hist_path,
        "forecast_path": forecast_path,
        "confidence_note": (
            "Confidence drops sharply beyond ~3 months — this extrapolates the "
            "recent trend in a straight line and cannot see future events, "
            "cycles, or regime changes."
        ),
    }


def backtest(model: XGBRegressor, clean_df: pd.DataFrame, test_fraction: float = 0.2) -> dict:
    """
    Time-ordered holdout (not shuffled — this is a time series). Predicts
    one day ahead using each day's REAL prior features (not recursive),
    so this measures the model's honest one-step accuracy.
    """
    n_test = max(int(len(clean_df) * test_fraction), 10)
    train, test = clean_df.iloc[:-n_test], clean_df.iloc[-n_test:]

    eval_model = XGBRegressor(
        n_estimators=150, max_depth=3, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8, random_state=42,
    )
    eval_model.fit(train[FEATURE_COLS], train["target_ret"])

    pred_ret = eval_model.predict(test[FEATURE_COLS])
    actual_price = test["close"].values
    predicted_price = test["close"].values * (1 + pred_ret)  # applied to same-day close, one-step

    errors = predicted_price - actual_price
    mae = float(np.mean(np.abs(errors)))
    rmse = float(np.sqrt(np.mean(errors ** 2)))

    ss_res = float(np.sum(errors ** 2))
    ss_tot = float(np.sum((actual_price - actual_price.mean()) ** 2))
    r2 = round(1 - ss_res / ss_tot, 4) if ss_tot > 0 else None

    series = [
        {"date": d.isoformat(), "actual": round(a, 2), "predicted": round(p, 2)}
        for d, a, p in zip(test.index, actual_price, predicted_price)
    ]

    return {
        "r2": r2,
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "residual_std": round(float(np.std(errors)), 2),
        "n_test_days": n_test,
        "series": series,
    }


def shap_explanation(model: XGBRegressor, clean_df: pd.DataFrame) -> dict:
    """SHAP values for the most recent prediction — feature #10."""
    explainer = shap.TreeExplainer(model)
    latest_X = clean_df[FEATURE_COLS].iloc[[-1]]
    shap_values = explainer.shap_values(latest_X)[0]

    contributions = sorted(
        [
            {"feature": f, "shap_value": round(float(v), 5), "feature_value": round(float(latest_X[f].iloc[0]), 4)}
            for f, v in zip(FEATURE_COLS, shap_values)
        ],
        key=lambda x: abs(x["shap_value"]),
        reverse=True,
    )

    top = contributions[:3]
    direction = "pushing the prediction up" if top[0]["shap_value"] > 0 else "pushing the prediction down"
    summary = f"{top[0]['feature'].upper()} is the strongest driver right now, {direction}."

    return {"base_value": round(float(explainer.expected_value), 5), "contributions": contributions, "summary": summary}


def verdict(gauge: dict, short_term: dict, backtest_result: dict) -> dict:
    """
    Combines Market Trend Gauge (#5) + Short-Term Forecast (#2) + model
    confidence (#8's R²) into a BUY/WAIT/SELL call — feature #9 and #14.
    Rule-based on top of the model outputs, not a separate model.
    """
    forecast_7d = short_term["forecast"].get("7d")
    r2 = backtest_result.get("r2")

    reasons = [f"Technical gauge reads {gauge['verdict']} (score {gauge['score']})"]

    if forecast_7d:
        reasons.append(f"7-day model forecast: {forecast_7d['pct_change']:+.2f}%")

    confidence = "low"
    if r2 is not None:
        if r2 > 0.6:
            confidence = "high"
        elif r2 > 0.3:
            confidence = "moderate"
        reasons.append(f"Backtested one-step R² is {r2} ({confidence} confidence)")
    else:
        reasons.append("Backtest R² unavailable — treat this call cautiously")

    score = gauge["score"]
    if forecast_7d:
        score += max(min(forecast_7d["pct_change"] / 10, 1), -1)  # ±10% maps to a full vote
    score /= 2

    if score >= 0.35:
        call = "BUY"
    elif score <= -0.35:
        call = "SELL"
    else:
        call = "WAIT"

    price_target = forecast_7d["price"] if forecast_7d else None
    residual_std = backtest_result.get("residual_std")
    price_range = (
        [round(price_target - residual_std, 2), round(price_target + residual_std, 2)]
        if price_target and residual_std
        else None
    )

    return {
        "call": call,
        "confidence": confidence,
        "price_target_7d": price_target,
        "price_range_7d": price_range,
        "reasons": reasons,
        "disclaimer": "Automated technical + model output for informational purposes — not financial advice.",
    }
