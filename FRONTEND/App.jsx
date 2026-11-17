import { useState } from "react";
import LivePriceTab from "./components/LivePriceTab";
import ShortTermTab from "./components/ShortTermTab";
import LongTermTab from "./components/LongTermTab";
import AIPredictionTab from "./components/AIPredictionTab";
import SignalsTab from "./components/SignalsTab";
import PriceHistoryTab from "./components/PriceHistoryTab";
import NewsTab from "./components/NewsTab";
import "./App.css";

const TABS = [
  { id: "live", label: "Live Price", Component: LivePriceTab },
  { id: "short", label: "Short-Term", Component: ShortTermTab },
  { id: "long", label: "Long-Term", Component: LongTermTab },
  { id: "prediction", label: "AI Prediction", Component: AIPredictionTab },
  { id: "signals", label: "Signals", Component: SignalsTab },
  { id: "history", label: "Price History", Component: PriceHistoryTab },
  { id: "news", label: "News", Component: NewsTab },
];

function App() {
  const [activeTab, setActiveTab] = useState("live");

  const ActiveComponent = TABS.find((t) => t.id === activeTab)?.Component;

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-header__icon">₿</span>
        <h1>Bitcoin Dashboard</h1>
      </header>

      <nav className="tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="tab-content">
        {ActiveComponent && <ActiveComponent />}
      </main>
    </div>
  );
}

export default App;
