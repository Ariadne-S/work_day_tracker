use chrono::{Datelike, Utc};
use rusqlite::{params, Connection, Result};
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

static DB_PATH: Mutex<Option<std::path::PathBuf>> = Mutex::new(None);

pub fn init(app_handle: &tauri::AppHandle) -> Result<()> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    std::fs::create_dir_all(&app_data).expect("failed to create app data dir");
    let path = app_data.join("work_day_tracker.db");
    init_at(&path)
}

/// Initialize DB at path (for tests, use ":memory:" or temp path)
pub fn init_at(path: &Path) -> Result<()> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        r"
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_minutes INTEGER,
            location TEXT NOT NULL DEFAULT 'home',
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        INSERT OR IGNORE INTO settings (key, value) VALUES ('active_session_id', '');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('active_session_elapsed', '0');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('active_session_paused', '0');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('expected_hours_per_week', '40');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('default_location', 'home');
        ",
    )?;
    let mut guard = DB_PATH.lock().unwrap();
    *guard = Some(path.to_path_buf());
    Ok(())
}

fn get_connection() -> Result<Connection> {
    let guard = DB_PATH.lock().unwrap();
    let path = guard.as_ref().expect("db not initialized");
    Connection::open(path)
}

fn get_setting(key: &str) -> Result<String> {
    get_connection()?
        .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
}

fn set_setting(key: &str, value: &str) -> Result<()> {
    get_connection()?
        .execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)", params![key, value])?;
    Ok(())
}

/// Create a new session, set it as active. Returns session id.
pub fn start_session_impl(location: &str) -> Result<i64> {
    let now = Utc::now();
    let date = now.format("%Y-%m-%d").to_string();
    let start_time = now.format("%Y-%m-%d %H:%M:%S").to_string();

    let conn = get_connection()?;
    conn.execute(
        "INSERT INTO sessions (date, start_time, location) VALUES (?1, ?2, ?3)",
        params![date, start_time, location],
    )?;
    let id = conn.last_insert_rowid();
    set_setting("active_session_id", &id.to_string())?;
    set_setting("active_session_elapsed", "0")?;
    set_setting("active_session_paused", "0")?;
    Ok(id)
}

/// Pause the active running session. Stores current elapsed for display.
pub fn pause_session_impl() -> Result<(), String> {
    let session_id: String = get_setting("active_session_id").map_err(|e| e.to_string())?;
    if session_id.is_empty() || session_id == "0" {
        return Err("no active session".to_string());
    }
    let paused: u32 = get_setting("active_session_paused")
        .unwrap_or_else(|_| "0".to_string())
        .parse()
        .unwrap_or(0);
    if paused == 1 {
        return Err("session already paused".to_string());
    }
    let (_, elapsed) = get_timer_state_inner().map_err(|e| e.to_string())?;
    set_setting("active_session_elapsed", &elapsed.to_string()).map_err(|e| e.to_string())?;
    set_setting("active_session_paused", "1").map_err(|e| e.to_string())?;
    Ok(())
}

