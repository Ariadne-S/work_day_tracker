# Work Day Tracker

A cross-platform menu bar application that tracks work hours and location (home/office) for tax purposes.

## Features

- **Timer** – Start, stop, pause, and resume work sessions
- **Location** – Track whether you worked from home or office
- **Weekly summary** – Actual vs expected hours for the current week
- **Quick log** – Log a full day without using the timer (date, location: home/office/sick, hours). Sick days use 0 hours for export.
- **Edit & delete sessions** – Adjust duration or remove sessions
- **Overtime alerts** – On Fridays, prompts to leave early when weekly target is hit
- **Idle detection** – Optional auto-pause when inactive, auto-resume on activity
- **Export to CSV** – By Australian financial year (Jul 1–Jun 30), with Date, Location, Hours (2 decimals)
- **Financial year exports** – Export individual FYs or all at once
- **Tray icon** – Quick actions: Start (Home/Office), Quick log (Home/Office/Sick), Pause, Resume, Stop, Show, Settings, Quit
- **Sample data** – Load demo sessions across FY2023–2025 for testing

## Tech stack

- **Tauri v2** – Rust backend, React frontend
- **SQLite** (rusqlite) – Local persistence
- **React + Vite** – UI

## Prerequisites

- **Node.js** 20+ or 22+
- **Rust** – `rustup default stable`
- Platform build tools (Xcode on macOS, Visual Studio on Windows)

## Getting started

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

## Seed sample data

To populate the database with demo sessions across multiple financial years:

```bash
cargo run --bin seed
```

To clear existing sessions and re-seed:

```bash
cargo run --bin seed -- --force
```

Data is stored in the app data directory (e.g. `~/Library/Application Support/com.workdaytracker.app/` on macOS).

## Tests

```bash
cargo test
```

## Project structure

```
work_day_tracker_app/
├── src/                # React frontend
├── src-tauri/          # Rust backend
│   ├── src/
│   │   ├── commands.rs # Tauri commands
│   │   ├── db/         # Database layer
│   │   ├── lib.rs      # App setup, tray
│   │   └── seed.rs     # Standalone seed binary
│   └── icons/          # App icons
├── package.json
└── README.md
```
