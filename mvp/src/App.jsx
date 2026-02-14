import { useEffect, useState } from "react";
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

  useEffect(() => {
    refreshState(setTimerState);
    refreshSessions(setSessions);
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

  return (
    <main className="container">
      <h1>Work Day Tracker</h1>
      <p className="subtitle">Slice 6: Session list</p>

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

      <section className="sessions-section">
        <h2>Sessions</h2>
        {sessions.length === 0 ? (
          <p className="sessions-empty">No sessions yet.</p>
        ) : (
          <ul className="sessions-list">
            {sessions.map((s) => (
              <li key={s.id} className="session-item">
                <span className="session-date">{s.date}</span>
                <span className="session-location">{s.location}</span>
                <span className="session-duration">{formatDuration(s.duration_minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;
