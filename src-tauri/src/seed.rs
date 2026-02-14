//! Standalone binary to seed sample data.
//! Run: `cargo run --bin seed`
//! To clear existing sessions and re-seed: `cargo run --bin seed -- --force`

use std::path::PathBuf;

/// Returns the app data directory path (platform-specific).
fn app_data_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    #[cfg(target_os = "macos")]
    let base = format!("{}/Library/Application Support", home);
    #[cfg(target_os = "windows")]
    let base = std::env::var("APPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Roaming", home));
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let base = format!("{}/.local/share", home);
    PathBuf::from(base).join("com.workdaytracker.app")
}

fn main() {
    let force = std::env::args().any(|a| a == "--force");
    let app_data = app_data_dir();
    std::fs::create_dir_all(&app_data).expect("failed to create app data dir");
    let db_path = app_data.join("work_day_tracker.db");

    let count = work_day_tracker::run_seed(&db_path, force).expect("seed failed");
    if force && count > 0 {
        println!("Cleared and reseeded {} sessions to {:?}", count, db_path);
    } else {
        println!("Seeded {} sessions to {:?}", count, db_path);
    }
}
