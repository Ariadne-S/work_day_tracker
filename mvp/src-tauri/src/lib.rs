mod commands;
mod db;

use commands::{get_sessions, get_settings, get_timer_state, pause_session, ping, resume_session, save_setting, start_session, stop_session};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use serial_test::serial;

    #[test]
    fn test_ping_returns_pong() {
        assert_eq!(ping(), "pong");
    }

    #[test]
    #[serial]
    fn test_db_init_and_get_timer_state_returns_idle() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("test.db");
        db::init_at(&db_path).expect("db init failed");
        let state = get_timer_state().expect("get_timer_state failed");
        assert_eq!(state.status, "idle");
        assert_eq!(state.elapsed_seconds, 0);
    }

    #[test]
    #[serial]
    fn test_start_session_then_running() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("test.db");
        db::init_at(&db_path).expect("db init failed");
        db::start_session_impl("home").expect("start_session failed");
        let state = get_timer_state().expect("get_timer_state failed");
        assert_eq!(state.status, "running");
    }

    #[test]
    #[serial]
    fn test_stop_session_then_idle() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("test.db");
        db::init_at(&db_path).expect("db init failed");
        db::start_session_impl("office").expect("start_session failed");
        db::stop_session_impl(300).expect("stop_session failed");
        let state = get_timer_state().expect("get_timer_state failed");
        assert_eq!(state.status, "idle");
        assert_eq!(state.elapsed_seconds, 0);
    }

    #[test]
    #[serial]
    fn test_stop_session_updates_db() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("test.db");
        db::init_at(&db_path).expect("db init failed");
        db::start_session_impl("home").expect("start_session failed");
        db::stop_session_impl(125).expect("stop_session failed");
        let conn = rusqlite::Connection::open(&db_path).expect("open db");
        let (duration, end_time): (Option<i32>, Option<String>) = conn
            .query_row(
                "SELECT duration_minutes, end_time FROM sessions WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query");
        assert_eq!(duration, Some(2)); // 125 / 60 = 2
        assert!(end_time.is_some());
    }

    #[test]
    #[serial]
    fn test_pause_session_then_paused() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("test.db");
        db::init_at(&db_path).expect("db init failed");
        db::start_session_impl("home").expect("start_session failed");
        db::pause_session_impl().expect("pause_session failed");
        let state = get_timer_state().expect("get_timer_state failed");
        assert_eq!(state.status, "paused");
    }

    #[test]
    #[serial]
    fn test_get_sessions_returns_completed() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("test.db");
        db::init_at(&db_path).expect("db init failed");
        db::start_session_impl("home").expect("start_session failed");
        db::stop_session_impl(60).expect("stop_session failed");
        let sessions = db::get_sessions_impl().expect("get_sessions failed");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].location, "home");
        assert_eq!(sessions[0].duration_minutes, Some(1));
    }

    #[test]
    #[serial]
    fn test_get_settings_returns_defaults() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("test.db");
        db::init_at(&db_path).expect("db init failed");
        let settings = db::get_settings_impl().expect("get_settings failed");
        assert_eq!(settings.expected_hours_per_week, 40);
    }

    #[test]
    #[serial]
    fn test_save_setting_persists() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("test.db");
        db::init_at(&db_path).expect("db init failed");
        db::save_setting_impl("expected_hours_per_week", "35").expect("save_setting failed");
        db::save_setting_impl("default_location", "office").expect("save_setting failed");
        let settings = db::get_settings_impl().expect("get_settings failed");
        assert_eq!(settings.expected_hours_per_week, 35);
        assert_eq!(settings.default_location, "office");
    }

    #[test]
    #[serial]
    fn test_resume_session_then_running() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("test.db");
        db::init_at(&db_path).expect("db init failed");
        db::start_session_impl("home").expect("start_session failed");
        db::pause_session_impl().expect("pause_session failed");
        db::resume_session_impl().expect("resume_session failed");
        let state = get_timer_state().expect("get_timer_state failed");
        assert_eq!(state.status, "running");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            db::init(app.handle()).expect("failed to init db");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping, get_timer_state, start_session, stop_session, pause_session, resume_session, get_sessions, get_settings, save_setting])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