/// Resume a paused session.
pub fn resume_session_impl() -> Result<(), String> {
    let session_id: String = get_setting("active_session_id").map_err(|e| e.to_string())?;
    if session_id.is_empty() || session_id == "0" {
        return Err("no active session".to_string());
    }
    let paused: u32 = get_setting("active_session_paused")
        .unwrap_or_else(|_| "0".to_string())
        .parse()
        .unwrap_or(0);
    if paused != 1 {
        return Err("session not paused".to_string());
    }
    let elapsed: u64 = get_setting("active_session_elapsed")
        .unwrap_or_else(|_| "0".to_string())
        .parse()
        .unwrap_or(0);
    set_setting("active_session_paused", "0").map_err(|e| e.to_string())?;
    // Adjust session start_time so (now - start_time) = elapsed when we compute running elapsed
    let new_start = Utc::now() - chrono::Duration::seconds(elapsed as i64);
    let new_start_str = new_start.format("%Y-%m-%d %H:%M:%S").to_string();
    get_connection()
        .map_err(|e| e.to_string())?
        .execute("UPDATE sessions SET start_time = ?1 WHERE id = ?2", params![new_start_str, session_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Stop the active session with final elapsed seconds.
pub fn stop_session_impl(elapsed_seconds: u64) -> Result<(), String> {
    let session_id: String = get_setting("active_session_id").map_err(|e| e.to_string())?;
    if session_id.is_empty() || session_id == "0" {
        return Err("no active session".to_string());
    }
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let duration_minutes = (elapsed_seconds / 60) as i32;

    get_connection()
        .map_err(|e| e.to_string())?
        .execute(
        "UPDATE sessions SET end_time = ?1, duration_minutes = ?2 WHERE id = ?3",
        params![now, duration_minutes, session_id],
        )
        .map_err(|e| e.to_string())?;
    set_setting("active_session_id", "").map_err(|e| e.to_string())?;
    set_setting("active_session_elapsed", "0").map_err(|e| e.to_string())?;
    set_setting("active_session_paused", "0").map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_timer_state_inner() -> Result<(String, u64)> {
    let session_id: String = get_setting("active_session_id").unwrap_or_default();
    let paused: u32 = get_setting("active_session_paused")
        .unwrap_or_else(|_| "0".to_string())
        .parse()
        .unwrap_or(0);

    let (status, elapsed) = if session_id.is_empty() || session_id == "0" {
        ("idle".to_string(), 0u64)
    } else if paused == 1 {
        let elapsed: u64 = get_setting("active_session_elapsed")
            .unwrap_or_else(|_| "0".to_string())
            .parse()
            .unwrap_or(0);
        ("paused".to_string(), elapsed)
    } else {
        let conn = get_connection()?;
        let start_time: String = conn.query_row(
            "SELECT start_time FROM sessions WHERE id = ?1",
            params![session_id],
            |row| row.get(0),
        )?;
        let start = chrono::NaiveDateTime::parse_from_str(&start_time, "%Y-%m-%d %H:%M:%S")
            .map(|dt| dt.and_utc())
            .unwrap_or_else(|_| Utc::now());
        let elapsed = (Utc::now() - start).num_seconds().max(0) as u64;
        ("running".to_string(), elapsed)
    };

    Ok((status, elapsed))
}

#[derive(serde::Serialize)]
pub struct SessionRow {
    pub id: i64,
    pub date: String,
    pub start_time: String,
    pub end_time: Option<String>,
    pub duration_minutes: Option<i32>,
    pub location: String,
}

/// List completed sessions (with end_time), newest first.
pub fn get_sessions_impl() -> Result<Vec<SessionRow>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, date, start_time, end_time, duration_minutes, location
             FROM sessions WHERE end_time IS NOT NULL
             ORDER BY date DESC, start_time DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SessionRow {
                id: row.get(0)?,
                date: row.get(1)?,
                start_time: row.get(2)?,
                end_time: row.get(3)?,
                duration_minutes: row.get(4)?,
                location: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let sessions: Result<Vec<_>, _> = rows.collect();
    sessions.map_err(|e| e.to_string())
}

const USER_SETTING_KEYS: &[&str] = &["expected_hours_per_week", "default_location"];

#[derive(serde::Serialize)]
pub struct Settings {
    pub expected_hours_per_week: u32,
    pub default_location: String,
}

/// Get user-facing settings (excludes internal keys like active_session_*).
pub fn get_settings_impl() -> Result<Settings, String> {
    let expected: u32 = get_setting("expected_hours_per_week")
        .unwrap_or_else(|_| "40".to_string())
        .parse()
        .unwrap_or(40);
    let default_location = get_setting("default_location").unwrap_or_else(|_| "home".to_string());
    let default_location = if default_location == "office" {
        "office".to_string()
    } else {
        "home".to_string()
    };
    Ok(Settings {
        expected_hours_per_week: expected,
        default_location,
    })
}

/// Save a user setting. Only whitelisted keys are allowed.
pub fn save_setting_impl(key: &str, value: &str) -> Result<(), String> {
    if !USER_SETTING_KEYS.contains(&key) {
        return Err(format!("invalid setting key: {}", key));
    }
    if key == "default_location" && value != "home" && value != "office" {
        return Err("default_location must be 'home' or 'office'".to_string());
    }
    set_setting(key, value).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct WeeklySummary {
    pub week_start: String,
    pub actual_minutes: u32,
    pub expected_minutes: u32,
    pub difference_minutes: i32,
}

/// Summary for the current ISO week (Monday–Sunday).
pub fn get_weekly_summary_impl() -> Result<WeeklySummary, String> {
    let now = Utc::now().date_naive();
    let weekday = now.weekday();
    let days_from_monday = weekday.num_days_from_monday() as i64;
    let monday = now - chrono::Duration::days(days_from_monday);
    let week_end = monday + chrono::Duration::days(6);
    let week_start = monday.format("%Y-%m-%d").to_string();
    let week_end_str = week_end.format("%Y-%m-%d").to_string();

    let conn = get_connection().map_err(|e| e.to_string())?;
    let actual: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(duration_minutes), 0) FROM sessions
             WHERE end_time IS NOT NULL AND date >= ?1 AND date <= ?2",
            params![week_start, week_end_str],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let expected_hours: u32 = get_setting("expected_hours_per_week")
        .unwrap_or_else(|_| "40".to_string())
        .parse()
        .unwrap_or(40);
    let expected_minutes = expected_hours * 60;
    let difference_minutes = actual as i32 - expected_minutes as i32;

    Ok(WeeklySummary {
        week_start,
        actual_minutes: actual.max(0) as u32,
        expected_minutes,
        difference_minutes,
    })
}

/// Daily totals for export: (date, location) -> total minutes.
/// Only completed sessions; one row per (date, location); ordered by date, location.
pub fn get_daily_hours_for_export_impl() -> Result<Vec<(String, String, u32)>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT date, location, SUM(duration_minutes) AS total
             FROM sessions WHERE end_time IS NOT NULL AND duration_minutes IS NOT NULL
             GROUP BY date, location ORDER BY date ASC, location ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let date: String = row.get(0)?;
            let location: String = row.get(1)?;
            let total: i64 = row.get(2)?;
            Ok((date, location, total.max(0) as u32))
        })
        .map_err(|e| e.to_string())?;
    let rows: Result<Vec<_>, _> = rows.collect();
    rows.map_err(|e| e.to_string())
}

/// Australian financial year: July 1 - June 30. FY 2025 = 1 Jul 2024 to 30 Jun 2025.
pub(crate) fn australian_fy_from_date(date_str: &str) -> Option<u32> {
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let year: u32 = parts[0].parse().ok()?;
    let month: u32 = parts[1].parse().ok()?;
    let fy = if month >= 7 { year + 1 } else { year };
    Some(fy)
}

/// Export data grouped by Australian financial year. Returns (fy, csv_content) per year.
pub fn get_export_csv_by_fy_impl() -> Result<Vec<(u32, String)>, String> {
    let rows = get_daily_hours_for_export_impl()?;
    let mut by_fy: std::collections::BTreeMap<u32, Vec<(String, String, u32)>> =
        std::collections::BTreeMap::new();
    for (date, location, minutes) in rows {
        if let Some(fy) = australian_fy_from_date(&date) {
            by_fy.entry(fy).or_default().push((date, location, minutes));
        }
    }
    let mut result = Vec::new();
    for (fy, days) in by_fy {
        let mut lines = vec!["Date,Location,Hours".to_string()];
        for (date, location, minutes) in days {
            let hours = (minutes as f64) / 60.0;
            lines.push(format!("{},{},{:.2}", date, location, hours));
        }
        result.push((fy, lines.join("\n")));
    }
    Ok(result)
}

/// Returns FYs that have completed session data, sorted descending (newest first).
pub fn get_financial_years_with_data_impl() -> Result<Vec<u32>, String> {
    let rows = get_daily_hours_for_export_impl()?;
    let mut fys: std::collections::BTreeSet<u32> = std::collections::BTreeSet::new();
    for (date, _, _) in rows {
        if let Some(fy) = australian_fy_from_date(&date) {
            fys.insert(fy);
        }
    }
    Ok(fys.into_iter().rev().collect())
}

/// Returns CSV for a single financial year, or empty string if no data.
pub fn get_export_csv_for_fy_impl(fy: u32) -> Result<String, String> {
    let by_fy = get_export_csv_by_fy_impl()?;
    Ok(by_fy
        .into_iter()
        .find(|(f, _)| *f == fy)
        .map(|(_, csv)| csv)
        .unwrap_or_default())
}

/// Seed sample sessions across FY2023, FY2024, FY2025 for testing/demo.
/// No-op if sessions already exist, unless `force` is true (clears then seeds).
pub fn seed_sample_data_impl(force: bool) -> Result<u32, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if count > 0 && !force {
        return Ok(0);
    }
    if force && count > 0 {
        conn.execute("DELETE FROM sessions", [])
            .map_err(|e| e.to_string())?;
    }
    let sample = [
        // FY2023 (Jul 2022 - Jun 2023)
        ("2022-08-15", "home", 360),
        ("2022-08-15", "office", 240),
        ("2022-09-01", "office", 480),
        ("2023-02-10", "home", 420),
        ("2023-05-20", "office", 510),
        // FY2024 (Jul 2023 - Jun 2024)
        ("2023-07-03", "home", 300),
        ("2023-08-22", "office", 480),
        ("2023-11-15", "home", 360),
        ("2024-01-08", "office", 420),
        ("2024-04-02", "home", 390),
        // FY2025 (Jul 2024 - Jun 2025)
        ("2024-07-01", "office", 480),
        ("2024-09-16", "home", 360),
        ("2024-12-02", "office", 450),
        ("2025-02-10", "home", 420),
    ];
    for (date, location, mins) in sample {
        let start = format!("{} 09:00:00", date);
        let end = format!("{} 17:00:00", date);
        conn.execute(
            "INSERT INTO sessions (date, start_time, end_time, duration_minutes, location) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![date, start, end, mins, location],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(sample.len() as u32)
}
