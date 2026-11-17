import { useEffect, useState } from "react";
import "./NewsTab.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NewsTab() {
  const [articles, setArticles] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/news`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Request failed: ${res.status}`);
        }
        const json = await res.json();
        if (!cancelled) {
          setArticles(json.articles);
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

  if (status === "loading") return <div className="state-msg">Loading news…</div>;
  if (status === "error")
    return <div className="state-msg state-msg--error">Couldn't load news: {error}</div>;

  if (!articles || articles.length === 0)
    return <div className="state-msg">No news articles available right now.</div>;

  return (
    <div className="news-grid">
      {articles.map((a) => (
        <a className="news-card" href={a.url} target="_blank" rel="noreferrer" key={a.url}>
          {a.image && <img className="news-card__img" src={a.image} alt="" />}
          <div className="news-card__body">
            <div className="news-card__meta">
              {a.author && <span className="news-card__author">{a.author}</span>}
              <span className="news-card__time">{timeAgo(a.published_at)}</span>
            </div>
            <div className="news-card__title">{a.title}</div>
            <div className="news-card__source">#{a.source}</div>
          </div>
        </a>
      ))}
    </div>
  );
}
