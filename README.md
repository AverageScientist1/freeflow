# Freeflow

Desktop app (Windows and Mac) for analysing flow cytometry data (`.fcs` files): plots (pseudocolor, contour, zebra, histogram), gating (polygon, rectangle, ellipse, range, quadrant, boolean), compensation, groups and subgroups, statistics tables, bar charts, reports, quality control, overlays and a cluster explorer (UMAP / t-SNE).

Everything runs on your computer: no account, no internet connection, no telemetry. The application code contains no network calls (see [`SEGURIDAD.md`](SEGURIDAD.md)).

Programa de escritorio (Windows y Mac) para analizar datos de citometría de flujo (`.fcs`). Todo funciona en tu equipo, sin internet y sin cuenta.

- **User guide (Spanish) / Guía de uso:** [`GUIA-DE-USO.md`](GUIA-DE-USO.md)
- **Security and privacy / Seguridad y privacidad:** [`SEGURIDAD.md`](SEGURIDAD.md)
- **License:** [MIT](LICENSE) · third-party notices: [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)

![Freeflow with a gate drawn on a pseudocolor plot](docs/screenshot-dark.png)

## Download

Builds are attached to each [release](../../releases). On Windows: an installer (with uninstaller), a single-file portable, and a `.zip` that needs no installation. On Mac: a `.dmg` or `.zip` (Apple silicon and Intel).

The programs are **not code-signed**, so Windows and macOS may warn on the first run; the guide explains what to do. If Windows blocks the installer or the portable, the `.zip` runs without trouble.

## Build from source

Requires [Node.js](https://nodejs.org) 24.

```
npm ci
npm run dev            # run the app in development mode
npm run typecheck      # type check
npm test               # unit tests
npx playwright install chromium && npx playwright test   # UI tests in a browser
npm run test:desktop   # start the real app and drive it

npm run dist           # Windows: installer, portable and .zip in release/
npm run dist:mac       # Mac (only on a Mac): .dmg and .zip, arm64 and x64
```

A Mac build can only be made on a Mac. Without one, the GitHub Actions workflow *Build Freeflow* builds both the Mac and the Windows programs on GitHub's machines (*Actions > Build Freeflow > Run workflow*; the results are under *Artifacts*).

## Project layout

```
src/core        analysis logic (FCS reader, scales, gates, statistics, clustering...), no UI
src/main        Electron main process (window, files, dialogs)
src/preload     the bridge between the window and the system
src/renderer    the interface (React)
tests, e2e, e2e-desktop   unit tests, browser UI tests, tests of the packaged app
```
