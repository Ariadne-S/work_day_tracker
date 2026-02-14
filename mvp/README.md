# Work Day Tracker – MVP (Incremental)

Incremental implementation following [../PLAN.md](../PLAN.md).

## Prerequisites

- **Node.js** 20.19+ or 22.12+
- **Rust** – `rustup default stable`
- Platform build tools (Xcode on macOS, Visual Studio on Windows)

## Run

```bash
npm install
npm run tauri dev
```

## Slice 1: Ping ✓

- **Backend:** `ping` command returns `"pong"`
- **Unit test:** `cargo test` in `src-tauri/`
- **Frontend:** Ping button → displays response
- **Validation:** Click Ping → see "pong"

## Test

```bash
# Rust unit tests
cd src-tauri && cargo test
```
