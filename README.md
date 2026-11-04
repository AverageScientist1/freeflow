# Freeflow

Desktop app (Windows and Mac) for analysing flow cytometry data (`.fcs` files): plots (pseudocolor, contour, zebra, histogram), gating (polygon, rectangle, ellipse, range, quadrant, boolean), compensation, groups and subgroups, statistics tables, bar charts, reports, quality control, overlays and a cluster explorer (UMAP / t-SNE).

Everything runs on your computer: no account, no internet connection, no telemetry. The application code contains no network calls (see [`SEGURIDAD.md`](SEGURIDAD.md)).

Programa de escritorio (Windows y Mac) para analizar datos de citometría de flujo (`.fcs`). Todo funciona en tu equipo, sin internet y sin cuenta.

- **User guide (Spanish) / Guía de uso:** [`GUIA-DE-USO.md`](GUIA-DE-USO.md)
- **Security and privacy / Seguridad y privacidad:** [`SEGURIDAD.md`](SEGURIDAD.md)
- **License:** [MIT](LICENSE) · third-party notices: [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)

![Freeflow with a gate drawn on a pseudocolor plot](docs/screenshot-dark.png)

## Download

Builds are on the [Releases](../../releases) page.

**Windows:** `Freeflow-Setup-X.Y.Z.exe` (installer, with uninstaller), `Freeflow-Portable-X.Y.Z.exe` (single file, no installation) or `Freeflow-X.Y.Z-win-x64.zip` (extract and run `Freeflow.exe`). If Windows blocks the installer or the portable, the `.zip` runs without trouble.

**Mac:** download the `.dmg` that matches your chip (Apple menu > About This Mac):
- `Freeflow-X.Y.Z-mac-arm64.dmg`: Apple silicon (M1, M2, M3, M4)
- `Freeflow-X.Y.Z-mac-x64.dmg`: Intel

Open it and drag Freeflow to *Applications*. The first time, right-click (or Control-click) Freeflow, choose **Open**, then **Open** again: the program is not signed with an Apple developer account, so macOS asks for this once. If macOS says the app is "damaged", run this once in the Terminal and open it again:

```
xattr -cr /Applications/Freeflow.app
```

On a Mac, shortcuts use ⌘ and ⌥ instead of Ctrl and Alt, and ⌫ deletes. To uninstall, drag Freeflow from *Applications* to the Trash (preferences are in `~/Library/Application Support/Freeflow`).

The Mac build is made and its interface tests are run by GitHub Actions on every push (203 browser tests pass on a Mac machine); it is new on Mac, so please report anything odd in the [Issues](../../issues).

The programs are **not code-signed**, so Windows and macOS may warn on the first run.

Los instaladores están en la página de [Releases](../../releases). En Mac: abre el `.dmg` que corresponde a tu chip, arrastra Freeflow a *Aplicaciones* y la primera vez usa clic derecho > **Abrir** > **Abrir**. Detalles en [`GUIA-DE-USO.md`](GUIA-DE-USO.md).

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
