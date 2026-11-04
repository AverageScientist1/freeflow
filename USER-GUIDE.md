# Freeflow user guide

Freeflow is a desktop program (Windows and Mac) for analysing flow cytometry data (`.fcs` files): plot, draw gates, compensate, and get counts and percentages. Everything runs on your computer, with no internet and no account.

## Contents

[Install](#install) · [Uninstall](#uninstall) · [Open data](#open-data) · [Plots](#plots) · [Gates](#gates) · [Boolean populations](#boolean-populations-and-or-not) · [Several plots at once](#several-plots-at-once) · [Cluster Explorer](#cluster-explorer-umap-or-t-sne) · [Arrange the screen](#arrange-the-screen) · [Samples and groups](#samples-and-groups) · [Right-click menus](#right-click-menus) · [A reference sample and the others](#a-reference-sample-and-the-others) · [Statistics, charts and reports](#statistics-tables-charts-and-reports) · [Compensation](#compensation) · [Save and export](#save-and-export) · [Shortcuts](#shortcuts) · [Mac](#mac) · [Limits](#limits)

## Install

Download from the [Releases](../../releases) page.

### Windows

| File | What it is |
| --- | --- |
| `Freeflow-Setup-X.Y.Z.exe` | Installer. Lets you choose the folder, adds Start menu and desktop shortcuts, and registers `.fcs` and `.ffwb` files. Includes an uninstaller. |
| `Freeflow-Portable-X.Y.Z.exe` | One file, nothing to install. It unpacks to a temporary folder each time and removes it when you close the program. |
| `Freeflow-X.Y.Z-win-x64.zip` | Extract it anywhere (a USB drive, the desktop) and run `Freeflow.exe`. The most reliable option if Windows blocks the other two. |

**Windows warnings.** Freeflow is not signed with a publisher certificate, so Windows 11 decides for itself whether to let it run:

- **SmartScreen** may say "Windows protected your PC". Click **More info**, then **Run anyway**.
- **Smart App Control** may block an unsigned file it does not know ("An App Control policy blocked this file"). The `Freeflow.exe` inside the `.zip` is the unmodified Electron program, which Windows recognises, so the `.zip` normally runs. The installer and the portable file are new files for each version: Windows may block them at the first try and allow them minutes later. If that happens, use the `.zip` or try again a little later.

The lasting fix is a code-signing certificate (for example Azure Trusted Signing, or SignPath Foundation, which is free for open-source projects). You can also turn Smart App Control off in *Windows Security > App & browser control*, but it cannot be turned back on without reinstalling Windows.

### Mac

1. Download the `.dmg` for your chip (Apple menu > *About This Mac*): `…-mac-arm64.dmg` for Apple silicon (M1 or newer), `…-mac-x64.dmg` for Intel.
2. Open it and drag **Freeflow** to *Applications*.
3. macOS will say it "could not verify that Freeflow is free of malware". This happens because the program is not signed with a paid Apple developer account (Freeflow is open source, so you can read its code). Open it once in **one** of these two ways:
   - **Terminal (simplest, works on every macOS version).** Paste this line, press Return, then open Freeflow normally:

     ```
     xattr -cr /Applications/Freeflow.app
     ```

   - **System Settings.** Try to open Freeflow and click **Done**. Then open *System Settings > Privacy & Security*, scroll down to *Security*, click **Open Anyway** next to "Freeflow was blocked", enter your password (or Touch ID) and click **Open**. On macOS 14 and older you can instead right-click Freeflow > **Open** > **Open**.

   You only need to do this the first time.

**Portable (no installation):** download the `.zip` instead of the `.dmg`, unzip it and run `Freeflow.app` from anywhere (the Desktop, a USB drive). It needs the same one-time step above. On a Mac every app is already portable: to remove it, just delete `Freeflow.app`.

The Mac version is new and has not yet been tried by hand on many Macs. Please report problems in the repository's Issues.

## Uninstall

- **Installed with `Freeflow-Setup`:** *Settings > Apps > Installed apps > Freeflow > Uninstall* (or run `Uninstall Freeflow.exe` in the install folder). It removes the program, the shortcuts and the file associations. It does **not** delete your preferences (`%APPDATA%\Freeflow`) or your `.ffwb` and `.fcs` files.
- **`.zip` or portable:** close Freeflow and delete the folder (or the portable file). Nothing else is installed.
- **Mac:** drag Freeflow from *Applications* to the Trash. Preferences are in `~/Library/Application Support/Freeflow`.
- **Remove preferences too:** delete `%APPDATA%\Freeflow` (paste it in the File Explorer address bar).
- **Updating:** install over the old version, or extract the new `.zip` in another folder. Workbench files from older versions still open.

## Open data

- **File > Add FCS files…** (you can pick several).
- **Drag** `.fcs` files (or a Workbench `.ffwb`) onto the window.
- **Double-click** a `.fcs` or `.ffwb` file if you have associated it with Freeflow (right-click > *Open with*).
- If a file cannot be opened, a notice at the top gives its name and the reason; the other files still load. The notice stays until you press **Dismiss**.
- Files in **OneDrive** should be set to "Always keep on this device", or Windows may not let Freeflow read them.

## Plots

- Choose **X** and **Y** above the plot. **Plot** is *Pseudocolor* (density-coloured dots), *Contour*, *Zebra* or *Histogram*.
- The **T** button next to each axis opens the scale of **that** axis: Linear, Log, Biexponential or Arcsinh. Axes fit the data of **all** your samples. Changing a scale does not move a gate away from its events.
- **Contour** and **Zebra** draw lines of equal density instead of dots. Each line encloses a share of the events, from the innermost (about 5%) to the outermost (about 95%). *Zebra* also fills the bands between lines. **Lines** (5, 10, 15 or 20) sets how many lines; **Outliers** draws the events outside the outer line as dots. Gates work the same on every plot type.
- **Smooth / Raw:** *Smooth* shows density colours, smoothed histograms and soft contour lines. *Raw* shows every event as it is: plain single-colour dots, unsmoothed bars and unsmoothed contours. The choice is remembered.
- **Overlays** (button next to the plot) draws other populations on top of the open plot, from this sample or from other samples, using the same axes:
  - The **tabs are the top-level groups** (*All Samples* and each group). When the chosen group has **subgroups**, a **Subgroup** selector appears beside the population selector.
  - Under the tabs, each sample is a button: **press it to overlay it** (its colour shows on the button), press again to remove it. **Overlay all** adds every sample listed; **Remove all** clears them. The **Population** selector chooses which population of those samples is drawn (by default the one you have open). The ← → keys move between tabs.
  - On a **histogram** each overlay is a curve with a legend; **Normalize to mode** gives every curve the same maximum height and **Smooth** smooths them. On a **two-parameter plot** overlays are coloured dots (up to 6,000 per overlay).
  - Overlays are saved with the Workbench and appear in exported images.
- **File > Export plot image (PNG)…** saves the plot as you see it.

## Gates

Tools next to the plot selector:

| Tool | How |
| --- | --- |
| Arrow | Select, move and edit |
| Polygon | Click each point, double-click to close (Esc cancels) |
| Rectangle / Ellipse | Drag |
| Quadrant (+) | One click where the lines cross: makes 4 populations |
| Range (histogram) | Drag along the axis |

**Edit a gate you have drawn** (arrow tool): drag a small white square to change the outline (corners, edges, polygon vertices), drag inside to move it, or use the **arrow keys** (hold Shift for bigger steps). On a quadrant, the centre moves both lines and the end of each line moves only that line. Esc cancels a drag. Every change can be undone.

**Population tree** (left): double-click or F2 to rename, Delete to remove. Columns: count, % of parent, % of total. Click a population to see only those events and keep gating inside it.

## Boolean populations (AND, OR, NOT)

The **Boolean…** button of the population tree combines populations of the open sample: **AND** (events in all chosen populations), **OR** (in any of them) and **NOT** (outside the chosen one). The new population hangs from *All events*, shows a symbol (∧ ∨ ¬) and can be gated further. If you delete a population that a boolean uses, the booleans that use it are deleted too. With *Link gates in group* and *Apply to group* they travel to the other samples pointing at those samples' own populations.

## Several plots at once

Above the plot there are three views (**Single plot / All samples / Sheet**) and a **Smooth / Raw** switch:

- **Single plot:** the big plot, where gates are drawn and edited.
- **All samples:** the same plot (same axes, same population, same gates with their %) for **every sample of the group**, as thumbnails. Arrow keys move between them; double-click opens one.
- **Sheet:** **several different plots of the chosen sample**, like an analysis sheet. **Plots from gates** makes one plot per gate, each on its parent population and with its axes (the gating strategy at a glance). **Add plot** adds the plot you have open. Each plot has its own population, type and axis selectors and buttons to open it large or remove it. When you change sample (‹ › buttons, arrow keys or Page Up / Page Down) the sheet shows **the same plots with the new sample's data**. The sheet is saved with the Workbench. The pencil on a plot opens an **editor** over the sheet where you draw, move and delete gates as in Single plot; the thumbnails update at once.
- **Thumbnail zoom** (*All samples* and *Sheet*): **Ctrl + mouse wheel** over the thumbnails (or a pinch on a touchpad) makes **all** of them bigger or smaller together, like Windows File Explorer. The **Size** slider does the same. Without Ctrl the wheel just scrolls. The size is remembered.
- **Move through samples with the keyboard:** with the focus on the sample list, **Down / Up** go to the next or previous sample (also **Home / End**). Anywhere in the window, **Page Down / Page Up** do the same (except inside a text field or a selector).

## Cluster Explorer (UMAP or t-SNE)

Mode **Cluster Explorer** (Alt+5). It draws the events of a population as a map where similar cells sit together, and groups them into clusters.

1. Choose the **Samples**: the selected sample, or **the whole group joined in one map** (a virtual concatenation: the same number of events is taken from each sample, spread along the file, so no sample weighs more).
2. Choose the **population** (for example *Lymphs*) and the **parameters** (fluorescence ones by default; buttons *Markers / All / None*). Each parameter is measured on the same scale as the plots.
3. Choose the **method**: *UMAP* (faster, up to 10,000 events per sample) or *t-SNE* (slower, sharper islands, up to 2,500) and the number of **clusters**.
4. **Run**. It runs apart from the window (you can keep using the program) and can be cancelled.

Result: the map, which can be coloured by **cluster**, by **sample** or by **each marker**; a table with the events and the % of each cluster and a **heat map** (blue: below the average of the clusters; red: above); and, with several samples, a table of **what % of each sample falls in each cluster**, a quick way to see what changes between a sample and the reference. Clicking a cluster name highlights it on the map. **Re-cluster** groups the same map with another number of clusters. **Export events (CSV)** saves each event with its position, cluster and values; **File > Export plot or chart image** saves the map as PNG. Clusters are computed on the parameters, not on the map. Results stay while the program is open but are not saved in the Workbench (run again to recompute).

## Arrange the screen

- **Panels:** the bars between the centre and the side panels can be **dragged** to make the left panel (groups, samples, populations) or the right panel (details) wider or narrower. They also move with the **keyboard** (focus the bar and use ← →; Shift for big steps; Home / End for the minimum and maximum). The small button on the bar, or a double-click on it, **folds the whole panel** and brings it back; the **View** menu does the same.
- **Sections:** *Groups*, *Samples* and *Populations* in the left panel have a bar between them to **change their height**, and their title **folds** them. In the right panel the blocks *Sample*, *Group comparison* and *Parameters* fold.
- **The T button** (axis scale) **opens the right panel** if it was folded, so you see the scale panel.
- **Everything is remembered** between sessions. **View > Reset the layout** puts it back as at the start.

## Samples and groups

- **Rename a sample:** double-click its name, or **F2** with the sample focused; Enter accepts, Esc cancels. The new name is used everywhere (tables, plots, labels, sorting) and saved in the Workbench; the FCS file on disk keeps its own name. Useful for names like 1 WT, 2 KO… and sorting with *Sort… > Name*.
- **Mark several:** Ctrl+click adds or removes a sample; Shift+click marks a range (or Shift+arrow).
- **Delete depends on where you are:** inside a **group or subgroup**, **Delete** (or the trash button) **takes the sample out of that group** and puts it in the group above (or in *All Samples* if the group was top-level); it stays in the Workbench and asks nothing. In **All Samples**, Delete **removes the sample from the Workbench**. The button says what it will do (*Remove sample from the group* / *Remove sample*).
- **Remove samples from the Workbench:** with *All Samples* shown, press **Delete**, use the trash button, or **Remove from the Workbench…** in the right-click menu. It asks first: it removes the sample and its gates from the Workbench, **does not touch the FCS file** on disk, and **cannot be undone** (the Undo history is cleared).
- **Sort:** the **Sort…** selector in *Samples* orders the samples: natural name (S2 before S10), A–Z, Z–A, more or fewer events, oldest or newest (file date), by group, or by the value of any file **keyword**. Samples without that value go last. The order is saved in the Workbench and is the one used by the arrow keys, the gallery, the tables and the charts. By hand: **drag** a sample onto another (it goes before it) or **Alt+↑ / Alt+↓** to move it one place. New samples are added at the end.
- **Subgroups:** the arrow button in *Groups* (**New subgroup**) creates a group inside the selected group. **Drag** samples onto a group to move them, or a group onto another to make it a subgroup (onto *All Samples* makes it top-level again). A group shows its samples **and those of its subgroups**. The group tree draws **branches** (vertical lines and elbows, like a folder tree); a group with subgroups **folds and unfolds** (click its arrow, or ← →). In the sample list, each sample carries a tag with **the path of its group** (for example Treated › Low dose) when you are viewing a top-level group.
- **Gates of their own per subgroup:** with *Link gates in group*, gates are shared only between samples of the **exact same** group, so each subgroup has its own. To push a gate from the group above downwards, select it in a sample of that group and press **Apply to group**: it reaches all samples of the group and its subgroups once, and afterwards each subgroup keeps its own.
- **Apply a gate wherever you want:** under the population tree, the **Apply to…** button (and right-click on a population > *Apply to…*) offers *All samples*, **each group that contains the open sample** (from the top-level one down to its subgroup, with the number of samples it would reach) and *The marked samples*. There are two actions: **Apply the selected gate to** (copies the chosen gate with everything under it) and **Replace the whole gating of** (replaces the whole gating of those samples with the open sample's, after asking). Both can be undone. The quick buttons *Apply to group* and *Resync all* work on the samples of the group and its subgroups.
- When you delete a group, its samples and subgroups **move up one level**.

## Right-click menus

Right-click (or the menu key / **Shift+F10** with the item focused) opens a menu **in the same theme** as the program (light or dark), with submenus (they open on hover, or with →; ← closes them; ↑ ↓ move; Esc closes and returns the focus). It acts on the clicked sample, or on **all marked samples** if the clicked one is among them.

- **On a sample:** *Show* (as a single plot, the same plot for all, in the sheet, Quality control, Metadata, Compensation or Cluster Explorer) · *Overlay … on the open plot* · *Rename…* · *Move to group* (any group or subgroup, *no group*, or *New group from the selection*) · *Gates* (*Copy the gating of … to* the other marked samples, the rest of its group or all; *Clear the gates*) · *Compensation matrix* (pick a matrix or *None*) · *Export* (statistics of those samples or of all, as CSV) · *File* (*Show in folder*, *Copy the file path*) · *Sort the list* · *Remove from its group* · *Remove from the Workbench…*.
- **On a group:** *New group*, *New subgroup here*, *Rename…*, *Move into* (another group or top level), *Select its samples*, *Overlay its samples on the open plot*, *Sort its samples*, *Delete the group*.
- **On a population of the tree:** *Show as the plot*, *Overlay on the open plot*, *Same population in all samples*, *Rename…*, *Apply to the group*, *New boolean population…*, *Delete*.
- **On the empty space of the sample list:** *Select all*, *Sort the list*, *Add FCS files…*, *Load a demo sample*.

## A reference sample and the others

The typical case: gate a reference sample (say the wild type) and see what falls outside it in the others.

1. Open the reference sample and draw the gate, for example a **Range** on the FL1-H histogram.
2. Switch to any other sample: **the same gate is already there**, with **exactly the same thresholds**, and the population tree shows what percentage of that sample falls inside. What is outside are your outliers.
3. You can change the scale of an axis (**T**) at any time: **the gate stays on the same values and the same events**; only the drawing changes.

How it works, so nothing surprises you:

- Gates are stored in **real data values** (for example "FL1-H between 1,000 and 100,000"), not in screen positions.
- A parameter uses **the same default scale in every loaded sample**, so they look comparable.
- **Link gates in group** (checkbox under the tree, or the *Gating* menu): while it is checked, a gate you draw, move, rename or delete in one sample is copied to the other samples of its group, and a sample you add or move into that group takes the gates it already has. Uncheck it to analyse each sample on its own; when you check it again it asks before making the others equal to the sample you are on.
- Each group or subgroup is its own "family": gates do not pass between different groups, or between a group and the samples outside it (to spread them on purpose, use *Apply to…*).
- Files saved with an older version are **converted** when opened (a notice appears); save them again to keep the current format.
- **Groups:** create groups with **+**, and move a sample with the **Group** selector of the right panel.
- **Apply to group** (Alt+G) copies the selected gate (and what hangs from it) to the other samples of the group. **Resync all** (Alt+Shift+G) replaces the whole tree of the other samples with the current one (asks first).
- With the link off, copies are independent: if you change one, apply again to spread the change.
- The right panel has a table that compares the chosen population across all samples of the group.

## Statistics, tables, charts and reports

- **Tables** (side bar, Alt+6): one row per sample of the group chosen on the left and one column for each *population + statistic* combination. Statistics: count, % of parent, % of total, median, mean, geometric mean, SD, CV % and the Nth percentile of any parameter. Columns are saved with the Workbench. **Export CSV** opens in Excel (the separator follows your language, or set it in Preferences).
- **Charts** (Alt+7): bars of a table column, one bar per sample or the mean ± SD per group with the points of each sample. **File > Export plot or chart image** saves it as PNG.
- **Reports** (Alt+8): a report is a list of blocks in order: heading, text, the table and bar charts (columns come from Tables and the group is the one chosen on the left). A preview is shown on the right. **Export report (HTML)** creates a single page that any browser opens and that you can print to PDF from there. Blocks are saved with the Workbench.
- **Metadata Manager** (Alt+1): a table of the keywords of each FCS file (date, instrument, tube name…), a search box and a group selector for each sample.
- **Quality Control** (Alt+2): events per time interval of the chosen sample (marks in red the intervals with irregular flow and gives the % of events affected) and saturated detectors (events at the top of the range).
- **Preferences** (Alt+9): light/dark mode and the number format of the CSV.

## Compensation

Mode **Compensation** (grid icon, Alt+3). If the file carries a spillover matrix (`$SPILLOVER`), it appears by itself, but it is **not applied until you press** *Apply to this sample* / *Apply to all samples*. Applying it creates `Comp-…` parameters that you choose on the axes. You can edit the matrix values or create a new one.

## Save and export

- **Ctrl+S** saves your analysis as a Workbench (`.ffwb`). It stores the gates, groups and scales, and the **path** of each `.fcs` file, not the data. If you move a `.fcs` file, the Workbench still opens, marks that sample and keeps the gates.
- **File > Export statistics (CSV)…** creates a table with sample, group, population, events, % of parent and % of total, ready for Excel.
- The program asks before closing or opening another analysis when there are unsaved changes.

## Shortcuts

| | |
| --- | --- |
| Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S | New / open / save / save as |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Alt+1 … Alt+9 | Switch mode (Metadata, QC, Compensation, Graphs, Cluster Explorer, Tables, Charts, Reports, Preferences) |
| Alt+G / Alt+Shift+G | Apply to group / Resync |
| Delete | Delete the selected gate |
| Page Down / Page Up, or arrows in the list | Next / previous sample |
| Sun/moon button (top right) | Dark mode |

## Mac

On a Mac, shortcuts use ⌘ (Command) instead of Ctrl and ⌥ (Option) instead of Alt: ⌘S saves, ⌘Z undoes, ⌥G applies to the group, ⌥3 and ⌥4 switch mode. The **⌫** key (called "delete" on a Mac) does what **Delete** does on Windows. Page Up / Page Down are Fn+↑ / Fn+↓. A pinch on the trackpad zooms the thumbnails; right-click is Control+click or a two-finger click. The program has the usual macOS menu (About, Hide, Quit, copy and paste), and opening a `.fcs` or `.ffwb` from the Finder opens it in Freeflow.

**Build it yourself on a Mac** (macOS 11 or newer, Node.js 24):

```
npm ci
npm run dist:mac
```

The `.dmg` and `.zip` files for Apple silicon and Intel appear in `release/`. Without a Mac, the GitHub Actions workflow *Build Freeflow* builds both the Mac and the Windows programs on GitHub's machines (*Actions > Build Freeflow > Run workflow*; download the result from *Artifacts*). The build uses an "ad hoc" signature (`identity: "-"`); without it, Macs with Apple silicon say the app is "damaged" even when the build succeeded.

## Security and privacy

Freeflow works only on your computer and **does not use the network** (checked in the code and with the program open: no external connection). Details, and how to repeat the check, are in [SECURITY.md](SECURITY.md).

## Limits

- Tested with files from a **CytoFLEX** (FCS 3.0) and with synthetic data of up to 2 million events (loading and plotting 1.5 million events takes about 5 seconds).
- Compensation was checked with known matrices and with identity matrices; it has **not been compared with another program** using a real matrix.
- **Not available yet:** FlowSOM and other clustering algorithms besides k-means, using the UMAP/t-SNE map as axes to draw gates, virtual concatenation inside the normal plots (it exists only in the Cluster Explorer), booleans with more than one level of parents, and a Mac version tested on real machines.
- It does not read files from other programs (for example `.wsp`).
