# PIXEL ARCHIVE SWALLOW — v0.1

**PixelProTech Solutions (Pty) Ltd — Reg 2026/622131/07**

SCAN → SWALLOW → READ → SORT → FIND

## What this actually is right now

A real Electron desktop application with a working local pipeline: image
preprocessing → OCR → entity extraction → document boundary detection →
classification → archive-learning → duplicate signal scoring → full-text
search → review queue → box/label management → CSV/PDF export → audit trail.
Every one of those modules is real, working code — not a mock, not a
hardcoded demo response.

## What is honestly NOT yet proven, and why

| Capability | Status | Why |
|---|---|---|
| Scanner hardware integration | **Untested on real hardware** | This was built with no physical scanner or GUI available in the build environment. The code shells out to NAPS2 (a real, free, open-source scan bridge) if installed, with a raw-WIA fallback path documented in `scanner.js`. A **manual import watch-folder** is wired in as a guaranteed-working path — scan with your MFP's own software, drop the output into the shown folder, and the full pipeline runs on it. **First real test must happen on your machine with your actual scanner.** |
| Handwriting recognition | **Deliberately capped, low confidence by default** | Tesseract.js (the only fully local, free OCR engine) is materially weaker on handwriting than printed text. `ocr.js` runs it but forces results into LOW/REVIEW REQUIRED unless confidence is unusually high — per the spec's own rule, this app will not claim certainty it doesn't have. If handwriting accuracy needs to be materially better, the real options are a cloud OCR API (breaks "zero cloud" unless scoped narrowly) or a locally-hosted TrOCR-class model (needs real GPU/compute budget) — this is an architecture decision, not a bug, and it's yours to make once Phase 1–2 prove out. |
| Document boundary detection & duplicate detection | **Working heuristic, not a trained model** | Real, deterministic, transparent scoring (see `boundary.js`, `duplicates.js`) — this is the correct v1 choice per the spec's own instruction to prefer deterministic code where it's better. Expect it to need tuning against your actual messy archive (Phase 3 test material, per spec section 33) before trusting its accuracy numbers. |
| Multi-user / multi-office access | **Not built** | v1 is single-machine SQLite by design (spec section 22). If more than one person needs to search the same archive, that's a real architecture change (a small local server + LAN access, or a real client-server DB) — flag before promising this to an enterprise buyer. |

## What has actually been tested, right now, in this build

Not just "should work" — these were executed and passed against real inputs before delivery:

- `npm install` (full, real, on a clean copy) succeeds; `postinstall` correctly rebuilds `better-sqlite3` for Electron's Node ABI.
- `npm test` runs two real test suites (`logic.test.js`, `image.test.js`) — 23 checks total, all passing — covering: entity extraction (amounts/dates/VAT/refs/phone/email, including the "don't guess a 2-digit year" rule), document boundary detection (sequential pages stay together, blank+ref-change splits), classification (keyword rules + archive-learning signature matching), duplicate scoring (identical vs unrelated documents), review queue, full-text search (by supplier name and by reference number), CSV export, box label PDF generation, blank-page detection, and perceptual-hash duplicate matching on real generated images.
- Confirmed (not assumed) that live OCR requires network access to download Tesseract's language data on first run — this only fails in a sandboxed environment with no internet; it will succeed normally on your machine.
- One dev-only vulnerability was found via `npm audit`: a critical CVE in `node-tar`, a transitive dependency of `electron-builder` (the packaging tool). It affects the build toolchain, not the shipped app — run `npm audit fix` before packaging a release if you want it cleared.

Run `npm test` yourself after `npm install` to see the same 23 passes on your machine before you ever touch a scanner.

Note: `npm test` temporarily rebuilds `better-sqlite3` for plain Node (tests run outside Electron), then rebuilds it back for Electron's Node ABI afterward so `npm start` keeps working. This is a real, necessary step, not a workaround — Electron and system Node use different native module ABIs, and this project was caught failing exactly this way during verification, then fixed.

## Setup (on a real Windows/Mac/Linux machine, not this build container)

```
npm install
npm start
```

- Install **NAPS2** (https://www.naps2.com — free, open source) if you want real
  scanner device selection instead of the manual-import fallback.
- First OCR run downloads Tesseract's English language data (~15MB) once. To
  make a fully offline-from-first-launch build (matching the "zero cloud"
  claim from day one), bundle `eng.traineddata` into the installer — see the
  comment at the bottom of `ocr.js`.
- Packaging a real installer: `npx electron-builder` (see `build` config in
  `package.json` — targets NSIS on Windows, AppImage on Linux, DMG on Mac).

## File structure — flat, one folder, no subfolders

```
pixel-archive-swallow/
  package.json
  main.js              Electron main process, all IPC handlers
  preload.js           safe IPC bridge (contextIsolation)
  index.html           renderer shell (SWALLOW/ARCHIVE/SEARCH/REVIEW/BOXES/SETTINGS)
  styles.css           renderer styling
  app.js               renderer logic, calls window.pixel API
  db.js                SQLite schema + connection
  audit.js             append-only audit trail
  scanner.js           real scanner integration + manual-import fallback
  imagePrep.js         preprocessing, blank-page detection, perceptual hash
  ocr.js               printed OCR + honestly-capped handwriting OCR
  boundary.js          document boundary heuristic
  entities.js          SA-tuned entity extraction (dates, VAT, amounts, refs)
  classify.js          keyword classifier + archive-learning (known suppliers)
  duplicates.js        duplicate scoring (never auto-deletes)
  search.js            SQLite FTS5 full-text search
  review.js            review queue (confidence-gated)
  boxLabel.js          printable box label PDF
  exportData.js        CSV / text export
  pipeline.js          orchestrates the above end-to-end
  logic.test.js        automated tests — entities/boundary/classify/duplicates/search/export
  image.test.js        automated tests — preprocessing/blank-detection/perceptual-hash
  README.md
```

## Honesty commitments carried into the code (do not remove when extending)

- Original scans are never overwritten — only a separate processed copy is
  touched (`imagePrep.js`).
- Nothing is marked HIGH confidence unless the underlying engine's own metric
  supports it (`ocr.js`, `boundary.js`, `classify.js`).
- Duplicates are only ever flagged, never auto-deleted (`duplicates.js`).
- Dates with ambiguous 2-digit years are routed to review, never guessed
  (`entities.js`).
- The dashboard only ever shows real counts from the local database — no
  demo/placeholder numbers (`main.js` → `dashboard:stats`).

## Immediate next step

Run this on the actual target machine with the actual scanner or MFP
attached. That is Phase 1 from the original spec, and it is the only thing
that tells you whether the rest of this build is worth continuing to harden.
