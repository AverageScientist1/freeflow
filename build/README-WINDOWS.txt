Freeflow for Windows
====================

Run:        double-click Freeflow.exe. Nothing is installed; the folder can live anywhere (USB drive, Desktop).
Open files: .fcs (flow cytometry data) and .ffwb (Freeflow Workbench) can be dragged onto the window.
Remove:     close Freeflow and delete this folder. There is no uninstaller for the ZIP/portable copy.
            Your preferences are kept in %APPDATA%\Freeflow; delete that folder too for a completely clean removal.
            Your Workbench (.ffwb) and data files are yours and are never touched.

If Windows says an app was blocked (Smart App Control / "App Control policy"):
Freeflow.exe in this ZIP is the unmodified Electron runtime, so Windows normally allows it. If you use the
installer or the single-file portable and Windows blocks it, use this ZIP instead. See USER-GUIDE.md in the
repository for details.

The installer (Freeflow-Setup-x.y.z.exe) adds Start menu and desktop shortcuts and an entry in
Settings > Apps > Installed apps, where "Uninstall" removes the program, its shortcuts and file associations.

Freeflow is free software under the MIT license (LICENSE.txt). Third-party components: THIRD-PARTY-NOTICES.md,
LICENSE.electron.txt and LICENSES.chromium.html.
