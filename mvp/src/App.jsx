import { useEffect, useState } from "react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval } from "date-fns";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
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

function refreshAppData(setSessions, setWeeklySummary, setFinancialYears) {
  refreshSessions(setSessions);
  invoke("get_weekly_summary").then((s) => setWeeklySummary(s)).catch(() => setWeeklySummary(null));
  invoke("get_financial_years_with_data").then((fys) => setFinancialYears(fys)).catch(() => setFinancialYears([]));
}

async function saveCsvToFolder(csv, filename, title = "Choose folder to save") {
  const dir = await open({ directory: true, title });
  if (!dir) return false;
  const sep = dir.includes("\\") ? "\\" : "/";
  await writeTextFile(`${dir}${sep}${filename}`, csv);
  return true;
}

const SESSION_DISPLAY_INCREMENT = 15;

function filterSessions(sessions, filter) {
  if (!sessions.length || filter === "all") return sessions;
  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  return sessions.filter((s) => {
    if (!s.date) return false;
    if (filter === "today") return s.date === todayStr;
    const d = new Date(s.date + "T12:00:00");
    if (filter === "week") {
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
      return isWithinInterval(d, { start: weekStart, end: weekEnd });
    }
    if (filter === "month") {
      const monthStart = startOfMonth(now);
      const monthEnd = endOfMonth(now);
      return isWithinInterval(d, { start: monthStart, end: monthEnd });
    }
    return true;
  });
}

