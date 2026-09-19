# PIXEL ARCHIVE SWALLOW — v0.1

**PixelProTech Solutions (Pty) Ltd — Reg 2026/622131/07**

SCAN → SWALLOW → READ → SORT → FIND

## What this actually is

A real Electron desktop application. It is not a website, not a PWA, and
will not run correctly if opened as a plain HTML page in a browser — it
depends on Node-native modules (`better-sqlite3`, `sharp`), a preload
`contextBridge`, and direct filesystem access, none of which exist outside
Electron's renderer process. Run it with `npm start`, package it with
`npm run dist`.

Every module listed below is real, working code against a real local SQLite
database — not a mock, not a hardcoded demo response.

## Honest status of each capability

| Capability | Status | Why |
|---|---|---|
| Scanner hardware integration | **Untested on real hardware** | Shells out to NAPS2's CLI if installed (free, open source, naps2.com). A manual-import watch-folder is the guaranteed-working fallback — point your MFP's own scanning software at the folder shown in the SWALLOW tab, or use the MANUAL IMPORT button. **First real test must happen on your machine with your actual scanner.** |
| Handwriting recognition | **Deliberately capped, low confidence by default** | Tesseract.js is the only fully local, free OCR engine, and it is materially weaker on handwriting than on printed text. `ocr.js` flags likely-handwritten text with a heuristic (short average word length) and forces its confidence to MEDIUM/REVIEW rather than claiming certainty it doesn't have. |
| OCR network dependency | **Tested and hardened** | Tesseract.js downloads its English language data from a CDN on first run. When that fetch is blocked, the underlying worker was found (by testing, not by assumption) to neither resolve nor reject its own promise — it can hang a page indefinitely and separately crash the process via an uncaught exception outside any try/catch. Both are now handled: a 30-second timeout in `ocr.js` forces a hung OCR call to fail cleanly into review, and a process-level safety net in `main.js` catches the crash path. The real fix for a client machine with unreliable internet is still to bundle `eng.traineddata` for a fully offline build — see the comment at the top of `ocr.js`. |
| Document boundary detection & duplicate detection | **Working heuristic, not a trained model** | Deterministic, transparent scoring (`boundary.js`, `duplicates.js`) — the correct v1 choice. It will need tuning against your actual messy archive before trusting its accuracy numbers on real material. |
| Multi-user / multi-office access | **Not built** | v1 is single-machine SQLite by design. Multiple people searching the same archive at once is a real architecture change (LAN server, or a client-server DB) — flag before promising this to a buyer. |

## Setup

```
npm install
npm start
```

- Install **NAPS2** (https://www.naps2.com) for real scanner device selection.
  Without it, the manual-import fallback is always available and always works.
- First OCR run downloads Tesseract's English language data (~15MB) once. For
  a fully offline-from-first-launch build, bundle `eng.traineddata` and switch
  `ocr.js` to a local `langPath` — see the comment at the top of that file.
- Package an installer: `npm run dist` (NSIS on Windows, AppImage on Linux,
  DMG on Mac — see the `build` block in `package.json`).

## Testing

```
npm test
```

Runs `logic.test.js` (entities, boundary, classify, duplicates, search,
review queue, export, audit — against a real temporary SQLite database) and
`image.test.js` (blank-page detection and perceptual-hash duplicate matching
against real generated PNGs). `npm test` temporarily rebuilds
`better-sqlite3` for plain Node, then rebuilds it back for Electron's Node
ABI afterward, because Electron and system Node use different native module
ABIs.

## File structure — flat, one folder, no subfolders

```
pixel-archive-swallow/
  package.json
  main.js              Electron main process, all IPC handlers
  preload.js           safe IPC bridge (contextIsolation on, nodeIntegration off)
  index.html           renderer shell
  styles.css           renderer styling
  app.js               renderer logic, calls window.pixel API only
  db.js                SQLite schema + connection
  audit.js             append-only audit trail
  scanner.js           NAPS2 integration + manual-import watch-folder fallback
  imagePrep.js         preprocessing, blank-page detection, perceptual hash
  ocr.js               printed OCR + confidence-capped handwriting OCR
  boundary.js          document boundary heuristic
  entities.js          SA-tuned entity extraction (dates, VAT, amounts, refs)
  classify.js          keyword classifier + archive-learning (known suppliers)
  duplicates.js        duplicate scoring (never auto-deletes)
  search.js            SQLite FTS5 full-text search
  review.js            review queue (confidence-gated)
  boxLabel.js          printable box label PDF
  exportData.js        CSV export
  pipeline.js          orchestrates the above end-to-end
  logic.test.js         automated tests
  image.test.js         automated tests
  icon-16/32/48/64/128/192/256/512.png, icon.ico, icon.icns
  README.md
  .gitignore
```

## Honesty commitments carried into the code (do not remove when extending)

- Original scans are never overwritten — only a separate processed copy is
  touched (`imagePrep.js`).
- Nothing is marked HIGH confidence unless the underlying engine's own metric
  supports it (`ocr.js`, `classify.js`).
- Duplicates are only ever flagged, never auto-deleted (`duplicates.js`).
- Dates with ambiguous 2-digit years are routed to review, never guessed
  (`entities.js`).
- The dashboard only ever shows real counts from the local database.

## Immediate next step

Run this on the actual target machine with the actual scanner or MFP
attached. That's the only thing that tells you whether the rest of this
build is worth continuing to harden.
