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
