# Work Day Tracker

A cross-platform menu bar application that tracks work hours and location (home/office) for tax purposes.

## Features

- **Timer** – Start, stop, pause, and resume work sessions
- **Location** – Track whether you worked from home or office
- **Weekly summary** – Actual vs expected hours for the current week
- **Export to CSV** – By Australian financial year (Jul 1–Jun 30), with Date, Location, Hours (rounded to 2 decimals)
- **Financial year exports** – Section listing years with data; export individual FYs or all at once
- **Tray icon** – Quick actions (Start Home/Office, Pause, Resume, Stop, Show, Quit)
- **Sample data** – Load demo sessions across FY2023–2025 for testing

## Tech stack

- **Tauri v2** – Rust backend, React frontend
- **SQLite** (rusqlite) – Local persistence
- **React + Vite** – UI

## Getting started

```bash
cd mvp && npm run tauri dev
```

## Seed sample data

To populate the database with demo sessions across multiple financial years:

```bash
cd mvp && cargo run --bin seed
```

To clear existing sessions and re-seed (override the skip):

```bash
cd mvp && cargo run --bin seed -- --force
```

Data is stored at the app data directory (e.g. `~/Library/Application Support/com.workdaytracker.mvp/` on macOS). By default, the seed runs only when the database is empty.

## Tests

```bash
cd mvp && cargo test -p mvp
```

## Project structure

```
work_day_tracker_app/
├── mvp/                    # Main app (Tauri + React)
│   ├── src/                # React frontend
│   ├── src-tauri/          # Rust backend
│   │   └── src/seed.rs     # Standalone seed binary
│   └── package.json
├── v1/                     # Archived implementation
├── PLAN.md                 # Implementation plan
└── README.md
```

## Implementation plan

See [PLAN.md](PLAN.md) for the full spec and slice breakdown.
