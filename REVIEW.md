# Code Review – Work Day Tracker MVP

> **Note:** Many recommendations below have been implemented. See "Suggested quick wins" section.

## Summary

Review of the codebase for redundancy, structure, and UX. Recommendations ordered by impact.

---

## Backend (Rust)

### 1. Redundant: `get_export_csv`

**Finding:** The `get_export_csv` command returns a flat CSV (all dates, no FY grouping). The UI only uses:
- `get_export_csv_by_fy` – export all FYs at once (Sessions "Export CSV" button)
- `get_export_csv_for_fy` – export a single FY (FY section)

**Recommendation:** Remove `get_export_csv`. Update `test_get_export_csv_daily_hours` to use `get_export_csv_by_fy` and assert on the first FY’s CSV content.

### 2. Backend structure

**Finding:** `commands.rs` (~100 lines) and `db/mod.rs` (~420 lines) are still manageable. No restructuring needed for now.

### 3. Tray + frontend sync

**Finding:** Tray actions emit `timer-state-changed`; the frontend listens and refreshes. This is solid. No changes needed.

---

## Frontend (React)

### 1. Outdated subtitle

**Finding:** `<p className="subtitle">Slice 10: Export CSV</p>` is leftover dev text.

**Recommendation:** Remove the subtitle or replace with a short app tagline.

### 2. Duplicate export flow

**Finding:** `handleExport` and `handleExportFy` both:
- Call `open({ directory: true })`
- Use `writeTextFile` with path building
- Set and clear status with `setTimeout`

**Recommendation:** Extract a helper:

```javascript
async function saveCsvToFolder(csv, defaultFilename) {
  const dir = await open({ directory: true, title: "Choose folder" });
  if (!dir) return null;
  const sep = dir.includes("\\") ? "\\" : "/";
  await writeTextFile(`${dir}${sep}${defaultFilename}`, csv);
  return true;
}
```

Then use it in both export handlers.

### 3. Two export entry points

**Finding:**
- Sessions: "Export CSV" → exports all FYs to a folder
- FY section: per-year "Export" buttons

Both are useful: bulk vs single-year. Layout could be clearer.

**Recommendation:** Keep both. Optionally add an "Export all" control in the FY section when multiple FYs exist, and make the Sessions export button a secondary action.

### 4. Refresh logic duplication

**Finding:** The `timer-state-changed` listener and several handlers all call a similar refresh pattern:

```javascript
refreshSessions(setSessions);
invoke("get_weekly_summary").then(...);
invoke("get_financial_years_with_data").then(...);
```

**Recommendation:** Add a `refreshAppData()` helper that runs these three calls, and use it in the listener and handlers.

### 5. Monolithic App.jsx

**Finding:** App.jsx is ~380 lines. Acceptable for MVP, but extraction would improve clarity.

**Recommendation (low priority):** Extract components such as:
- `TimerDisplay`, `TimerControls`
- `WeeklySummary`
- `SessionsList`, `FYExportSection`, `SettingsForm`

---

## CSS

### 1. Unused styles

**Finding:**
- `.logo`, `.logo.vite`, `.logo.react` – Vite template leftovers
- `#greet-input` – unused
- `.link-btn.secondary` – button removed, style unused

**Recommendation:** Delete these classes to reduce noise.

### 2. Duplicate section layout

**Finding:** `.summary-section`, `.sessions-section`, `.fy-section`, `.settings-section` share very similar layout:

```css
margin-top: 2em;
text-align: left;
max-width: 400px;
margin-left: auto;
margin-right: auto;
```

**Recommendation:** Introduce a shared class (e.g. `.section`) to centralize these styles.

---

## Suggested quick wins ✓ (implemented)

1. ~~Remove `get_export_csv` and adjust its test.~~ Done.
2. ~~Remove the outdated "Slice 10" subtitle.~~ Done.
3. ~~Extract `refreshAppData()` and `saveCsvToFolder()` helpers.~~ Done.
4. ~~Remove unused CSS.~~ Done (logo, greet-input, link-btn.secondary).
5. ~~Add a shared `.section` layout class.~~ Done.

---

## What’s in good shape

- Clear separation between db, commands, and lib
- Consistent error handling for commands
- Australian FY logic isolated and tested
- Export UX (dir picker, per-FY files) is clear
- Tray integration and event handling are solid
