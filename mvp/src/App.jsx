import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function refreshState(setTimerState) {
  invoke("get_timer_state")
    .then((s) => setTimerState(s))
    .catch((e) => setTimerState({ status: `Error: ${e}`, elapsed_seconds: 0 }));
}

function App() {
  const [pingResponse, setPingResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [timerState, setTimerState] = useState({ status: "", elapsed_seconds: 0 });

  useEffect(() => {
    refreshState(setTimerState);
  }, []);

  useEffect(() => {
    if (timerState.status !== "running") return;
    const id = setInterval(() => refreshState(setTimerState), 1000);
    return () => clearInterval(id);
  }, [timerState.status]);

  async function handlePing() {
    setLoading(true);
    setPingResponse("");
    try {
      const response = await invoke("ping");
      setPingResponse(response);
    } catch (e) {
      setPingResponse(`Error: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleStart() {
    try {
      await invoke("start_session", { location: "home" });
      refreshState(setTimerState);
    } catch (e) {
      setTimerState({ status: `Error: ${e}`, elapsed_seconds: 0 });
    }
  }

  async function handleStop() {
    try {
      await invoke("stop_session", { elapsedSeconds: timerState.elapsed_seconds });
      refreshState(setTimerState);
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
      <p>Slice 4: pause_session / resume_session</p>

      <p data-testid="timer-status">Status: {timerState.status || "—"}</p>

      <div className="row">
        <button
          type="button"
          onClick={handleStart}
          disabled={timerState.status === "running"}
        >
          Start
        </button>
        <button
          type="button"
          onClick={handleStop}
          disabled={timerState.status !== "running"}
        >
          Stop
        </button>
        <button
          type="button"
          onClick={handlePause}
          disabled={timerState.status !== "running"}
        >
          Pause
        </button>
        <button
          type="button"
          onClick={handleResume}
          disabled={timerState.status !== "paused"}
        >
          Resume
        </button>
        <button
          type="button"
          onClick={handlePing}
          disabled={loading}
        >
          {loading ? "Pinging..." : "Ping"}
        </button>
      </div>

      {pingResponse && (
        <p data-testid="ping-response">Response: {pingResponse}</p>
      )}
    </main>
  );
}

export default App;
