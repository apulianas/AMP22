# AMP22

<p align="center">
  <img src="src/renderer/assets/icon.png" width="220" height="220" alt="AMP22: orange AMP signature and purple 22 over a charcoal football field" />
</p>
<p align="center">
  <strong>Synced All-22 film study and football analysis for macOS and Windows.</strong><br />
  <a href="https://github.com/apulianas/AMP22/releases/latest">Download the latest release</a>
</p>

AMP22 is a desktop app for macOS and Windows for studying NFL All-22 (A22) film. It plays the sideline and end zone angles of each play side by side, kept in sync. You can jump to any play from the nflverse (nflfastR) play-by-play and step through the film frame by frame.

Switch between **Film Room** and **Analysis Lab** in the toolbar. Analysis Lab works without film: compare personnel efficiency over a game or team week range, inspect contributing plays, and export show-ready graphics and summary CSVs. The app remembers your workspace; Analysis Lab never opens or analyzes saved film automatically.

**Study the players, not just the play result.** Capture a whole game's on-field participation and available NFL Pro/Next Gen Stats charting with the optional browser extension, then let AMP22 import the CSV automatically while you study. Find plays featuring combinations of players with live matching-play counts, team-grouped filters, and ordered on-field rosters. Supplement missing charting without overwriting FTN, retain source disagreements for review, and export participation alongside box counts, pass rushers, EPA, and other available play data for analysis in Excel—even without loading film.

