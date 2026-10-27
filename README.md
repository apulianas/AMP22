# A22 Film Tool

A desktop app for macOS and Windows for studying NFL All-22 (A22) film. It plays the sideline and end zone angles of each play side by side, kept in sync. You can jump to any play from the nflverse (nflfastR) play-by-play and step through the film frame by frame.

## Features

- **Two synced angles.** The A22 file is one continuous video in which each play appears twice: the high sideline angle first, then the end zone angle. The app finds the cuts, pairs the two clips for each play, and plays both together on one clock. The layout switches between side-by-side and stacked depending on the window shape.
- **Play-by-play navigation.** Pick the season, team, and week from the drop-downs. The default is the current season, the Ravens, and the most recently completed week. Plays come from [nflverse](https://github.com/nflverse/nflverse-data) and are color-coded:
  - **Run** is green, **pass** is blue, **special teams** is purple, and **no play** (penalty) is gray.
  - **Key plays** get a gold edge and badges: INT, FUM, TOD (turnover on downs), TD, FG, SAF, 2PT, BIG (run ≥ 10 or pass ≥ 20 yards), 4TH (4th-down conversion), and optionally SACK.
  - **Negative plays** get a red edge and a SACK or LOSS badge. These are sacks, plus runs and completions that lose 3 or more yards.
  - You can change the key-play and negative-play definitions in Settings.
  - Plays are grouped by drive. Each drive has a header showing the team, number of plays, yards, time of possession, and result.
  - Each play shows a box-score line first, for example `T.Huntley → Z.Flowers +48 TD`, with the full play description below it in smaller text.
  - The list can be searched and filtered by play type (run, pass, special teams), offense, quarter, and result. Result filters: key, negative, sacks, turnovers, scores, big plays, first downs, penalties. The quarter list includes OT only when the game went to overtime.
- **Frame-accurate controls.** Step 1 frame or N frames at a time (N defaults to 10 and is configurable). You can also move to the next or previous play, restart the play, and change to slow-motion speeds. At the end of a play the app can stop, auto-advance, or loop.

## Getting started

Requirements: Node.js 20 or later.

```sh
npm install
npm start
```

npm 11 blocks install scripts unless they are approved. The `allowScripts` entry in `package.json` approves the scripts for `electron`, `ffmpeg-static`, and `ffprobe-static`. If the Electron binary is missing, run `node node_modules/electron/install.js`.

### Using it

1. Choose the season, team, and week. The schedule and play-by-play are downloaded and cached, so games you've opened before also work offline.
2. Click **Choose film…** and select the game's A22 `.mp4`. The app streams the file from where it is and never copies or changes it.
   You can also set a **film folder** in Settings (⚙), for example `~/Movies/2026 Ravens Games`. The app then finds the A22 file automatically by matching week folders such as `w7vBengals` or `w1@Colts` and preferring files with `a22` in the name.
   The app remembers the file chosen for each game.
3. The first time you open a film, the app analyzes it. This takes about 3–5 minutes for a full game, and you can see the progress. Results are cached by file path, size, and modified time.
4. Click a play, or use ↓/↑, to watch it.

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

Fixed plays show a ✎ badge. If the two angles are slightly out of sync on a play, use `[` / `]` to shift the end zone angle one frame at a time. Fixes and sync offsets are saved per game.

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
- Key-play definitions
- Keyboard shortcuts

Data is stored in Electron's `userData` folder:

| File or folder | Contents |
| --- | --- |
| `settings.json` | Settings |
| `games.json` | Film path, fixes, and offsets for each game |
| `analysis/` | Cached film analysis |
| `cache/` | Downloaded schedule and play-by-play |

## How analysis works

1. `ffprobe` reads the frame rate (59.94 fps for A22) and duration.
2. `ffmpeg` scene detection runs on a 64×36 downscale to find hard cuts (scene score ≥ 0.1).
3. A small grayscale frame from the middle of each clip is classified as **sideline** or **end zone** by comparing vertical and horizontal edge energy. In end zone views the yard lines run horizontally.
4. Clips are paired (sideline followed by end zone) with dynamic programming. This handles extra cuts and stray short clips.
5. Plays are aligned to the pairs with a second dynamic program. This step accounts for plays that are unlikely to be on film (such as non-play penalties) and for the user's fixes.

The core logic is in `src/shared/` and has unit tests. You can also run the analysis from the command line:

```sh
npm run analyze -- "/path/to/TeamA22.mp4" --out analysis-out/team --frames 6
```

## Data sources

- Schedule: [nflverse `games.csv`](https://github.com/nflverse/nfldata/raw/master/data/games.csv)
- Play-by-play: `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{YEAR}.csv.gz`

## Development

```sh
npm test           # unit tests (node:test)
npm run dist:mac   # macOS .dmg   (run on macOS)
npm run dist:win   # Windows NSIS installer (run on Windows)
```

`ffmpeg-static` and `ffprobe-static` download binaries only for the platform you install on. Build the Windows installer on Windows, or with the included GitHub Actions workflow (`.github/workflows/build.yml`).

Development hooks for automation:
- `A22_USER_DATA=/dir` uses a different userData folder.
- `A22_DEV_SCRIPT=/file.js` loads a module and calls it with `{ app, win, analysisDir }` after the window opens.
