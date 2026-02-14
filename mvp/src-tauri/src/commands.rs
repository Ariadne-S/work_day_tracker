use crate::db;
use serde::Serialize;

#[tauri::command]
pub fn ping() -> String {
    "pong".to_string()
}

#[derive(Serialize)]
pub struct TimerState {
    pub status: String,
    pub elapsed_seconds: u64,
}

#[tauri::command]
pub fn get_timer_state() -> Result<TimerState, String> {
    let (status, elapsed) = db::get_timer_state_inner().map_err(|e| e.to_string())?;
    Ok(TimerState {
        status,
        elapsed_seconds: elapsed,
    })
}

#[tauri::command]
pub fn start_session(location: Option<String>) -> Result<i64, String> {
    let loc = location.unwrap_or_else(|| "home".to_string());
    db::start_session_impl(&loc).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stop_session(elapsed_seconds: u64) -> Result<(), String> {
    db::stop_session_impl(elapsed_seconds)
}

#[tauri::command]
pub fn pause_session() -> Result<(), String> {
    db::pause_session_impl()
}

#[tauri::command]
pub fn resume_session() -> Result<(), String> {
    db::resume_session_impl()
}

#[tauri::command]
pub fn get_sessions() -> Result<Vec<db::SessionRow>, String> {
    db::get_sessions_impl()
}

#[tauri::command]
pub fn get_settings() -> Result<db::Settings, String> {
    db::get_settings_impl()
}

#[tauri::command]
pub fn save_setting(key: String, value: String) -> Result<(), String> {
    db::save_setting_impl(&key, &value)
}

#[tauri::command]
pub fn get_weekly_summary() -> Result<db::WeeklySummary, String> {
    db::get_weekly_summary_impl()
}

/// Returns CSV content for export: Date,Location,Hours (one row per date+location, decimal hours).
#[tauri::command]
pub fn get_export_csv() -> Result<String, String> {
    let rows = db::get_daily_hours_for_export_impl()?;
    let mut lines = vec!["Date,Location,Hours".to_string()];
    for (date, location, minutes) in rows {
        let hours = (minutes as f64) / 60.0;
        lines.push(format!("{},{},{:.2}", date, location, hours));
    }
    Ok(lines.join("\n"))
}

/// Returns one CSV per Australian financial year: Vec of (fy, csv_content). One file per year.
#[tauri::command]
pub fn get_export_csv_by_fy() -> Result<Vec<(u32, String)>, String> {
    db::get_export_csv_by_fy_impl()
}

/// Returns list of financial years that have data (newest first).
#[tauri::command]
pub fn get_financial_years_with_data() -> Result<Vec<u32>, String> {
    db::get_financial_years_with_data_impl()
}

/// Returns CSV for a single FY, or empty string if no data.
#[tauri::command]
pub fn get_export_csv_for_fy(fy: u32) -> Result<String, String> {
    db::get_export_csv_for_fy_impl(fy)
}

/// Inserts sample sessions across FY2023–2025 for demo.
/// Pass force: true to clear existing sessions and re-seed.
#[tauri::command]
pub fn seed_sample_data(force: Option<bool>) -> Result<u32, String> {
    db::seed_sample_data_impl(force.unwrap_or(false))
}
