# Codex Instructions

## Project scope

This is a Vite + Electron + SQLite application.

Primary source locations:

* `src/` — frontend and application logic
* `server/` — API and SQLite logic
* `electron/` — Electron entry points
* `scripts/` — project scripts
* root configuration files such as `package.json` and `vite.config.js`

Before editing, identify the smallest set of relevant source files. Do not recursively inspect the entire repository unless the task explicitly requires it.

## Do not scan

Do not recursively read or search these locations unless the task specifically concerns them:

* `.git/`
* `node_modules/`
* `dist/`
* `release/`
* `backups/`
* `data/uploads/`
* nested backup copies of the project
* `legal-dashboard/`
* `legal-dashboard-1.006-menu-widgets-themes/`
* generated bundles
* executable files
* binary database files
* source maps
* logs

Do not inspect `external/` unless the task concerns the map, external build, or a build error originating there.

Do not read binary files such as:

* `*.db`
* `*.sqlite`
* `*.exe`
* `*.dll`
* `*.blockmap`
* `*.zip`
* `*.png`
* `*.jpg`
* `*.pdf`
* `*.doc`
* `*.docx`

unless the current task specifically requires that file.

## Search rules

Use targeted searches with `rg` or equivalent tools.

Prefer commands such as:

```text
rg "search term" src server electron
```

Do not run unrestricted recursive searches from the repository root when a narrower directory is sufficient.

Before making changes:

1. Read `git status`.
2. Inspect the current diff.
3. Identify the relevant controller, page, API route, and stylesheet.
4. State which files will be changed.
5. Do not inspect unrelated sections.

## Existing local changes

Work on top of existing uncommitted changes.

Do not run:

* `git pull`
* `git fetch`
* `git reset`
* `git restore`
* `git checkout .`
* `git clean`
* branch switching
* `git commit`
* `git push`

unless the user explicitly requests it.

## Protected reference files

Reference DOC/DOCX files and Python reference files must not be modified.

Python reference files may only be consulted as documentation. Do not connect Python code to the application.

Do not change document generation, meetings, or map functionality unless explicitly requested.

## Implementation rules

* Modify the existing primary controller instead of creating monkey patches.
* Do not add duplicate event handlers.
* Avoid MutationObserver fixes when the main render logic can be corrected.
* Do not intercept `window.alert`, `window.confirm`, or `window.prompt` globally.
* Preserve existing SQLite data.
* Make migrations repeat-safe.
* Use existing APIs and components where possible.
* Do not introduce a new dependency without checking existing dependencies first.

## Verification

For changed JavaScript files, run `node --check`.

Use the actual scripts from `package.json`.

Do not create installer or release artifacts unless explicitly requested.

Do not claim that a browser or Electron scenario passed unless it was actually tested.