[Install the optional NFL Pro extension for Chrome, Edge, or macOS Safari](#optional-nfl-pro-browser-extension). An NFL Pro subscription and permission to collect its data are required for capture; the desktop app and its other data sources work without the extension.

## Screenshots

### Synced sideline and end zone

Browse color-coded plays and drive summaries while watching both angles together. The glossy toolbar wordmark blends into the UI without a black badge. Frame stepping, playback speed, and sync-offset controls sit below the film, with the selected play's result and charting tags. **Film setup** stays in the viewer's lower-right corner for changing files without a separate film-selection bar. This running-app capture uses the supplied 2026 Jaguars at Ravens single-file All-22, real play-by-play, and imported NFL Pro participation. Analysis at a `0.03` cut threshold recovered 148 film pairs; the selected first-quarter play shows both actual angles at Baltimore's 21-yard line.

![AMP22 showing actual Jaguars at Ravens All-22 at Q1 02:56, both angles at Baltimore's 21-yard line, complete NFL Pro participation, and 148 log entries linked to 148 film pairs](docs/screenshots/synced-viewer.png)

### Choose film in the viewer

Select **Single file** and click **Choose film…** directly in the empty video area. The setup panel also shows film analysis and its progress, then gets out of the way when the analyzed film is ready. This running-app capture uses real 2026 Bengals at Ravens play-by-play before assigning film.

![AMP22 with its film-format selector and Choose film button centered in the empty viewer, without a separate film-selection bar](docs/screenshots/film-selection.png)

### Split offense, defense, and special teams

Choose **Split offense / defense / ST** in the viewer's setup panel to assign three files. Offense and defense refer to the team selected above; each file contains both camera angles and aligns independently. This is the running app with real Bengals at Ravens play-by-play, before film selection—not a playback or alignment demonstration.

![AMP22 viewer-hosted split-film setup with separate Ravens offense, Ravens defense, and special-teams file pickers](docs/screenshots/split-film-setup.png)

### Filters and charting

Combine offense, play type, result, and air-yards filters with the available quarterback alignment, motion, play-action, box-count, pass-rush charting, and **On-field players** filter. **Add player** lists only players appearing in plays that match the other active filters: Jacksonville offense, for example, offers actual Jaguars offensive participants and Ravens defenders in that subset, not the whole game roster. Each option shows **(N plays)**: how many plays would match if you added that player alongside everyone already selected. Counts update immediately when players or other filters change, and count each play once. Players with zero matching plays are hidden from the dropdown; removing a selected player restores any newly compatible options without clearing the remaining tags.

The dropdown groups the **team being analyzed first**, followed by the opponent, even when the offense filter selects the other team. Names are alphabetical within each team by default; **Settings → On-field player dropdown order** also offers matching-play and position ordering.

Select players to add name tags; the play must include **all selected players together** on either side. Each tag's **×** removes just that player; removing the last tag clears the player filter. Selected tags remain visible and removable if other filters exclude their plays, rather than silently clearing a selection. This sidebar capture from the running app uses actual 2026 Jaguars at Ravens play-by-play, filtered to **Opponent** (Jacksonville) with Kyle Hamilton and Brian Thomas Jr. together: **14 matching plays**. The saved **Hamilton + Thomas** preset is marked **BAL players** because Baltimore is the analyzed team. The persistent NFL Pro indicator confirms all 148 plays imported with complete player lists, using a subscriber's captured CSV.

<img src="docs/screenshots/filters-and-charting.png" width="380" alt="Running AMP22 sidebar with Hamilton + Thomas saved as a BAL player preset, Opponent offense, removable player tags, 14 matching plays, and 148 complete NFL Pro imports" />

An updated, genuine NFL Pro capture of the same game supplies the additional charting controls below. **NGS pressure → Yes** matches **14 plays**; all 148 plays have complete player lists, and **109 plays have usable NGS charting**. This running-app screenshot uses the subscriber's schema v2 CSV, not generated charting. The capture also tags one quarterback kneel, which AMP22 excludes under its existing run/pass charting rules. Film is not loaded.

<img src="docs/screenshots/nflpro-charting.png" width="380" alt="Running AMP22 sidebar with genuine NFL Pro alignment, motion, play-action and separate NGS filters, pressure set to Yes, 14 matching plays, and 109 charted plays among 148 complete imports" />

Sources can genuinely disagree. A second subscriber capture, 2026 Week 4 Titans at Ravens, matches all **159 plays** with complete player lists and overlaps existing FTN charting. It has **29 plays with disagreements**: 23 motion, five play-action, and four alignment differences, with some on the same play. AMP22 retains every existing FTN value, adds the separate NGS fields, and exposes the alternatives in play details and both data-export layouts. This actual running-app capture shows Q1 4:38: **FTN Shotgun retained; NFL Pro Pistol**. The comparison does not establish which provider is correct; no disagreement has been automatically reconciled or fabricated, and film is not loaded.

<img src="docs/screenshots/nflpro-source-disagreement.png" width="1000" alt="Actual Titans at Ravens play details with FTN Shotgun retained, separate NGS flags and categories, and a highlighted disagreement showing NFL Pro Pistol" />

### Reusable filter presets

At the top of **More filters**, name the current filter set and click **Save current**, then choose it from **Filter preset** in another game. Presets save search, play type, offense, quarter, result, numeric bounds, and advanced selections locally across app restarts. Offense is relative: **Analyzed team** follows the team chosen above, and **Opponent** follows that game's opponent. Applying a preset replaces the current filters; editing them does not change the saved snapshot. Use a new name to save a variation, or **Delete** to remove the selected preset without changing current filters.

Specific players bind a preset to the analyzed team, even when some selected players belong to the opponent. For a different analyzed team, AMP22 offers **Apply without players** or **Cancel** before changing filters. Missing player/personnel data prompts guidance to capture and import the game's NFL Pro CSV (subscription required); historical participation can also satisfy those filters. Updated captures can supplement alignment, motion, and play action, and add separate NGS filters; unavailable FTN-only fields and coverage remain missing. Unavailable preset choices remain visible and applied rather than silently broadening results, and can match after imports refresh. Plays without the required data do not match.

This running-app capture uses the real Jaguars at Ravens game and **Third-down passes**, an analyzed-team preset with nine matching Baltimore plays. Film is not loaded. Choose a preset again after loading another game; preset-derived current filters reset on game load so its team and data checks run afresh.

<img src="docs/screenshots/filter-presets.png" width="380" alt="Running AMP22 with the saved Third-down passes preset at the top of More filters, Analyzed team offense, Pass and 3rd down selected, and nine of 148 actual game plays shown without film" />

### Ordered players on the field

Expand **Players on the field** below the viewer. Offense is ordered **WR, RB, FB, TE, eligible extra OL, QB, LT, LG, C, RG, RT**; defense is ordered **DE, DT, OLB, ILB, CB, safeties**. NT groups with DT and MLB with ILB, without changing their listed labels. Players within a group are ordered by jersey number. Generic or unusual listed positions remain visible rather than being guessed.

For generic offensive T/G/OL positions, AMP22 uses published nflverse depth charts to infer compatible left/right roles by **team and GSIS ID**. An asterisk, such as **LT***, marks a depth-chart estimate—not confirmed alignment on that snap. Hover over the position for its source, snapshot date, and original listed position. Modern charts use the latest snapshot on or before the game's date; older charts use the exact season, week, and game type. Equally ranked left/right assignments remain generic. Explicit source LT/LG/C/RG/RT positions are never replaced. Charts are downloaded automatically when needed, cached for offline use, and failures produce a data warning while retaining listed positions.

An eligible extra lineman appears as **OL-E** between TE and QB only when the play description explicitly reports that offensive lineman eligible, uniquely matched by jersey number, and the on-field list contains at least six linemen. A depth chart or an extra lineman alone does not establish eligibility. This running-app capture uses the actual Jaguars–Ravens Q1 10:31 play: Carson Vinson is explicitly reported eligible, while the other linemen's asterisks distinguish chart-derived sides.

<img src="docs/screenshots/on-field-personnel.png" width="1000" alt="Actual Jaguars at Ravens on-field lists ordered by position, Carson Vinson shown as an explicitly eligible extra lineman between TE and QB, inferred left/right offensive-line roles marked with asterisks, and an inference legend" />

### CSV analysis without film

**Export data** saves filtered, selected, or all game plays, with all available statistics and participation. Choose one row per play or one row per player per play. This is the actual export dialog in the running app with real 2024 Bills at Ravens data; an independent player-row CSV was exported successfully without loading film. It does not demonstrate live NFL Pro collection.

<img src="docs/screenshots/analysis-csv-export.png" width="820" alt="Running AMP22 analysis CSV dialog with play scope, play or player row layout, and Save CSV controls" />

### Analysis Lab

Introduced in **0.6.0**, Analysis Lab compares defensive packages with run/pass efficiency, EPA, success, explosives, and conversion rates. Packages are ordered by their combined snap counts, with run and pass rows adjacent (run first). Base packages use the short names **3-4** and **4-3**, without redundant personnel counts; other broad package labels retain their composition details. Switch to a personnel matchup heatmap or half comparison, then click a graphic or table row to inspect the actual plays. This running-app capture uses real 2024 Bills at Ravens play-by-play, historical participation, and FTN charting: **57 Baltimore defensive scored snaps**, with all 57 having known personnel and EPA. **Big nickel*** is a listed-position composition estimate, not verified defensive alignment. No game film was loaded.

![Running AMP22 Analysis Lab with actual Bills at Ravens personnel efficiency, data-coverage counts, and SVG, PNG and summary CSV export controls](docs/screenshots/analysis-lab.png)

Run/pass results use bold green **RUN** and blue **PASS** badges, matching the charts, with subtle row tints and colored edges. Scramble and sack inclusion remains explicit. This detail of the same Bills–Ravens results table shows the adjacent comparisons.

![Actual Bills at Ravens results table with green RUN and blue PASS badges, row tints, and adjacent package comparisons](docs/screenshots/analysis-lab-table.png)

The matchup heatmap compares defensive packages against offensive personnel for the same 57-snap cohort. Each populated cell shows yards per play and its sample size; click it to inspect the contributing plays. Empty cells are unavailable, not zero.

![Actual Bills at Ravens personnel matchup heatmap with yards per play, sample sizes, missing combinations, and source notes](docs/screenshots/analysis-lab-heatmap.png)

### Multi-play clip export

Export selected plays as sideline, end zone, stacked portrait, or all sideline followed by all end zone (and the reverse) in one video. Trim clip starts with per-play first-frame previews, set an overlay duration, or choose a clean export. Choose a team theme, customize its colors and background opacity, and save named themes or a new default. Position the overlay with corner presets, drag it on the export preview, and save named locations. Share also offers a CSV, plain-text, or team-colored PDF play breakdown, with optional advanced statistics. This running-app capture shows the theme and position controls with a top-right Ravens card. It uses a simulated field and illustrative play because game film was unavailable; it does not demonstrate real game alignment or a completed export.

<img src="docs/screenshots/clip-export.png" width="560" alt="Running AMP22 Share dialog with automatic Ravens theme, editable background and accent colors, 90 percent background opacity, named-theme saving, and position controls over a simulated field" />

### Overlay theme examples

These examples use AMP22's actual overlay renderer with a simulated field and illustrative play, not game film. Ravens, Chiefs, Eagles, and Bengals presets use dark team-colored panels with contrasting text. The custom light theme and 40%-opacity Ravens example demonstrate editable colors and transparency; text remains opaque and outlined.

<img src="docs/screenshots/overlay-themes.png" width="1000" alt="Six AMP22 overlay examples on simulated turf: Ravens, Chiefs, Eagles, Bengals, a custom ice-and-orange theme, and Ravens at 40 percent background opacity" />

### PDF play breakdown

PDF writeups include available player headshots alongside each play, including when the accompanying video uses **Clean export** or zero overlay duration. This is the first page of an actual two-play PDF exported from the running app with the supplied Bengals at Ravens film, showing Derrick Henry's headshot and real play-by-play and charting.

<img src="docs/screenshots/pdf-play-breakdown.png" width="640" alt="First page of an actual AMP22 PDF export, with a Derrick Henry headshot, one-yard rushing writeup, team colors, and available advanced statistics" />

### Settings and shortcuts

**On-field player dropdown order** offers **Alphabetical** (default), **Most matching plays first**, or **Position, then most matching plays** within each team group. Play counts sort highest first and update with active filters and selected players; ties are alphabetical. Position sorting follows the offensive and defensive position sequences described above, with specialists and unknown positions last. Compatible depth-chart estimates appear with an asterisk; a player's reported-eligible snap does not turn eligibility into their overall dropdown position. Saving applies the order immediately and preserves it across restarts without changing selections or reanalyzing film. This crop from the running app shows the default alphabetical preference.

<img src="docs/screenshots/player-filter-order.png" width="800" alt="Running AMP22 Settings with Alphabetical selected for On-field player dropdown order and help explaining analyzed-team-first grouping and live matching-play counts" />

Customize playback, clip-start trimming, overlay duration, and play-breakdown defaults, including the report format, whether advanced statistics are enabled, and exactly which fields to include. This running-app crop focuses on report defaults, including player IDs, names, positions, jersey numbers, and participation provenance. The participation import folder is configured above this section; key-play definitions and keyboard shortcuts remain below it.

<img src="docs/screenshots/settings.png" width="800" alt="Running AMP22 Settings report defaults with selectable charting, original player positions, separate inferred positions, depth-chart sources and dates, and reported eligible player IDs" />

### Update notifications

See the latest published release notes before opening the download page. This is the running app checking a real GitHub release; installation remains manual.

<img src="docs/screenshots/update-notification.png" width="800" alt="AMP22 update prompt showing the installed and available versions, published release notes, Later, and Open download page" />

## Features

- **Analysis Lab.** A film-independent workspace for one game or a completed-game week range for the selected team and season. Choose offense or defense; group by defensive package, offensive personnel, personnel matchup, half, pass-rusher count, or exact defensive lineup. Split by run/pass, half, offensive personnel, motion, or play action. Tables show snaps, cohort usage, yards, YPP, offensive EPA/play, offensive success rate, explosive rate, and third/fourth-down conversion rate with each metric's sample size. Efficiency bars, a defensive-package/offensive-personnel heatmap, and half comparisons export as PNG/SVG; Summary CSV includes every group and definitions. Click bars, cells, or table rows for play evidence and a full-field play CSV. Custom eleven-player package rules distinguish big nickel, standard nickel, standard dime, and rush dime when listed positions support them; ambiguous or partial lists retain broad supplied packages or Unknown. Rules and the workspace preference are saved locally.
- **Two synced angles.** Each A22 file contains sideline followed by end zone for each play. The app finds the cuts, pairs the angles, and plays them together on one clock. Use **Single file** for continuous full-game film, or **Split offense / defense / ST** for separate offense, defense, and special-teams files. In split mode, offense means the selected team's offense and defense means that team defending; the special-teams file covers kicks and returns by either team. Each file aligns independently, and selecting a play switches both viewers to the appropriate source. You can load only the files you have; the other plays remain unlinked. File choices and corrections are remembered per game and team perspective, separately from single-file film. The layout switches between side-by-side and stacked depending on the window shape.
- **Multi-monitor viewing.** After film analysis, click **Pop out** on either angle to open it in a separate window. Drag that window to another display and maximize it or click **Fullscreen**. The remaining angle fills the main viewer. Playback, seeking, frame stepping, speed changes, sync offsets, and play navigation still use the same controls and clock; keyboard shortcuts also work in the pop-out. Click **Return angle** in either window, or close the pop-out, to restore the two-angle layout. One angle can be detached at a time.
- **Play-by-play navigation.** Pick the season, team, and week from the drop-downs. The default is the current season, the Ravens, and the most recently completed week. Plays come from [nflverse](https://github.com/nflverse/nflverse-data) and are color-coded:
  - **Run** is green, **pass** is blue, **special teams** is purple, and **no play** (penalty) is gray.
  - **Key plays** get a gold edge and badges: INT, FUM, TOD (turnover on downs), TD, FG, SAF, 2PT, BIG (run ≥ 10 or pass ≥ 20 yards), 4TH (4th-down conversion), and optionally SACK.
  - **Negative plays** get a red edge and a SACK or LOSS badge. These are sacks, plus runs and completions that lose 3 or more yards.
  - You can change the key-play and negative-play definitions in Settings.
  - Plays are grouped by drive. Each drive has a header showing the team, number of plays, yards, time of possession, and result.
  - Each play shows a box-score line first, for example `T.Huntley → Z.Flowers +48 TD`, with the full play description below it in smaller text.
  - The list can be searched and filtered by play type (run, pass, special teams), offense, quarter, and result. Result filters: key, negative, sacks, turnovers, scores, big plays, first downs, penalties. The quarter list includes OT only when the game went to overtime.
  - Expand **More filters** below the offense/quarter/result controls to enter an inclusive minimum (`Air yards ≥`) and/or maximum (`Air yards ≤`). Leave either field blank for no limit; zero and negative bounds are supported. These filters combine with the other controls, and plays stay in game order with drive headers. Collapsing the section keeps its filters applied and shows an active indicator; clear both fields to remove the air-yards filter. Plays without air yards (such as sacks and runs) are excluded only while a bound is set, not treated as zero.
  - Air yards measure pass depth from the line of scrimmage, excluding yards after catch; throws behind the line have negative values. Available values appear beside the play result, including on incomplete and intercepted passes. Historical coverage varies. Previously downloaded play-by-play is reprocessed automatically to include air yards.
  - **More filters** also has inclusive **Yards gained** bounds (runs and passes only; kickoffs, punts, and no-plays are excluded while a bound is set) and **Yards to go** bounds, plus a **Down** selector. The indicator shows how many of these filters are active.
  - **Saved filter presets.** **More filters → Filter preset** applies a named snapshot of all current filters, including the search and controls above the advanced section. Enter a new preset name and click **Save current** to keep one across games and app restarts. **Analyzed team** and **Opponent** offense selections adapt to each matchup. Presets containing player selections are marked with the analyzed team's abbreviation; another team requires **Apply without players** or **Cancel**. Missing participation produces NFL Pro import guidance, while unavailable preset choices remain applied and removable. Choose a preset again after loading a game. **Delete** removes the saved preset, not current filters.
  - **Personnel and charting.** When nflverse or an imported NFL Pro capture has advanced data for the game, more filters appear under **More filters**. Filters with data for the loaded game are shown, along with any unavailable choices retained from an applied preset, and all apply to runs and passes only:
    - From [FTN charting](https://github.com/nflverse/nflverse-data/releases/tag/ftn_charting) (2022 onward, updated during the season): QB alignment (shotgun, under center, pistol), backfield count, box count, motion, play action, RPO, screen, no-huddle, and, on dropbacks, pass rushers and blitzers.
    - From [participation data](https://github.com/nflverse/nflverse-data/releases/tag/pbp_participation) (2016 onward, published after each season ends, so not available for the current season): offensive personnel (RB count then TE count, e.g. `11`, `12`, `21`), defensive package, formation (before 2023), coverage (Cover 0/1/2/3/4/6/9, 2-Man…), and man/zone.
    - From an updated **NFL Pro CSV capture**: QB alignment (including pistol), motion, and play action fill missing existing values. Separate **NGS blitz**, **NGS pressure**, **NGS box**, and **NGS personnel** filters retain NFL Pro's boolean flags and categorical groupings rather than inventing exact counts or defensive fronts. Missing filter membership remains unknown, not **No**. These fields are applied only to scrimmage plays.
    - **Source priority and disagreements.** FTN stays authoritative where present, followed by existing historical participation data; NFL Pro fills remaining gaps. Every effective charting field has source metadata. Comparable values that differ produce a persistent data warning and a highlighted play-detail tag showing the retained value and the NFL Pro alternative. Both sources and capture provenance are retained in **Export data** and selectable advanced report fields. Disagreement can reflect different charting definitions, not necessarily an incorrect source. NGS box categories and blitz flags intentionally remain separate from FTN box/rusher/blitzer counts; NGS Base/Nickel/Dime remains separate from a charted or position-inferred defensive package.
    - Defensive packages are derived from the number of defensive backs: four DBs are labelled by their front (`4-3`, `3-4`), five are **Nickel**, six **Dime**, seven or more **Quarter**, and three or fewer **Goal line**. Each label also shows the DL-LB-DB count (for example `Nickel 2-4-5`).
    - Play rows show personnel as `12 v Nickel`. The play details below the video list every personnel and charting tag, and **Players on the field** lists both sides' players in position order (jersey numbers from 2023 onward). Compatible depth-chart left/right offensive-line estimates are marked with an asterisk, with source/date tooltips; ambiguous positions remain generic. Explicitly reported eligible extra linemen appear between TE and QB. Search also matches these tags, for example `nickel` or `play action`.
    - Each season's files (about 10–50 MB) are downloaded once and cached for offline use.
  - **Local NFL Pro participation imports (experimental).** The optional WebExtension's **Capture game & save CSV** button fetches the game's unfiltered NFL Pro playlist and participation for every returned play, then automatically requests the CSV download. No manual play navigation or separate export click is required. AMP22 checks `nflpro-*.csv` in your Downloads folder by default, imports matching plays when loading a game, and watches for new files while running. A persistent sidebar indicator shows imported-play counts across the entire open game, complete/partial counts, and the last automatic update or check; filtering does not change these counts. Updates preserve the current play, selections, and loaded film. No manual refresh is required. Choose another folder or disable imports in **Settings → Participation CSV folder**. It verifies game metadata and play situations, never joins by list order, and reports invalid files, ambiguous matches, and unavailable folder watching in the indicator. Historical participation and FTN charting remain available; partial imports do not displace complete historical sides, and more complete captures are preferred over partial ones. Imported participation is labelled complete or partial per play; this is not a whole-game coverage claim.
  - **Player filtering and inferred personnel.** **More filters → On-field players** supports multiple players as removable name tags. Only plays with all selected player IDs on the field together match, across either side—not just the passer, receiver, or players mentioned in the description. Choose **Add player…** to add another, or use a tag's **×** to remove that player. Options follow all other active filters, using actual snap participation rather than a roster's listed offensive/defensive positions. Each option's **(N plays)** count predicts the combined result of adding that player; counts and available options update when selected players or other filters change. Candidates with zero matching plays are hidden and reappear when compatible again. An empty subset disables the picker with an explicit message; existing tags stay removable and are not silently cleared. Removing all tags restores unrestricted player matching. Player selections survive participation refreshes while those players remain available in the game, and filtered CSV exports use the same combined filter. Search also matches on-field names, positions, and jersey numbers. Complete eleven-player sides with known positions can supply missing offensive personnel or defensive package labels. An asterisk and detail tag identify inferred values; listed positions do not establish actual alignment. Supplied personnel is not overwritten, and inferred values are exported separately.
- **Independent analysis CSV.** **Export data** works without film and exports filtered, selected, or all plays in game order. Every available advanced field is included, regardless of Share's report preferences. **One row per play** includes parallel semicolon-separated player lists; **One row per player per play** includes individual player identity, team, side, original position, and jersey number alongside repeated play statistics. Depth-chart position estimates, their sources and snapshot dates, and explicitly reported eligibility are separate fields; original positions are never overwritten. An empty **Reported eligible** field means not identified, not confirmed ineligible. Both layouts include nflverse game/play IDs and available participation provenance and inference fields. Plays without participation retain a blank-player row. Missing statistics stay blank, while zero and **No** remain distinct.
- **Frame-accurate controls.** Step 1 frame or N frames at a time (N defaults to 10 and is configurable). You can also move to the next or previous play, restart the play, and change to slow-motion speeds. At the end of a play the app can stop, auto-advance, or loop.
- **Clip export.** Click a play and then **Share** to export its sideline angle, end zone angle, or both. Shift-click another play to select the visible plays in between, or turn on **Multi-select** to choose individual plays. Checkboxes are hidden during normal single-play browsing. Selected plays are joined into one MP4 in game order, even when selected out of order. Both angles are stacked in a 1080×1920 (9:16) portrait video; the original layout places the play's clock, down/distance, box-score result, badges, and description below, without camera-angle labels over the footage. Single-angle exports are 1920×1080 with a compact result card. Choose a corner preset or drag the card on the export preview, save named locations, and make any location your default. Custom and corner positions use a compact card over centered footage in portrait output. **All sideline, then all end zone** and **All end zone, then all sideline** produce one 1920×1080 MP4, with all selected plays in game order within each angle block. Trim starts independently per play using decimal seconds and preview the first retained frame of the selected angle or angles. Overlay duration is configurable for every layout, measured from each trimmed clip start. Settings remembers the user's trim and overlay defaults locally. Exports use normal speed and saved sync offsets, with audio from the selected angle (sideline for stacked portrait). Playback and original film are never modified.
- **Ordered play breakdowns.** Share can save a **CSV spreadsheet**, **plain text**, or **PDF** alongside the video, with one entry per video clip in exactly the same order—including exports spanning split files. Grouped-angle exports repeat the selected plays for the second angle block. Reports identify the matchup and include each play's clip number, game play ID, quarter/clock, offense/defense, play type, down/distance, field position, yards, result, and description. PDFs use the selected team's colors, team-colored play cards, a run/pass/special-teams summary, and page numbers. **Include advanced statistics** adds the fields selected in Settings: air yards, personnel/packages, formation, QB alignment, backfield/box counts, motion, play action, RPO, screen, no-huddle, pass rushers/blitzers, coverage, and man/zone. Missing data stays blank in CSV and is marked **Not available** in text/PDF; zero and **No** remain distinct from missing values. The default is **CSV without advanced statistics**. Settings lets you customize the format, advanced-statistics default, and individual fields; Share lets you override the format and toggle advanced statistics for the current export or choose **No breakdown**.
- **Update notifications.** Installed macOS and Windows builds check GitHub for a newer stable release at startup. The prompt shows your version, the latest version, and its published changelog. **Open download page** opens that release in your browser; choose the macOS DMG or Windows installer and install it manually. **Later** suppresses startup prompts for that version, but the **Update available** button stays accessible and newer versions can notify again. If playback, export, or another dialog is active, the button appears without interrupting your work. **Settings → Check for updates…** always lets you check again, including in development builds. Network failures are shown in Settings and can be retried.

## Getting started

For packaged releases, choose the **arm64 DMG** for Apple Silicon Macs (M-series), the **x64 DMG** for Intel Macs, or the **Windows installer**. Each installer includes the video-processing tools it needs. Apple Silicon Macs currently need Rosetta 2 for the bundled Intel FFprobe helper; the app and FFmpeg are native arm64. Intel builds run both helpers natively.

### macOS installation and Gatekeeper

AMP22 is **not Apple Developer ID signed or notarized**. New builds use free **ad-hoc signing** to give the complete app a valid local signature, including its Electron helpers and video tools. This does **not** identify a trusted developer or make Gatekeeper trust the download. A free Apple developer account cannot provide Developer ID distribution signing; that requires paid Apple Developer Program enrollment. Ad-hoc signing applies to installers built with this configuration; adding instructions to older release descriptions does not change their binaries.

1. Download the correct DMG from the [official AMP22 GitHub release](https://github.com/apulianas/AMP22/releases/latest), open it, and drag **AMP22** into **Applications**.
2. Eject the disk image, then open AMP22 from Applications.
3. If macOS blocks the app, **only if you trust this official AMP22 release**, open **Terminal** (Applications → Utilities, or search for Terminal with Spotlight). Paste this exact command and press Return:

```sh
xattr -dr com.apple.quarantine /Applications/AMP22.app
```

Open AMP22 from Applications again. The command removes downloaded-app quarantine recursively from **AMP22 only**, allowing it to bypass that Gatekeeper check. It does **not** notarize the app, repair an invalid signature, or make the app Apple-trusted. Do not disable Gatekeeper globally or run this for an untrusted download. If Terminal reports an error, confirm the app is named **AMP22.app** and is installed in **Applications**; do not blindly add `sudo`.

### Running from source

Requirements: Node.js 20 or later.

```sh
npm install
npm start
```

npm 11 blocks install scripts unless they are approved. The `allowScripts` entry in `package.json` approves the scripts for `electron`, `ffmpeg-static`, and `ffprobe-static`. If the Electron binary is missing, run `node node_modules/electron/install.js`.

### Using it

For statistics and graphics without video, select **Analysis Lab** and follow [Using Analysis Lab](#using-analysis-lab). The following workflow describes **Film Room**.

1. Choose the season, team, and week. The schedule and play-by-play are downloaded and cached, so games you've opened before also work offline.
2. In the empty video area, leave **Single file** selected and click **Choose film…** for full-game A22. For separate units, select **Split offense / defense / ST**, then use **Choose [team] offense…**, **Choose [team] defense…**, and **Choose special teams…** in the same panel. Each file must contain both angles, not one camera per file. Select the team whose offense/defense the files describe before assigning them. The app streams files from where they are and never copies or changes them. After loading analyzed film, use **Film setup** in the viewer's lower-right corner to change files or formats; close the panel to return to the footage. Selecting a play whose split-film source is missing reopens setup so you can assign it.
   In single-file mode, you can also set a **film folder** in Settings (⚙), for example `~/Movies/2026 Ravens Games`. The app then finds the A22 file automatically by matching week folders such as `w7vBengals` or `w1@Colts` and preferring files with `a22` in the name. Split files are assigned explicitly, not guessed from filenames.
   The app remembers the format and file choices. Switching formats preserves both sets of choices and their corrections.
3. The first time you open film, the app analyzes each selected file. Time depends on the recording and machine; a complete single-file game must finish before automatic play links are available. You can see progress for each unit in split mode. Results are cached by file path, size, and modified time.
4. Click a play, or use ↓/↑, to watch it.
5. To save a clip, click **Share**, choose an angle, and click **Export…** to pick an MP4 destination. Single-play filenames use `TEAM-POSSESSION-PLAY NUMBER-DOWN-DISTANCE.mp4` (for example `BAL-O-12-2-7.mp4`). Team is the selected analysis team; possession is `O` (offense), `D` (defense), or `ST` (special teams) relative to that team. The play number is its one-based position in the game's play list, unaffected by filtering or film links, not the data provider's play ID. Unavailable possession, down, or distance uses `NA`. Multiple plays still use only the game-clock range (`Q2-08m34s-to-Q3-04m12s.mp4`). Single-angle results use a compact card sized to its text rather than a full-width banner, positioned in the lower left by default. Shift-click to select a range, or use **Multi-select** and checkboxes for individual plays. Selected plays remain selected when filtering; the selection count includes hidden plays. A normal row click outside explicit multi-select mode, or navigating to another play, returns to a single selection and hides the checkboxes. Turn **Multi-select** off to return to a single selection. Plays without linked film must be deselected or linked before export. Export progress and cancellation are available in the Share dialog. After export, **Show in Finder** (macOS) or **Show in File Explorer** (Windows) opens the containing folder with the exported file selected.

**Multi-select** sits beside the color legend below the filters. The selection count and **Clear selection** appear only while multi-select is active or more than one play is selected, leaving more room for the play list during normal browsing.

Under **Trim clip starts**, select each play to inspect the first retained frame of the selected export angle. Portrait and grouped-angle exports show both angle previews. **Remove from this play (seconds)** accepts decimals such as `1.25` and applies the same trim to both synced angles. Every selected play starts with **Settings → Clip export defaults → Trim from each clip start**, initially `0`. Per-play overrides apply only to the current Share dialog; reopening Share starts from the remembered default. A trim that would remove an entire clip blocks export and identifies the play to adjust. This is fixed-time trimming, not automatic snap detection.

**Overlay duration** also accepts decimals and applies from the trimmed start of every clip, including each angle block in grouped exports. Set its remembered default in **Settings → Clip export defaults** (initially `3` seconds), or override it in Share for the current export. A value of `0` hides the overlay; a duration longer than the clip shows it throughout. With **Original layout**, portrait exports keep the reserved lower panel after its play details disappear; use a corner/custom location or **Clean export** to center the footage instead.

Under **Overlay position**, choose **Top left**, **Top right**, **Bottom left**, or **Bottom right**, or drag the card directly on the first-retained-frame export preview. The **Horizontal position (%)** and **Vertical position (%)** sliders also allow precise, keyboard-accessible positioning. The whole card stays within the output frame. Corner and custom positions use a compact result card in every layout; portrait footage is centered rather than reserving the original description panel. Grouped-angle previews show the first angle block, and the chosen location applies to both blocks and every selected play. The preview includes available headshots and respects clean exports and zero overlay duration; the separate trim previews remain overlay-free.

Under **Overlay theme**, **Automatic** defaults to the team selected for analysis, not the team possessing the ball on each play. Presets cover every NFL team, including the historical Oakland, San Diego, and St. Louis names. Choose any team or saved theme, then tweak **Background** and **Accent** to create a custom version. Text automatically switches between black and white for contrast and has an opposite-color outline; panels also have a contrasting border to separate them from green turf. **Background opacity** ranges from `0%` (transparent panel) to `100%` (opaque), initially `90%`. Text, accent stripes, borders, and headshots stay opaque; very low opacity reduces panel contrast. Preview and exported video use the same colors and opacity in every layout, including the original portrait information panel. The portrait layout's reserved backdrop remains after the overlay disappears.

Enter a theme name and click **Save / replace theme** to keep its colors locally; the same name replaces an existing saved theme without changing the built-in preset. **Make theme / opacity default** remembers the current colors and opacity for future Share dialogs and app restarts. To restore team-following behavior, select **Automatic** and make it the default. Saving a named theme alone does not change defaults or save opacity with that name. **Delete saved theme** leaves current colors and defaults unchanged. Theme and opacity controls are disabled for clean exports, and video themes do not change PDF report colors.

Enter a name and click **Save / replace location** to keep a location in the Location menu; saving the same name replaces that location. Choose **Make default** to use the current preset or custom position whenever Share opens, including after restarting AMP22. Saving a location alone does not change the default. **Delete saved location** removes the selected named preference without changing the current position or default. Positions are stored locally as relative coordinates, so they adapt to different card sizes and landscape/portrait output. **Original layout** restores the original lower-left landscape card or full portrait information panel and remains the default until you explicitly change it.

For grouped-angle output, choose **All sideline, then all end zone** or **All end zone, then all sideline** under **Camera angle**. For plays A, B, and C, the first option exports sideline A/B/C followed by end zone A/B/C, not alternating angles per play. Each segment uses its own angle's audio and the play's trim override, including selections spanning split files.

Under **Play breakdown**, choose **CSV spreadsheet**, **Plain text**, **PDF · team colors**, or **No breakdown**, and optionally enable **Include advanced statistics**. A video named `clips.mp4` gets a companion `clips-plays.csv`, `clips-plays.txt`, or `clips-plays.pdf` in the same folder. AMP22 asks before replacing an existing breakdown. If the video saves but the breakdown cannot be written, Share reports that partial failure explicitly and still lets you reveal the saved video. **Settings → Play breakdown defaults** controls the defaults and advanced-field selection; these settings do not change clean/overlay video behavior.

PDF play cards include available headshots using the same primary-player rules as video overlays. Photos are embedded in the PDF, so viewing the saved writeup requires no network connection. Headshots remain in the PDF even with **Clean export** or an overlay duration of `0`; CSV and plain-text breakdowns remain text-only.

Enable **Clean export (no overlays)** in the Share dialog to omit all added text, graphics, and play details for either single- or multi-play exports. Both-angle exports remain 9:16, with the stacked footage centered on a black background instead of reserving a bottom panel for play information. Overlays remain enabled by default.

Overlays and PDF writeups include a headshot matched by the play-by-play's GSIS player ID: the runner, the receiver on a completed pass, or the defender credited with an interception, lost-fumble recovery, or sack. Transparent padding is trimmed so the player fills the headshot area, with the original alpha channel preserved and no photo background or outline. Turnovers take priority over sacks and offensive players; shared sacks use the first credited defender. Nullified plays and incomplete passes do not show an offensive headshot. Headshots and the nflverse player directory are cached for offline use. If a photo cannot be found or downloaded, the export keeps its text overlay and PDF writeup and reports a headshot notice instead of guessing a player. Clean exports do not request headshots unless a PDF breakdown is selected.

Export overlays describe rushing and receiving yardage as `12 yard rush` or `48 yard reception`, without a plus sign; losses retain a minus sign (for example `-3 yard rush`). Touchdown rushes and receptions still include `TD`. The compact box-score wording in the play list is unchanged.

Player participation lists, source metadata, inferred personnel, depth-chart position estimates and their provenance, and reported eligible player IDs are also selectable under **Settings → Play breakdown defaults** for Share's CSV/text/PDF reports. These additions do not change the default of CSV without advanced statistics. **Export data** always includes supported advanced fields, including EPA, independently of those preferences.

### Using Analysis Lab

1. Select the season, team, and game in the toolbar, then click **Analysis Lab**. The **Defense** perspective starts with defensive packages split by run/pass. Switching workspaces unloads the current viewer; saved film assignments and corrections are retained.
2. Leave **Scope → Selected game**, or select **Team week range** and inclusive week bounds (1–22). Ranges include completed scheduled regular-season/postseason games in those weeks, not future games. Data loads sequentially without probing, opening, or analyzing video. **Reload data** refreshes the scoped play data. A failed or empty source game blocks the aggregate rather than displaying an unmarked partial result.
3. Use the existing sidebar filters and saved filter presets, including player combinations and available NFL Pro/NGS charting. Filter options, matching-player counts, and missing-data warnings use the selected analysis scope and perspective. Switching between Film Room and Analysis Lab retains current filters and the applied preset; loading a different game starts a fresh preset application. Existing advanced selections remain removable even when a new scope has no matches. The sidebar play list and NFL Pro import indicator still describe the toolbar's selected game; use **Play evidence** for the complete multi-game subset. Filters apply to every scoped game, so an offense filter for one opponent intentionally excludes other opponents.
4. Choose **Group by**, **Split by**, and a metric. Groups are ordered by combined snaps (most-used first, alphabetical ties), with their split rows kept together: run before pass, or first half before second half and overtime. Charts, tables, and Summary CSV use that same order. **Matchup heatmap** fixes the dimensions to defensive package by offensive personnel; **Half comparison** fixes the split to half while retaining your grouping. Graphic controls disable the dimension selectors they override. Tables and Summary CSV retain all groups; graphics are limited to 30 rows, or 12 packages by 8 offensive groupings, with an explicit truncation notice when needed.
5. Expand **Definitions, data coverage & package rules** to inspect sources, known-field coverage, and the default package definitions. Add a named package using DL/OLB/ILB/LB/CB/S/DB counts totaling 11, remove a rule, or restore defaults. Names and compositions must be unique. DL includes DE/DT/NT; ILB includes MLB; S includes FS/SS. Generic LB/DB values are not guessed into more specific positions. A complete, uniquely identified eleven-player defense must match a rule exactly. A `*` marks a composition/position estimate, never confirmed alignment; these rules do not change Film Room's package labels.
6. Click a chart bar, heatmap cell, or table row to open **Play evidence**. The first 200 plays are displayed; **Export these plays** includes the entire subset with available statistics and participation (up to 20,000 plays). Clicking an evidence play locates it in the selected-game sidebar without opening film. Use **Save SVG**, **Save PNG**, or **Summary CSV** for presentation graphics or aggregated data. Exports retain scope, active filters, sources, sample sizes, and definitions.

**Metric conventions:** scored snaps are runs and passes including sacks and scrambles, excluding no-play penalties, kneels, spikes, special teams, and two-point attempts. Run/pass follows official play type, so scrambles are runs and sacks are passes; passing yardage includes sack losses. YPP uses known yardage; EPA and offensive success rate use known EPA, with success defined as EPA greater than zero. Explosives are runs of 10+ or passes of 20+ yards. Third/fourth-down conversions use first-down/TD credit or yards reaching the sticks, among snaps with known distance and yardage. Usage is share of the entire filtered cohort, not within a split. Rates in Summary CSV are fractions (0–1).

Missing fields remain **Unknown** or **N/A**, not zero or No; every metric displays its denominator. Groups with fewer than ten snaps are flagged, but this is not a statistical significance test. All comparisons are descriptive, not causal player grades. NFL Pro supplies imported participation and available NGS charting; FTN values remain authoritative where present. Analysis coverage and exports count source-labelled charting and plays with source disagreements. NGS pressure/blitz flags and box/personnel categories are not converted into exact counts or individual responsibility. Missed tackles and Ken-specific ATS/BOQ labels are not inferred.

### Optional NFL Pro browser extension

<img src="extensions/nflpro/icon-128.png" width="48" alt="Flat AMP22 browser extension icon: orange signature and purple 22 on a dark rounded square" />

The extension uses a simplified AMP22 logo without field lines or glossy effects, with dedicated small-size PNGs for the Chrome, Edge, and Safari toolbar.

To regenerate these assets from the app's signature and extension's flat-icon template, run `npm run build:extension-icons`, then `npm run build:extension`. The checked-in PNGs are included in extension builds without requiring icon generation on the user's machine.

Collection requires NFL Pro access and permission to collect the data. The extension does not sign in for you, bypass access controls, fetch film, or upload data. It uses the signed-in page's own API client to request the unfiltered game playlist, explicitly filtered charting playlists, and each play's home/away participation summary, without changing the current video or filters. A subscriber's Chrome schema v2 capture of 2026 Jaguars at Ravens has been validated: all 148 plays match uniquely, all have complete 22-player lists, and the CSV contains charting for 110 plays. AMP22 applies charting to 109 eligible plays, excluding one quarterback kneel. The actual app's pressure filter matches 14 plays, and both analysis CSV layouts retain source metadata and explicit Yes/No/unknown values. This game's cached FTN table has no matching rows, so it verifies NFL Pro fallback rather than a live FTN disagreement; automated tests cover source priority and conflicts. Authenticated Edge and Safari capture/download have not yet been verified.

The NGS-filter screenshot above uses the genuine Jaguars v2 capture; the earlier player/preset screenshots use the original participation-only capture. A second genuine Chrome v2 capture, Week 4 Titans at Ravens, verifies coexistence with FTN: all 159 plays match uniquely, every pre-existing FTN value remains unchanged, and 29 plays have surfaced disagreements (23 motion, five play action, four alignment; some overlap). Its source-disagreement screenshot shows a real Shotgun/Pistol difference. Motion filtering follows retained FTN values, NGS pressure filtering matches 22 plays, and both export layouts retain the effective FTN values and NFL Pro alternatives. Matching and precedence are verified; these checks do not adjudicate which provider's differing charting is correct.

Extension **0.3.0** writes **schema v2**, adding verified game/play-level NGS filters: alignment, motion, play action, blitz and pressure flags, box categories, and defensive personnel groups. It uses the same Film Room filter parameters exposed by [NFL Pro](https://pro.nfl.com/film/plays), with explicit positive and negative queries; a play missing from both remains blank. It does not infer a **No** from absence in a positive playlist, interpret receiver motion as general motion, or treat a receiver's screen route as a play-level screen tag. RPO, screen, no-huddle, backfield counts, exact box/rusher/blitzer counts, and coverage are not captured by this adapter.

Update the desktop app along with the extension: the updated app accepts both original **schema v1** participation CSVs and **v2** captures; older app versions reject v2 rather than silently dropping charting. Existing v1 CSVs cannot supply the new fields—recapture the game after reloading the extension and NFL Pro tab.

#### Download the extension

Open the [latest AMP22 release](https://github.com/apulianas/AMP22/releases/latest) and download **AMP22-NFL-Pro-Extension.zip** from **Assets**, separately from the desktop app installer. Extract the ZIP for Chrome or Edge; the folder you load must directly contain `manifest.json` and `participation.js`. Safari's temporary loader also accepts the ZIP.

If you are building from source instead, run the following in the repository and use the generated `out/nflpro-extension` folder—not the source `extensions/nflpro` folder:

```sh
npm run build:extension
```

#### Install in Chrome (macOS or Windows)

1. Open `chrome://extensions` in the address bar.
2. Enable **Developer mode**, click **Load unpacked**, and select the extracted folder containing `manifest.json`.
3. Open Chrome's **Extensions** toolbar menu and pin **AMP22 NFL Pro Participation** for easy access.
4. Open your signed-in NFL Pro game and reload its page before capturing.

#### Install in Edge (macOS or Windows)

1. Open `edge://extensions` in the address bar.
2. Enable **Developer mode**, click **Load unpacked**, and select the extracted folder containing `manifest.json`.
3. Open Edge's **Extensions** menu and show **AMP22 NFL Pro Participation** in the toolbar.
4. Open your signed-in NFL Pro game and reload its page before capturing.

Chrome and Edge developer installs do not require a store account or signing. Keep the extracted folder in a stable location; removing it breaks the unpacked installation. After replacing the files with an updated release, click the extension's **Reload** control on the extensions page and reload the NFL Pro tab.

#### Install temporarily in Safari (current macOS)

1. Enable **Safari → Settings → Advanced → Show features for web developers**.
2. Open **Settings → Developer → Add Temporary Extension…** and select the downloaded ZIP or extracted extension folder.
3. Accept the unsigned-extension prompt, enable **AMP22 NFL Pro Participation**, and allow it on NFL Pro when prompted.
4. Open your signed-in NFL Pro game, reload its page, and use the extension's toolbar button.

**No paid Apple developer account or Xcode project is required for this temporary loading route.** Safari removes temporary extensions after 24 hours or when Safari quits; add the extension again when needed. This is not a persistent App Store installation or iOS support. If your Safari version lacks **Add Temporary Extension**, update Safari or use Chrome/Edge; older Safari requires an Xcode wrapper for local development. See [Apple's unsigned/temporary extension instructions](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension). Safari's download fallback is implemented, but its complete authenticated capture/download flow has not yet been live-verified.

#### Capture a game and automatically import it

1. In AMP22, open **Settings → Participation CSV folder → Choose…**, select your browser's download folder (or another folder where you will save the capture), and save Settings. Open the game you want to study.
2. In your browser, open that single game's page at `pro.nfl.com/film/plays` while signed in with NFL Pro access.
3. Click the extension's toolbar button, then **Capture game & save CSV** once. You do not need to visit each play or advance through the film.
4. Keep the NFL Pro tab open until capture finishes. Approve any download prompt and save `nflpro-<season>-<game-id>.csv` into the folder configured in AMP22, keeping the generated filename.
5. AMP22 imports the completed CSV automatically, even if the app was already open. For a matching game, the sidebar shows the imported play counts and an **Updated automatically** confirmation; no manual reload is needed.
6. Use **More filters → On-field players** to combine players, the available charting/NGS filters to narrow plays, or **Export data** to save play-row or player-row CSVs with source and disagreement metadata.

The extension requests the game's full, unfiltered playlist, verifies its returned count, queries 17 explicit charting partitions, then sequentially retrieves participation for every play—including plays you have never visited. It spaces requests, retries temporary server errors and rate limits, and stops on access errors. Filter responses must be complete, contain only plays from the base playlist, and never overlap mutually exclusive values; ignored filters, truncation, and ambiguous classifications stop capture explicitly instead of exporting unreliable tags. Empty partitions and uncovered plays are valid unknowns. The popup reports the charting stage, participation progress, and number of plays with any captured charting, and offers **Cancel**. Closing the popup does not stop capture, and reopening it restores progress. Changing the game or reloading the page interrupts the job.

Each request has a 15-second timeout and up to three attempts for HTTP 429, 500, 502, 503, and 504 or recognized network/timeout errors. Retries wait two then four seconds unless the server supplies `Retry-After`; a requested pause longer than one minute stops capture. Authentication failures and malformed participation are not retried: repeatedly fetching the same invalid field does not repair its format.

If capture fails, the message identifies an invalid field, its safe diagnostic value, the source play ID, and player-row number. **Save diagnostics** downloads a JSON report with the extension version, game ID, failure stage, validation details, and the last 200 request/retry events. Attach that report when reporting a problem rather than sharing a HAR or raw API response. Diagnostics exclude credentials, cookies, request headers, raw responses, player names, descriptions, and filesystem paths. Reports are also available after a completed capture. Reload both the extension and NFL Pro tab after updating so the current diagnostics code is active.

Player identity prefers NFL Pro's NFL player ID when present; a blank optional NFL ID falls back to the available GSIS ID. Missing both identities remains an explicit validation failure rather than an invented player ID.

NFL Pro's zero-down marker (`0`, displayed as `--` on its site) is exported as a blank down, not a fictional “zeroth down.” Valid downs 1–4 and legitimate zero distance remain unchanged. Other invalid values still stop capture with diagnostics.

After every listed play has valid participation, the extension automatically requests `nflpro-<season>-<game-id>.csv`. It does not save a success-looking partial CSV if the playlist is truncated or duplicated, or a play's participation is missing or invalid. A complete sweep covers NFL Pro's returned game playlist, not necessarily every timeout, penalty, or other event in nflverse; individual player lists may still have fewer than eleven players per side. Capture data stays in memory until export; extension storage keeps progress metadata, not player records.

AMP22 verifies game and play situations rather than assuming the providers' play IDs are interchangeable. Kickoff descriptions distinguish them from extra points at the same clock time: NFL Pro labels the kicking team as offense, whereas nflverse assigns possession to the receiving team. Imports align player sides with nflverse's teams, so app analysis exports retain the correct player/team association. This does not change play classification: CSV **Play type** remains `kickoff` or `extra_point`, and both remain special teams in filters and the `ST` video-filename label. Description matching also normalizes jersey-number prefixes and NFL Pro's `BLT` abbreviation for Baltimore. Unresolved or colliding matches still produce a data warning rather than guessing.

When several matching captures exist, participation still prefers complete sides, while charting independently chooses the latest nonempty value per field. A newer partial capture can add charting without replacing a complete roster; a newer v1 capture or blank v2 value cannot erase known charting. Conflicting values with identical charting timestamps reject the conflicting file. Existing nonempty FTN/historical charting—including **No** and numeric zero—always wins over imported alternatives. Data exports include effective charting sources, raw NFL Pro values with per-field capture provenance, and comparable-field disagreements for audit. Review source disagreements rather than summing or treating the sources as interchangeable.

Chrome and Edge use the browser Downloads API. Safari, which does not support that API, requests a Blob download from the page; its actual download behavior still requires live verification. Approve any browser download prompt and check Downloads. Browser download settings determine the actual location; the extension cannot silently select an arbitrary filesystem path. Keep the generated filename and choose the same folder in AMP22 Settings. AMP22 imports the completed CSV automatically when that folder matches. With the matching game open, the sidebar shows the imported count and **Updated automatically** confirmation; an unrelated game's download triggers only a check, not a claimed data update. Before any matching import, it shows that it is watching for CSVs. Save before quitting Safari; temporary-extension storage is not a backup of the CSV.

For Excel analysis, click **Export data**, choose the scope and row layout, then **Save CSV…**. Player-row exports repeat play-level values such as yards, box count, and pass rushers: deduplicate by **nflverse game ID + Game play ID** before summing those values. Use **GSIS player ID** for cross-source joins; unresolved imported players retain their separate **Source player ID**. The versioned import schema is defined in `src/shared/participation.js`; this provides a stable game/play/player foundation for future analysis tools.

### Keyboard shortcuts

Press **?** in the app to see the shortcuts. Hovering over a button also shows its shortcut. You can remap shortcuts in Settings.

| Action | Keys |
| --- | --- |
| Play / pause | Space, K |
| Forward / back 1 frame | → / ←, `.` / `,` |
| Forward / back N frames (default 10) | Shift+→ / Shift+← |
| Next / previous play | ↓ / ↑, N / P |
| Restart play | R, Home |
| Cycle slow-motion speed | S |
| End of play: stop / auto-advance / loop | E |
| Sync: end zone 1 frame earlier / later | `[` / `]` |
| Sync: reset offset | `\` |
| Browse film clips: next / previous | Shift+↓ / Shift+↑ |
| Fix: link shown clip to selected play | Shift+L |
| Fix: mark selected play as having no film | Shift+X |
| Fix: clear correction on selected play | Shift+C |
| Search plays | / |
| Shortcut help | ? |

### Fixing play ↔ film alignment

Plays are matched to film clips automatically. Most pre-snap penalties appear in the film, but the occasional one does not. When that happens, the app can't always tell *which* penalty is missing, so later plays may be off by one clip. To fix this:

1. Select the first play that shows the wrong film.
2. Press Shift+↓ / Shift+↑ (or use **◀ clip / clip ▶**) until the correct clip is shown.
3. Press **Shift+L** (**Link clip ↔ play**). The rest of the game re-aligns around this fix.

Other fixes:
- **Shift+X** marks a play as having no film.
- **Shift+C** clears a fix.
- **Reset all fixes** clears every fix for the game.

Fixed plays show a ✎ badge. If the two angles are slightly out of sync on a play, use `[` / `]` to shift the end zone angle one frame at a time. Fixes and sync offsets are saved per game. In split mode, clip browsing stays in the selected play's unit, so corrections never move a play into a different unit's file or shift the other units. Split corrections are scoped to the selected team and do not replace single-file corrections; **Reset all fixes** resets the active format/team perspective only.

## Settings

Settings include:
- Jump size N
- What happens at the end of a play
- Slow-motion speeds
- Default team
- Film folder
- Whether to analyze film automatically when it's opened
- Whether next/previous play skips plays without film
- Cut sensitivity
- Default clip-start trim and overlay duration in decimal seconds
- Play-breakdown format, advanced-statistics default, and individual advanced fields
- Key-play definitions
- Keyboard shortcuts

Data is stored in Electron's `userData` folder. AMP22 retains the original `A22 Film Tool` profile directory so existing settings, film links, fixes, and cached analysis remain available after upgrading. The application identifier is also unchanged for installer continuity.

The Film Room/Analysis Lab workspace preference and Analysis Lab package rules are stored in the renderer's local storage in that profile. They are separate from film-analysis caches and do not modify imported CSVs.

| File or folder | Contents |
| --- | --- |
| `settings.json` | Settings |
| `games.json` | Film format, single/split file paths, and separate fixes/offsets for each game and split-team perspective |
| `updates.json` | Latest release version dismissed with Later or opened for download |
| `analysis/` | Cached film analysis |
| `cache/` | Downloaded schedule and play-by-play |

Participation imports remain in the configured external folder (Downloads by default); AMP22 reads them without modifying them. Keeping those CSVs preserves imported participation across restarts. Moving or deleting them removes that local source on the next game load or folder refresh.

### Updating AMP22

Open **Settings → Check for updates…** to see whether a newer stable version is available. Packaged apps also check once at startup (an internet connection is required). Release notes come from the public GitHub release and are displayed as plain text, not executable HTML. Automatic checks do not download installers or send your film, game data, or settings.

The download button opens the release page, not an unattended installer. After downloading, quit AMP22 before replacing the app on macOS or running the installer on Windows. Existing installations without this update checker need one manual upgrade to gain notifications. In-place automatic download/install is not enabled on either platform. macOS builds use ad-hoc signing rather than trusted Developer ID signing; follow the [Gatekeeper installation instructions](#macos-installation-and-gatekeeper) if a downloaded app is blocked, including after an update.

## How film analysis works

1. `ffprobe` reads the frame rate (59.94 fps for A22) and duration.
2. `ffmpeg` scene detection runs on a 64×36 downscale to find hard cuts (default scene score ≥ 0.1). On Apple Silicon Macs, this small filter graph uses two threads; **decoding still uses FFmpeg's automatic thread selection**, without hardware decoding. Other platforms retain their previous settings. **Settings → Cut sensitivity** accepts thresholds down to `0.03`; lower values recover subtler angle changes but may also detect extra cuts. The initial scan respects the selected threshold rather than discarding weak candidates before pairing. If film clips are missing and the log drifts, lower the threshold and accept the re-analysis prompt. Existing cached analyses of other files remain unchanged.
3. Two small grayscale frames at 35% and 65% of each clip are classified as **sideline** or **end zone** by comparing vertical and horizontal edge energy. In end zone views the yard lines run horizontally.
4. Clips are paired (sideline followed by end zone) with dynamic programming. This handles extra cuts and stray short clips.
5. Plays are aligned to the pairs with a second dynamic program. This step accounts for plays that are unlikely to be on film (such as non-play penalties) and for the user's fixes. Automatic links still need review: a known Q1/Q2 mismatch in the Bengals game is unchanged by the processing improvement. Use **Link clip ↔ play** and **No film** to correct it.

Repeated single-file measurements on a 10-core M1 Pro showed an **8.4% reduction in total analysis time** for the Bengals confirmation runs (241.08 s to 220.92 s average), with identical cut candidates, orientation samples, clips, and camera pairs. A clean second-game comparison also improved, but these results are not a universal timing guarantee. [Reproducible experiments, CPU measurements, and limitations](docs/film-performance.md) cover decoder thread counts, batching, and VideoToolbox. Playback is unchanged: half-speed still occasionally drops frames, and short playback samples do not certify every configuration.

In split mode, the same analysis runs on each file and alignment runs independently on the appropriate offensive, defensive, or special-teams plays. Turnovers stay with the unit that began the play; unclassified plays remain unlinked rather than consuming another unit's clip.

The core logic is in `src/shared/` and has unit tests. You can also run the analysis from the command line:

```sh
npm run analyze -- "/path/to/TeamA22.mp4" --out analysis-out/team --frames 6
```

## Data sources

- Schedule: [nflverse `games.csv`](https://github.com/nflverse/nfldata/raw/master/data/games.csv)
- Play-by-play: `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{YEAR}.csv.gz`
- Player headshots: [nflverse player directory](https://github.com/nflverse/nflverse-data/releases/download/players/players.csv), using its NFL-hosted headshot URLs.
- Optional local participation: user-captured NFL Pro CSVs, imported alongside historical nflverse participation and FTN charting.
- Optional offensive-line position inference: published [nflverse depth charts](https://github.com/nflverse/nflverse-data/releases/tag/depth_charts), including modern timestamped ESPN charts and historical weekly charts. These describe depth-chart roles, not per-snap alignment.

## Development

Follow [the repository contribution instructions](AGENTS.md). User-visible PRs should update the relevant README features and usage, and refresh affected screenshots in `docs/screenshots/`; the PR template includes a checklist for this.

```sh
npm test           # unit tests (node:test)
npm run build:extension # shared unpacked Chrome/Edge/temporary macOS Safari extension
A22_TEST_EXPORT=1 npm test # also encode and inspect synthetic clips (macOS / Linux)
A22_TEST_WINDOWS=1 node --test test/angle-window.test.js # exercise native pop-outs (requires a desktop)
A22_TEST_WORKFLOWS=1 node --test test/film-workflows.test.js # native split playback and CSV/text/PDF exports (requires a desktop)
A22_TEST_ANALYSIS=1 node --test test/analysis-workflows.test.js # native Analysis Lab filters, ranges, evidence and PNG/SVG/CSV exports; no film access
npm run dist:mac   # macOS .dmg   (run on macOS)
npm run dist:win   # Windows NSIS installer (run on Windows)
```

The bundled FFmpeg and FFprobe must run on the target platform. Install dependencies and build natively on each target platform: Apple Silicon macOS, Intel macOS, or Windows x64. Merely cross-targeting Electron does not replace the installed FFmpeg binary. The included GitHub Actions workflow (`.github/workflows/build.yml`) uses a matching native runner for each target, checks the packaged app/FFmpeg architectures, and executes the packaged media tools. The current `ffprobe-static` dependency supplies an Intel FFprobe even in its `arm64` directory, so Apple Silicon uses Rosetta 2 for that helper; Intel packages are fully native.

macOS packaging explicitly uses electron-builder's ad-hoc identity (`mac.identity: "-"`), with hardened runtime and notarization disabled. Electron-builder signs the app and nested Mach-O code, including unpacked FFmpeg/FFprobe, without a certificate, paid account, or Actions secrets. Hardened runtime is disabled because ad-hoc code has no common Team ID for library validation. These are **not** trusted or notarized distribution signatures. To verify the actual app inside a built DMG on macOS, run `node scripts/verify-mac-release.js arm64` (or `x64` for Intel). The verifier mounts the DMG read-only, checks strict/deep signatures plus the app executable, media tools, Electron helper bundles and frameworks, and ejects it; it does not change quarantine or claim Gatekeeper acceptance.

### Automatic builds and releases

Every merge (or push) to `master` builds separate Apple Silicon (`arm64`) and Intel (`x64`) macOS DMGs and the Windows x64 installer, then publishes them together on the repository's [Releases page](https://github.com/apulianas/AMP22/releases) once all three builds pass, including strict verification of the ad-hoc-signed apps inside both macOS DMGs. The release version normally increments the highest stable Git tag (or the `package.json` baseline if there are no stable tags) by one patch; no version-bump commit is needed. To request a specific newer release, bump `package.json` and `package-lock.json` above all existing stable tags: that exact version is published without an extra patch increment. All installers use the same version. Rerunning a released commit reuses its version and replaces its assets. Builds on `master` are serialized to prevent competing release numbers.

Intel builds use `macos-15-intel` with Xcode 26 for the Icon Composer assets; native encoding tests run on both macOS architectures. GitHub has [scheduled its hosted Intel runner's retirement for August 2027](https://github.com/actions/runner-images/issues/13045), so continuing Intel builds after that will require another build host or a validated cross-build setup.

GitHub-generated release notes are also the in-app changelog. Every newly created release includes the macOS Gatekeeper notice, Terminal instructions, and app-only quarantine command before its generated changelog. The existing-release upload path adds the same notice if missing; reruns preserve existing descriptions exactly without duplicating a notice already added manually. Edit a published release's description to refine those notes; subsequent update checks show the updated text. Keep production tags in stable `vMAJOR.MINOR.PATCH` form. Draft and prerelease versions are not offered by the update checker.

Pull requests build and test all three targets and upload workflow artifacts, but do not publish releases. You can also run the **build** workflow manually on `master` to retry a build or release.

README installation and release instructions cover this packaging change. Screenshots are not applicable: no AMP22 controls or in-app appearance changed, and app screenshots cannot demonstrate Apple trust or notarization.

### Download counts

GitHub tracks downloads separately for each release asset, so the `arm64` DMG, `x64` DMG, and Windows installer have independent counts. No app telemetry is required. With the GitHub CLI, show the latest release's filenames and download totals:

```sh
gh api repos/apulianas/AMP22/releases/latest \
  --jq '.assets[] | [.name, .download_count] | @tsv'
```

For every published release, including older versions:

```sh
gh api --paginate repos/apulianas/AMP22/releases \
  --jq '.[] | select(.draft == false) | .tag_name as $version | .assets[] | [$version, .name, .download_count] | @tsv'
```

These are download totals, not unique people, installations, or active users. Counts belong to individual assets; deleting and reuploading an installer (including a release-build rerun that replaces it) resets that asset's count. Keep old assets or record snapshots if you need historical comparisons.

Development hooks for automation:
- `A22_USER_DATA=/dir` uses a different userData folder.
- `A22_DEV_SCRIPT=/file.js` loads a module and calls it with `{ app, win, analysisDir }` after the window opens.

### Branding and app icons

The AMP signature is the supplied vector artwork in `src/renderer/assets/amp.svg`, recolored orange (`#ff8a24`). The in-app toolbar wordmark has a transparent background so its orange AMP and purple 22 blend into the toolbar, without a black badge. Gradient highlights and subtle depth give the toolbar lettering a glossy, glass-inspired finish; the signature still uses the original vector shape. The app icon uses Icon Composer's glass rendering: two large purple (`#a970ff`) **2** numerals flank the signature's descending M-to-P stroke on a lifted charcoal-to-black gradient background. Translucent football field markings angle upward by 12 degrees across the entire icon, continuing behind AMP: stronger full-width lines every five yards, with one-yard hashes extending toward the edges and bleeding beyond the icon mask. Markings are subtler above and stronger below, without disappearing behind the signature. macOS and Windows use this same full-field composition. All-22 film terminology and the existing `A22_*` development hooks keep their original names.

Open `build/AMP22.icon` in Apple's **Icon Composer** to edit the separate orange AMP and purple 22 layers, their Liquid Glass materials, lighting, and the non-glass field texture behind the lettering. macOS packages compile this native document with Xcode 26+; the DMG volume uses `build/icon.icns`, and Windows uses the multi-resolution `build/icon.ico`. The development app uses `src/renderer/assets/icon.png`. Generated assets are committed so Windows builds do not need Apple tools.

After changing the signature, numeral artwork, or Composer materials, regenerate the exports on macOS with Xcode 26+ installed:

```sh
npm run build:icons
```

Set `ICON_COMPOSER_TOOL` to the full path of `ictool` inside Icon Composer if Xcode is installed somewhere other than `/Applications/Xcode.app`. The script rebuilds the AMP layer from the supplied signature, then renders the macOS 26 default appearance and generates PNG, ICNS, and ICO exports. Keep layout changes to the AMP layer in `scripts/build-icons.js`; edit the 22 layer and materials in the Composer document. Release builds require the full Xcode developer directory selected and its license accepted.