function App() {
  const [timerState, setTimerState] = useState({ status: "", elapsed_seconds: 0 });
  const [location, setLocation] = useState("home");
  const [sessions, setSessions] = useState([]);
  const [settings, setSettings] = useState({ expected_hours_per_week: 40, default_location: "home", enable_overtime_alerts: true, idle_detection_enabled: false, idle_threshold_minutes: 5 });
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState(null);
  const [exportStatus, setExportStatus] = useState("");
  const [financialYears, setFinancialYears] = useState([]);
  const [fyExportStatus, setFyExportStatus] = useState({});
  const [sampleDataStatus, setSampleDataStatus] = useState("");
  const [view, setView] = useState("tracker");
  const [sessionFilter, setSessionFilter] = useState("all");
  const [sessionsDisplayLimit, setSessionsDisplayLimit] = useState(SESSION_DISPLAY_INCREMENT);
  const [logDayDate, setLogDayDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [logDayLocation, setLogDayLocation] = useState("home");
  const [logDayHours, setLogDayHours] = useState(8);
  const [logDayStatus, setLogDayStatus] = useState("");
  const [editingSession, setEditingSession] = useState(null);
  const [overtimeModal, setOvertimeModal] = useState(null);
  const [leaveEarlyTarget, setLeaveEarlyTarget] = useState(null);
  const [hasShownOvertimeAlert, setHasShownOvertimeAlert] = useState(false);

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
    invoke("get_financial_years_with_data")
      .then((fys) => setFinancialYears(fys))
      .catch(() => setFinancialYears([]));

    const unlistenTimer = listen("timer-state-changed", () => {
      refreshState(setTimerState);
      refreshAppData(setSessions, setWeeklySummary, setFinancialYears);
    });
    const unlistenNav = listen("navigate-to", (e) => {
      if (e.payload && ["tracker", "export", "settings"].includes(e.payload)) {
        setView(e.payload);
      }
    });
    return () => {
      unlistenTimer.then((fn) => fn());
      unlistenNav.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (timerState.status !== "running") return;
    const id = setInterval(() => refreshState(setTimerState), 1000);
    return () => clearInterval(id);
  }, [timerState.status]);

  useEffect(() => {
    if (timerState.status !== "running") {
      setLeaveEarlyTarget(null);
      setHasShownOvertimeAlert(false);
      return;
    }
    invoke("get_leave_early_target")
      .then((t) => setLeaveEarlyTarget(t ?? null))
      .catch(() => setLeaveEarlyTarget(null));
  }, [timerState.status]);

  useEffect(() => {
    if (
      timerState.status === "running" &&
      leaveEarlyTarget != null &&
      !hasShownOvertimeAlert &&
      Math.floor(timerState.elapsed_seconds / 60) >= leaveEarlyTarget
    ) {
      setHasShownOvertimeAlert(true);
      alert("Your work week is accomplished!");
    }
  }, [timerState.status, timerState.elapsed_seconds, leaveEarlyTarget, hasShownOvertimeAlert]);

  async function handleStart() {
    try {
      if (settings.enable_overtime_alerts) {
        const overtime = await invoke("get_overtime_status");
        if (overtime.show_modal) {
          setOvertimeModal({ surplus_minutes: overtime.surplus_minutes });
          return;
        }
      }
      await doStartSession();
    } catch (e) {
      setTimerState({ status: `Error: ${e}`, elapsed_seconds: 0 });
    }
  }

  async function doStartSession(withLeaveEarly = false) {
    try {
      if (withLeaveEarly && overtimeModal) {
        await invoke("set_leave_early_target", { minutes: overtimeModal.surplus_minutes });
        setLeaveEarlyTarget(overtimeModal.surplus_minutes);
      }
      setOvertimeModal(null);
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

  function getCurrentFY() {
    const now = new Date();
    return now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  }

  async function handleExportFy(fy) {
    try {
      const csv = await invoke("get_export_csv_for_fy", { fy });
      if (!csv) return;
      const saved = await saveCsvToFolder(csv, `work-hours-FY${fy}.csv`, `Choose folder to save FY${fy} export`);
      if (saved) {
        setFyExportStatus((s) => ({ ...s, [fy]: "Saved" }));
        setTimeout(() => setFyExportStatus((s) => ({ ...s, [fy]: "" })), 2000);
      }
    } catch (e) {
      setFyExportStatus((s) => ({ ...s, [fy]: `Error: ${e}` }));
      setTimeout(() => setFyExportStatus((s) => ({ ...s, [fy]: "" })), 3000);
    }
  }

  async function handleLoadSampleData() {
    try {
      const count = await invoke("seed_sample_data");
      refreshAppData(setSessions, setWeeklySummary, setFinancialYears);
      setSampleDataStatus(count > 0 ? `Loaded ${count} sample sessions` : "Already have data");
      setTimeout(() => setSampleDataStatus(""), 2000);
    } catch (e) {
      setSampleDataStatus(`Error: ${e}`);
      setTimeout(() => setSampleDataStatus(""), 3000);
    }
  }

  async function handleExport() {
    try {
      const byFy = await invoke("get_export_csv_by_fy");
      if (byFy.length === 0) {
        setExportStatus("No data to export");
        setTimeout(() => setExportStatus(""), 2000);
        return;
      }
      const dir = await open({ directory: true, title: "Choose folder to save export files" });
      if (dir) {
        const sep = dir.includes("\\") ? "\\" : "/";
        for (const [fy, csv] of byFy) {
          await writeTextFile(`${dir}${sep}work-hours-FY${fy}.csv`, csv);
        }
        setExportStatus(`Exported ${byFy.length} file(s)`);
        setTimeout(() => setExportStatus(""), 2000);
      }
    } catch (e) {
      setExportStatus(`Error: ${e}`);
      setTimeout(() => setExportStatus(""), 3000);
    }
  }

  function openEditModal(s) {
    const mins = s.duration_minutes ?? 0;
    setEditingSession({
      id: s.id,
      duration_minutes: mins,
      editHours: Math.floor(mins / 60),
      editMinutes: mins % 60,
    });
  }

  async function handleUpdateDuration(e) {
    e.preventDefault();
    if (!editingSession) return;
    try {
      const mins = editingSession.editHours * 60 + editingSession.editMinutes;
      if (mins < 1 || mins > 24 * 60) {
        return;
      }
      await invoke("update_session_duration", {
        sessionId: editingSession.id,
        newDurationMinutes: mins,
      });
      refreshAppData(setSessions, setWeeklySummary, setFinancialYears);
      setEditingSession(null);
    } catch (err) {
      // Could show error in modal
      setEditingSession((prev) => prev ? { ...prev, error: String(err) } : null);
    }
  }

  async function handleDeleteSession(s) {
    if (!window.confirm(`Delete session for ${formatDate(s.date)}, ${s.location}, ${formatDuration(s.duration_minutes)}?`)) {
      return;
    }
    try {
      await invoke("delete_session", { sessionId: s.id });
      refreshAppData(setSessions, setWeeklySummary, setFinancialYears);
    } catch (err) {
      alert(`Error: ${err}`);
    }
  }

  async function handleLogDay(e) {
    e.preventDefault();
    try {
      const mins = Math.round(logDayHours * 60);
      if (mins < 1 || mins > 24 * 60) {
        setLogDayStatus("Hours must be between 0.01 and 24");
        return;
      }
      await invoke("log_full_day", {
        date: logDayDate,
        location: logDayLocation,
        durationMinutes: mins,
      });
      refreshAppData(setSessions, setWeeklySummary, setFinancialYears);
      setLogDayStatus("Logged");
      setTimeout(() => setLogDayStatus(""), 2000);
    } catch (err) {
      setLogDayStatus(`Error: ${err}`);
      setTimeout(() => setLogDayStatus(""), 3000);
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
      await invoke("save_setting", {
        key: "enable_overtime_alerts",
        value: settings.enable_overtime_alerts ? "1" : "0",
      });
      await invoke("save_setting", {
        key: "idle_detection_enabled",
        value: settings.idle_detection_enabled ? "1" : "0",
      });
      await invoke("save_setting", {
        key: "idle_threshold_minutes",
        value: String(settings.idle_threshold_minutes ?? 5),
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

      <nav className="app-nav">
        <button
          type="button"
          className={"nav-link" + (view === "tracker" ? " active" : "")}
          onClick={() => setView("tracker")}
        >
          Tracker
        </button>
        <button
          type="button"
          className={"nav-link" + (view === "export" ? " active" : "")}
          onClick={() => setView("export")}
        >
          Export
        </button>
        <button
          type="button"
          className={"nav-link" + (view === "settings" ? " active" : "")}
          onClick={() => setView("settings")}
        >
          Settings
        </button>
      </nav>

      {view === "tracker" && (
        <>
      <div className="timer-display">
        <span className="timer-time" data-testid="timer-display">
          {formatElapsed(timerState.elapsed_seconds)}
        </span>
        <span className="timer-status" data-testid="timer-status">
          {timerState.status === "paused" && timerState.paused_reason === "idle"
            ? "paused (idle)"
            : (timerState.status || "—")}
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

      <div className="row timer-controls">
        {timerState.status !== "running" && timerState.status !== "paused" && (
          <button type="button" onClick={handleStart} className="timer-btn">
            Start
          </button>
        )}
        {(timerState.status === "running" || timerState.status === "paused") && (
          <>
            {timerState.status === "running" && (
              <button type="button" onClick={handlePause} className="timer-btn">
                Pause
              </button>
            )}
            {timerState.status === "paused" && (
              <button type="button" onClick={handleResume} className="timer-btn">
                Resume
              </button>
            )}
            <button type="button" onClick={handleStop} className="timer-btn">
              Stop
            </button>
          </>
        )}
      </div>

      <section className="section log-day-section">
        <h2>Quick log</h2>
        <p className="log-day-hint">Log a full work day without using the timer</p>
        <form onSubmit={handleLogDay} className="log-day-form">
          <div className="log-day-row">
            <label>
              Date
              <input
                type="date"
                value={logDayDate}
                onChange={(e) => setLogDayDate(e.target.value)}
                className="log-day-input"
              />
            </label>
            <label>
              Location
              <select
                value={logDayLocation}
                onChange={(e) => setLogDayLocation(e.target.value)}
                className="location-picker"
              >
                <option value="home">Home</option>
                <option value="office">Office</option>
              </select>
            </label>
            <label>
              Hours
              <input
                type="number"
                min="0.25"
                max="24"
                step="0.25"
                value={logDayHours}
                onChange={(e) => setLogDayHours(parseFloat(e.target.value) || 8)}
                className="log-day-hours"
              />
            </label>
          </div>
          <button type="submit" className="log-day-btn">
            {logDayStatus || "Log day"}
          </button>
        </form>
      </section>

      {weeklySummary && (
        <section className="section summary-section">
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

      <section className="section sessions-section">
        <div className="sessions-header">
          <h2>Sessions</h2>
          <select
            value={sessionFilter}
            onChange={(e) => {
              setSessionFilter(e.target.value);
              setSessionsDisplayLimit(SESSION_DISPLAY_INCREMENT);
            }}
            className="session-filter"
          >
            <option value="all">All</option>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
          </select>
        </div>
        <p className="sessions-hint">
          {sessionFilter === "all"
            ? "All completed sessions, newest first"
            : `Filtered to ${sessionFilter === "today" ? "today" : sessionFilter === "week" ? "this week" : "this month"}`}
        </p>
        {sessions.length === 0 ? (
          <p className="sessions-empty">No sessions yet.</p>
        ) : (() => {
          const filtered = filterSessions(sessions, sessionFilter);
          if (filtered.length === 0) {
            return <p className="sessions-empty">No sessions in this period.</p>;
          }
          const displayed = filtered.slice(0, sessionsDisplayLimit);
          const hasMore = displayed.length < filtered.length;
          return (
            <>
              <ul className="sessions-list">
                {displayed.map((s) => (
                  <li key={s.id} className="session-item">
                    <span className="session-date">{formatDate(s.date)}</span>
                    <span className="session-location">{s.location}</span>
                    <span className="session-duration">{formatDuration(s.duration_minutes)}</span>
                    <button
                      type="button"
                      className="session-edit-btn"
                      onClick={() => openEditModal(s)}
                      title="Edit duration"
                      aria-label="Edit duration"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="session-delete-btn"
                      onClick={() => handleDeleteSession(s)}
                      title="Delete session"
                      aria-label="Delete session"
                    >
                      🗑️
                    </button>
                  </li>
                ))}
              </ul>
              {hasMore && (
                <button
                  type="button"
                  className="show-more-btn"
                  onClick={() => setSessionsDisplayLimit((n) => n + SESSION_DISPLAY_INCREMENT)}
                >
                  Show more ({filtered.length - displayed.length} remaining)
                </button>
              )}
            </>
          );
        })()}
      {overtimeModal && (
        <div
          className="edit-modal-overlay"
          onClick={() => setOvertimeModal(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Escape" && setOvertimeModal(null)}
          aria-label="Close modal"
        >
          <div className="edit-modal overtime-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Overtime this week</h3>
            <p className="overtime-modal-text">
              You&apos;ve already hit your weekly target. You can leave {formatDuration(overtimeModal.surplus_minutes)} early if you&apos;d like.
            </p>
            <div className="edit-modal-actions">
              <button type="button" onClick={() => doStartSession(false)}>
                No, work normally
              </button>
              <button type="button" onClick={() => doStartSession(true)} className="overtime-yes-btn">
                Yes, leave early
              </button>
            </div>
          </div>
        </div>
      )}
      {editingSession && (
        <div
          className="edit-modal-overlay"
          onClick={() => setEditingSession(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Escape" && setEditingSession(null)}
          aria-label="Close modal"
        >
          <div
            className="edit-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Edit duration</h3>
            <p className="edit-modal-original">
              Original: {formatDuration(editingSession.duration_minutes)}
            </p>
            <form onSubmit={handleUpdateDuration} className="edit-modal-form">
              <div className="edit-modal-row">
                <label>
                  Hours
                  <input
                    type="number"
                    min="0"
                    max="24"
                    value={editingSession.editHours}
                    onChange={(e) =>
                      setEditingSession((prev) => ({
                        ...prev,
                        editHours: Math.max(0, Math.min(24, parseInt(e.target.value, 10) || 0)),
                      }))
                    }
                    className="edit-modal-input"
                  />
                </label>
                <label>
                  Minutes
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={editingSession.editMinutes}
                    onChange={(e) =>
                      setEditingSession((prev) => ({
                        ...prev,
                        editMinutes: Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)),
                      }))
                    }
                    className="edit-modal-input"
                  />
                </label>
              </div>
              {editingSession.error && (
                <p className="edit-modal-error">{editingSession.error}</p>
              )}
              <div className="edit-modal-actions">
                <button type="button" onClick={() => setEditingSession(null)}>
                  Cancel
                </button>
                <button type="submit">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
      </section>
        </>
      )}

      {view === "export" && (
        <section className="section export-view">
        <h2>Export</h2>
        <div className="export-actions">
          <button type="button" onClick={handleExport} className="export-btn">
            {exportStatus || "Export all FYs to folder"}
          </button>
        </div>
        <h3 className="export-subhead">By financial year</h3>
        {financialYears.length === 0 ? (
          <p className="fy-empty">
            No financial year data yet.{" "}
            <button type="button" onClick={handleLoadSampleData} className="link-btn">
              Load sample data
            </button>
            {" "}to see previous years.
            {sampleDataStatus && <span className="fy-status"> {sampleDataStatus}</span>}
          </p>
        ) : (
          <>
            <ul className="fy-list">
              {financialYears.map((fy) => (
                <li key={fy} className="fy-item">
                  <span className="fy-label">
                    FY {fy}
                    {fy === getCurrentFY() && " (current)"}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleExportFy(fy)}
                    className="export-fy-btn"
                  >
                    {fyExportStatus[fy] || "Export"}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        </section>
      )}

      {view === "settings" && (
      <section className="section settings-section">
        <h2>Settings</h2>
        <form onSubmit={handleSaveSettings} className="settings-form">
          <div className="settings-field">
            <label htmlFor="expected-hours">Expected hours per week</label>
            <input
              id="expected-hours"
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
          </div>
          <div className="settings-field">
            <label htmlFor="default-location">Default location</label>
            <select
              id="default-location"
              value={settings.default_location}
              onChange={(e) =>
                setSettings((s) => ({ ...s, default_location: e.target.value }))
              }
              className="location-picker"
            >
              <option value="home">Home</option>
              <option value="office">Office</option>
            </select>
          </div>
          <label className="settings-checkbox-label">
            <input
              type="checkbox"
              checked={settings.enable_overtime_alerts ?? true}
              onChange={(e) =>
                setSettings((s) => ({ ...s, enable_overtime_alerts: e.target.checked }))
              }
            />
            Overtime alerts (Friday: &quot;leave early&quot; when over target)
          </label>
          <label className="settings-checkbox-label">
            <input
              type="checkbox"
              checked={settings.idle_detection_enabled ?? false}
              onChange={(e) =>
                setSettings((s) => ({ ...s, idle_detection_enabled: e.target.checked }))
              }
            />
            Auto-pause when idle
          </label>
          {settings.idle_detection_enabled && (
            <div className="settings-field">
              <label htmlFor="idle-threshold">Idle threshold (minutes)</label>
              <input
                id="idle-threshold"
                type="number"
                min="1"
                max="60"
                value={settings.idle_threshold_minutes ?? 5}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  const m = isNaN(v) ? 5 : Math.max(1, Math.min(60, v));
                  setSettings((s) => ({ ...s, idle_threshold_minutes: m }));
                }}
                className="settings-input"
              />
              <span className="settings-hint">Session auto-pauses after this many minutes of inactivity</span>
            </div>
          )}
          <button type="submit" className="settings-save">
            {settingsSaved ? "Saved" : "Save"}
          </button>
        </form>
      </section>
      )}
    </main>
  );
}

export default App;
