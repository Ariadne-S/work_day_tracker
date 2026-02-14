mod commands;
mod db;

/// Initialize DB at path and seed sample data. Returns count of sessions added.
/// Set force true to clear existing sessions and re-seed.
pub fn run_seed(path: &std::path::Path, force: bool) -> Result<u32, String> {
    db::init_at(path).map_err(|e| e.to_string())?;
    db::seed_sample_data_impl(force)
}

use commands::{get_export_csv, get_export_csv_by_fy, get_export_csv_for_fy, get_financial_years_with_data, get_sessions, get_settings, get_timer_state, get_weekly_summary, pause_session, ping, resume_session, save_setting, seed_sample_data, start_session, stop_session};
use tauri::{Emitter, Manager};

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
    fn test_get_weekly_summary() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("test.db");
        db::init_at(&db_path).expect("db init failed");
        db::save_setting_impl("expected_hours_per_week", "40").expect("save failed");
        db::start_session_impl("home").expect("start failed");
        db::stop_session_impl(120).expect("stop failed"); // 2 minutes
        let summary = db::get_weekly_summary_impl().expect("get_weekly_summary failed");
        assert_eq!(summary.actual_minutes, 2);
        assert_eq!(summary.expected_minutes, 2400); // 40 * 60
        assert_eq!(summary.difference_minutes, -2398);
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

    #[test]
    #[serial]
    fn test_get_export_csv_daily_hours() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("test.db");
        db::init_at(&db_path).expect("db init failed");
        db::start_session_impl("home").expect("start failed");
        db::stop_session_impl(90 * 60).expect("stop failed"); // 90 min = 1.5 hours
        db::start_session_impl("office").expect("start failed");
        db::stop_session_impl(120 * 60).expect("stop failed"); // 120 min = 2 hours on same day
        let csv = get_export_csv().expect("get_export_csv failed");
        assert!(csv.starts_with("Date,Location,Hours\n"));
        assert!(csv.contains("202"));
        // Same date, two locations: home 1.5h, office 2h → two rows
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], "Date,Location,Hours");
        let home_row: Vec<&str> = lines[1].split(',').collect();
        let office_row: Vec<&str> = lines[2].split(',').collect();
        assert_eq!(home_row[1], "home");
        assert_eq!(office_row[1], "office");
        assert!((home_row[2].parse::<f64>().unwrap() - 1.5).abs() < 0.01);
        assert!((office_row[2].parse::<f64>().unwrap() - 2.0).abs() < 0.01);
    }

    #[test]
    fn test_australian_fy_from_date() {
        assert_eq!(db::australian_fy_from_date("2024-06-30"), Some(2024));
        assert_eq!(db::australian_fy_from_date("2024-07-01"), Some(2025));
        assert_eq!(db::australian_fy_from_date("2024-01-15"), Some(2024));
        assert_eq!(db::australian_fy_from_date("2023-12-31"), Some(2023));
    }

    #[test]
    #[serial]
    fn test_get_export_csv_by_fy_australian_financial_year() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("test.db");
        db::init_at(&db_path).expect("db init failed");
        db::start_session_impl("home").expect("start failed");
        db::stop_session_impl(90 * 60).expect("stop failed");
        db::start_session_impl("office").expect("start failed");
        db::stop_session_impl(120 * 60).expect("stop failed");
        let by_fy = get_export_csv_by_fy().expect("get_export_csv_by_fy failed");
        assert!(!by_fy.is_empty());
        let (fy, csv) = &by_fy[0];
        assert!(*fy >= 2024 && *fy <= 2030);
        assert!(csv.starts_with("Date,Location,Hours\n"));
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines.len(), 3);
        assert!(lines[1].contains("home"));
        assert!(lines[2].contains("office"));
    }
}

fn format_elapsed_short(seconds: u64) -> String {
    let h = seconds / 3600;
    let m = (seconds % 3600) / 60;
    if h > 0 {
        format!("{}h {}m", h, m)
    } else {
        format!("{}m", m)
    }
}

fn update_tray_tooltip<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let tooltip = match db::get_timer_state_inner() {
        Ok((status, elapsed)) => match status.as_str() {
            "running" => format!("Work Day Tracker – Running: {}", format_elapsed_short(elapsed)),
            "paused" => format!("Work Day Tracker – Paused: {}", format_elapsed_short(elapsed)),
            _ => "Work Day Tracker".to_string(),
        },
        Err(_) => "Work Day Tracker".to_string(),
    };
    let app_for_closure = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(tray) = app_for_closure.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(tooltip));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            db::init(app.handle()).expect("failed to init db");

            use tauri::menu::MenuBuilder;
            let menu = MenuBuilder::new(app)
                .text("start_home", "Start (Home)")
                .text("start_office", "Start (Office)")
                .separator()
                .text("pause", "Pause")
                .text("resume", "Resume")
                .text("stop", "Stop")
                .separator()
                .text("show", "Show")
                .text("quit", "Quit")
                .build()
                .expect("failed to create tray menu");

            let handle = app.handle().clone();
            let _tray = tauri::tray::TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Work Day Tracker")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(move |_tray, event| {
                    use tauri::tray::TrayIconEvent;
                    if matches!(event, TrayIconEvent::Click { .. }) {
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        "start_home" => {
                            let _ = db::start_session_impl("home");
                            let _ = app.emit("timer-state-changed", ());
                            update_tray_tooltip(app);
                        }
                        "start_office" => {
                            let _ = db::start_session_impl("office");
                            let _ = app.emit("timer-state-changed", ());
                            update_tray_tooltip(app);
                        }
                        "pause" => {
                            let _ = db::pause_session_impl();
                            let _ = app.emit("timer-state-changed", ());
                            update_tray_tooltip(app);
                        }
                        "resume" => {
                            let _ = db::resume_session_impl();
                            let _ = app.emit("timer-state-changed", ());
                            update_tray_tooltip(app);
                        }
                        "stop" => {
                            if let Ok((_, elapsed)) = db::get_timer_state_inner() {
                                let _ = db::stop_session_impl(elapsed);
                            }
                            let _ = app.emit("timer-state-changed", ());
                            update_tray_tooltip(app);
                        }
                        _ => {}
                    }
                })
                .build(app)
                .expect("failed to build tray");

            // Spawn thread to update tooltip every 2 seconds
            let handle_for_tooltip = app.handle().clone();
            std::thread::spawn(move || loop {
                update_tray_tooltip(&handle_for_tooltip);
                std::thread::sleep(std::time::Duration::from_secs(2));
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping, get_timer_state, start_session, stop_session, pause_session, resume_session, get_sessions, get_settings, save_setting, get_weekly_summary, get_export_csv, get_export_csv_by_fy, get_export_csv_for_fy, get_financial_years_with_data, seed_sample_data])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                window.hide().unwrap();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
