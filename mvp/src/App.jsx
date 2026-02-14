import { useEffect, useState } from "react";
import { format } from "date-fns";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function formatElapsed(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function refreshState(setTimerState) {
  invoke("get_timer_state")
    .then((s) => setTimerState(s))
    .catch((e) => setTimerState({ status: `Error: ${e}`, elapsed_seconds: 0 }));
}

function formatDate(isoDate) {
  if (!isoDate) return "—";
  return format(new Date(isoDate + "T12:00:00"), "dd MMM yyyy");
}

function formatDuration(minutes) {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function refreshSessions(setSessions) {
  invoke("get_sessions")
    .then((s) => setSessions(s))
    .catch(() => setSessions([]));
}

function App() {
  const [timerState, setTimerState] = useState({ status: "", elapsed_seconds: 0 });
  const [location, setLocation] = useState("home");
  const [sessions, setSessions] = useState([]);
  const [settings, setSettings] = useState({ expected_hours_per_week: 40, default_location: "home" });
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState(null);

  useEffect(() => {
    refreshState(setTimerState);
    refreshSessions(setSessions);
    invoke("get_weekly_summary")
      .then((s) => setWeeklySummary(s))
      .catch(() => setWeeklySummary(null));
    invoke("get_settings")
      .then((s) => {
        setSettings(s);
        setLocation(s.default_location || "home");
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (timerState.status !== "running") return;
    const id = setInterval(() => refreshState(setTimerState), 1000);
    return () => clearInterval(id);
  }, [timerState.status]);

  async function handleStart() {
    try {
      await invoke("start_session", { location });
      refreshState(setTimerState);
    } catch (e) {
      setTimerState({ status: `Error: ${e}`, elapsed_seconds: 0 });
    }
  }

  async function handleStop() {
    try {
      await invoke("stop_session", { elapsedSeconds: timerState.elapsed_seconds });
      refreshState(setTimerState);
      refreshSessions(setSessions);
      invoke("get_weekly_summary").then((s) => setWeeklySummary(s)).catch(() => { });
    } catch (e) {
      setTimerState({ status: `Error: ${e}`, elapsed_seconds: timerState.elapsed_seconds });
    }
  }

  async function handlePause() {
    try {
      await invoke("pause_session");
      refreshState(setTimerState);
    } catch (e) {
      setTimerState({ status: `Error: ${e}`, elapsed_seconds: timerState.elapsed_seconds });
    }
  }

  async function handleResume() {
    try {
      await invoke("resume_session");
      refreshState(setTimerState);
    } catch (e) {
      setTimerState({ status: `Error: ${e}`, elapsed_seconds: timerState.elapsed_seconds });
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    try {
      await invoke("save_setting", {
        key: "expected_hours_per_week",
        value: String(settings.expected_hours_per_week),
      });
      await invoke("save_setting", {
        key: "default_location",
        value: settings.default_location,
      });
      setLocation(settings.default_location);
      invoke("get_weekly_summary").then((s) => setWeeklySummary(s)).catch(() => { });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    } catch (e) {
      setTimerState({ status: `Error: ${e}`, elapsed_seconds: timerState.elapsed_seconds });
    }
  }

  return (
    <main className="container">
      <h1>Work Day Tracker</h1>
      <p className="subtitle">Slice 8: Weekly summary</p>

      <div className="timer-display">
        <span className="timer-time" data-testid="timer-display">
          {formatElapsed(timerState.elapsed_seconds)}
        </span>
        <span className="timer-status" data-testid="timer-status">
          {timerState.status || "—"}
        </span>
      </div>

      <div className="location-row">
        <span className="location-label">Location:</span>
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          disabled={timerState.status === "running" || timerState.status === "paused"}
          className="location-picker"
        >
          <option value="home">Home</option>
          <option value="office">Office</option>
        </select>
      </div>

      <div className="row">
        {timerState.status !== "running" && timerState.status !== "paused" && (
          <button type="button" onClick={handleStart}>
            Start
          </button>
        )}
        {(timerState.status === "running" || timerState.status === "paused") && (
          <>
            {timerState.status === "running" && (
              <button type="button" onClick={handlePause}>
                Pause
              </button>
            )}
            {timerState.status === "paused" && (
              <button type="button" onClick={handleResume}>
                Resume
              </button>
            )}
            <button type="button" onClick={handleStop}>
              Stop
            </button>
          </>
        )}
      </div>

      {weeklySummary && (
        <section className="summary-section">
          <h2>This week</h2>
          <div className="summary-grid">
            <span className="summary-label">Today</span>
            <span className="summary-value">{format(new Date(), "EEE dd MMM yyyy")}</span>
            <span className="summary-label">Week of</span>
            <span className="summary-value">{formatDate(weeklySummary.week_start)}</span>
            <span className="summary-label">Actual</span>
            <span className="summary-value">{formatDuration(weeklySummary.actual_minutes)}</span>
            <span className="summary-label">Expected</span>
            <span className="summary-value">{formatDuration(weeklySummary.expected_minutes)}</span>
            <span className="summary-label">Difference</span>
            <span
              className={
                "summary-value summary-diff " +
                (weeklySummary.difference_minutes >= 0 ? "summary-over" : "summary-under")
              }
            >
              {weeklySummary.difference_minutes >= 0 ? "+" : ""}
              {formatDuration(Math.abs(weeklySummary.difference_minutes))}
            </span>
          </div>
        </section>
      )}

      <section className="sessions-section">
        <h2>Sessions</h2>
        {sessions.length === 0 ? (
          <p className="sessions-empty">No sessions yet.</p>
        ) : (
          <ul className="sessions-list">
            {sessions.map((s) => (
              <li key={s.id} className="session-item">
                <span className="session-date">{formatDate(s.date)}</span>
                <span className="session-location">{s.location}</span>
                <span className="session-duration">{formatDuration(s.duration_minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="settings-section">
        <h2>Settings</h2>
        <form onSubmit={handleSaveSettings} className="settings-form">
          <label>
            Expected hours per week
            <input
              type="number"
              min="1"
              max="168"
              value={settings.expected_hours_per_week}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                const h = isNaN(v) ? 40 : Math.max(1, Math.min(168, v));
                setSettings((s) => ({ ...s, expected_hours_per_week: h }));
              }}
              className="settings-input"
            />
          </label>
          <label>
            Default location
            <select
              value={settings.default_location}
              onChange={(e) =>
                setSettings((s) => ({ ...s, default_location: e.target.value }))
              }
              className="location-picker"
            >
              <option value="home">Home</option>
              <option value="office">Office</option>
            </select>
          </label>
          <button type="submit" className="settings-save">
            {settingsSaved ? "Saved" : "Save"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default App;
