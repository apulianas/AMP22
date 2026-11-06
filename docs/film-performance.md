# Single-file analysis performance on Apple M1 Pro

Measured November 6, 2026, starting from clean AMP22 0.5.0 commit
`6bec5f34df70fa63d8214507e914954d00456639` in an isolated worktree.
[PR #13](https://github.com/apulianas/AMP22/pull/13) was reference material only:
none of its processing changes were imported, and it remains unmerged.

## Recommendation and retained change

Retain **`-filter_threads 2` on the scene-scan filter graph only, on native
Apple Silicon macOS**. Keep automatic decoder threading, individual orientation
frame extraction with four concurrent clip workers, and software decoding.
Other platforms keep their previous command options.

The alternating Bengals confirmation runs averaged **241.08 s before versus
220.92 s after: 8.4% less elapsed time**, not a multiple-fold speedup. Their scan
averages were 197.60 s versus 178.99 s (9.4% less). Scan helper CPU time fell from
1,562.90 to 1,392.89 CPU-seconds (10.9% less). A later clean Saints control and
the actual retained implementation took **228.37 s versus 211.88 s** (7.2%
less elapsed time; one clean comparison, not an independent repeated-trial
estimate). Do not generalize these percentages to all films or Macs.

No decoder cap, batching, hardware acceleration, queue redesign, new setting,
cache invalidation, playback change, or single-file progressive loading ships
with this change.

## Machine, inputs, and measurement conditions

| Item | Value |
|---|---|
| Machine | 10-core Apple M1 Pro, 32 GiB RAM, native arm64, AC power |
| Runtime | Node 26.5.0; locked `ffmpeg-static` binary reporting FFmpeg 6.0 |
| Primary film | `w7vBengals/bengalsA22.mp4`, 5,094,927,762 bytes (4.75 GiB), 5,003.483 s |
| Second film | `w2vSaints/SaintsA22.mp4`, 4,757,487,124 bytes (4.43 GiB), 4,670.184 s |
| Both sources | 1920x1080 H.264, 60000/1001 fps, one full-game file containing both camera angles |
| Cut threshold | 0.1; scan candidate floor 0.06; minimum cut gap 0.4 s |

Original recordings were opened read-only by FFmpeg. File size and modification
time were checked before/after each run; neither changed. No three-file import,
film conversion, or trimmed proxy was used.

Each measurement launched a fresh Node process, performed fresh analysis
(not an app-cache hit), and wrote results outside the checkout. CPU benchmarks
ran sequentially, with no tests, exports, or deliberately concurrent analysis.
Full confirmation runs had 20-second gaps. Normal desktop/system processes
remained present; this was not a dedicated, pristine OS environment.
`pmset -g therm` reported no thermal/performance warning. No privileged cache
purge was used: **OS page-cache state is not controlled**, and the first run is
not claimed to be cold. All later runs benefited to an unknown extent from
previous access.

The first probe took 5.29 s versus 0.12 s on the next run despite only 0.06
helper CPU-seconds each. This is a startup/wall-time effect, not evidence that
the analysis algorithm became faster. Dependencies were installed before
measurements; no builds or native tests ran alongside the primary benchmarks.

The harness records every helper's complete arguments, wall time, exit code,
user/system CPU time via macOS `/usr/bin/time -p`, and grayscale-frame SHA-256
hashes. It also samples system load/free memory every two seconds.
**CPU percentages below are aggregate helper CPU time / phase wall time;
100% means one fully occupied core.** Node's feature scoring and pairing CPU
are not included in that helper CPU figure. GPU/media-engine time and power
consumption are not measured.

Initial runs checked for competing media/apps at startup only. A second
session subsequently opened a test Electron instance around 22:22:54 UTC,
during the final original Saints control. That control is excluded from clean
comparisons. The whole original Saints ABBA block is treated as exploratory,
since preceding validation in that session could not be ruled out. The owner
closed its app and paused validation before the clean repeat. The final harness
also checks for competing FFmpeg, FFprobe, Electron, or AMP22 processes every
two seconds and cancels an interfered run. Both clean Saints runs recorded
zero detected interference. This conservative detector may also refuse an
unrelated idle Electron app; it does not terminate someone else's job.

## Full-game measurements

All phase times below are seconds; pairing is milliseconds. Total includes
small harness/serialization overhead. The first six rows used byte-identical
0.5.0 media code; candidate arguments were changed only by the benchmark
instrumentation. The final row ran the retained production code without
benchmark option overrides.

| Film / run, in execution order | Probe | Scan | Classify | Pair (ms) | Total |
|---|---:|---:|---:|---:|---:|
| Bengals baseline 1 | 5.293 | 204.03 | 44.32 | 1.37 | 253.64 |
| Bengals baseline 2 | 0.121 | 193.64 | 41.48 | 1.15 | 235.25 |
| Bengals filter=2, confirmation 1 | 0.123 | 180.64 | 44.06 | 1.37 | 224.82 |
| Bengals control 3 | 0.130 | 205.84 | 43.75 | 1.35 | 249.73 |
| Bengals filter=2, confirmation 2 | 0.119 | 177.33 | 39.56 | 1.09 | 217.02 |
| Bengals control 4 | 0.106 | 189.36 | 42.97 | 1.24 | 232.44 |
| Saints clean control, automatic filters | 0.119 | 187.60 | 40.65 | 1.04 | 228.37 |
| Saints retained code, filter=2 | 0.133 | 170.81 | 40.94 | 1.38 | 211.88 |

The primary headline compares the two alternating confirmation controls with
the two candidates, rather than comparing just the slow first startup against
the fastest candidate. All four Bengals controls ranged from 232.44 to 253.64 s;
both candidates were faster than every control, but classification still varied
from 39.56 to 44.32 s without any classification changes. These are small-sample
home-machine results, not confidence intervals.

| Full run | Scan helper CPU % | Classification helper CPU % |
|---|---:|---:|
| Bengals baseline 1 / 2 | 763 / 816 | 800 / 861 |
| Bengals confirmation control 3 / 4 | 760 / 825 | 815 / 832 |
| Bengals filter=2, 1 / 2 | 772 / 785 | 810 / 898 |
| Saints clean control / retained | 779 / 742 | 823 / 816 |

For completeness, the quarantined/exploratory Saints block was:

| Run | Probe | Scan | Classify | Pair (ms) | Total |
|---|---:|---:|---:|---:|---:|
| Original control 1 | 0.117 | 187.22 | 41.04 | 1.30 | 228.38 |
| Original filter=2, 1 | 0.110 | 178.13 | 44.71 | 1.51 | 222.96 |
| Original filter=2, 2 | 0.794 | 176.62 | 41.39 | 3.46 | 218.81 |
| Original control 2, competing app appeared | 0.134 | 189.67 | 40.58 | 1.17 | 230.39 |

The supplied earlier 271.34 s baseline and 750.66 s PR #13 measurement are
historical exploratory observations, not controls pooled into these results.

## Isolated staged experiments

### Decoder threads, then filter threads

Two nominal 180-second scan windows started at 0 and 2,400 s in the original
Bengals file. Thread-count order was reversed in the second window. Except for
the option being varied, commands matched 0.5.0. Because output `-t 180` is
downstream of scene selection, FFmpeg processes through the next selected cut:
the last emitted timestamps were 187.683 and 183.073 s relative to the window
start. These are matched-work comparisons, **not exact 180-second decode
throughput estimates**. Seeking into the second window also changes timestamp
origin/printed precision; window JSON should not be compared literally to
full-game timestamps.

| Scan configuration | Window 1 elapsed | Window 2 elapsed | Helper CPU %, windows 1 / 2 |
|---|---:|---:|---:|
| Automatic decoding, automatic filters | 7.12 | 7.36 | 843 / 796 |
| Decoder `-threads 2` | 23.73 | 23.08 | 240 / 238 |
| Decoder `-threads 4` | 12.15 | 12.60 | 463 / 432 |
| Decoder `-threads 6` | 8.61 | 8.68 | 670 / 650 |
| Decoder `-threads 8` | 7.51 | 7.73 | 784 / 737 |
| Decoder `-threads 10` | 7.16 | 7.38 | 836 / 785 |
| Automatic decoding, `-filter_threads 1` | 7.25 | 7.29 | 701 / 682 |
| Automatic decoding, `-filter_threads 2` | 6.86 | 7.06 | 773 / 749 |
| Automatic decoding, `-filter_threads 4` | 7.18 | 7.12 | 769 / 776 |

The decoder two-thread cap reproducibly costs about 3.2x on these windows.
Automatic decoding is at least as good as the sensible explicit counts tested.
The modest filter=2 signal was the only scan change advanced to full-game
confirmation. Do not confuse **filter threads** with **decoder threads**.

### Orientation extraction, independently of scanning

Each trial classified the same 40 clips distributed across the full game
(`floor(i * 302 / 40)`, i=0..39), using the baseline cut boundaries, four clip
workers, and the original 35%/65% sample times. Each method was repeated in
reverse configuration order. Batched extraction used two independent input
seeks, trimmed each to its first frame, then concatenated two grayscale frames
in one process; it did not decode the entire interval between samples.

| Extraction configuration | Trial 1 | Trial 2 |
|---|---:|---:|
| Individual, automatic decoding/filtering | 6.03 | 5.90 |
| Batched, automatic decoding/filtering | 5.93 | 5.89 |
| Individual, decoder=1 | 10.28 | 10.11 |
| Batched, decoder=1 | 10.14 | 10.03 |
| Individual, decoder=1 and filters=1 | 9.98 | 9.96 |
| Batched, decoder=1 and filters=1 | 9.85 | 9.84 |
| Individual, decoder=2, filters auto / 1 | 6.44 / 6.32 | 6.44 / 6.41 |
| Individual, decoder=4, filters auto / 1 | 5.84 / 5.66 | 5.81 / 5.74 |
| Individual, decoder=6, filters auto / 1 | 5.89 / 5.75 | 5.89 / 5.68 |
| Individual, decoder=8, filters auto / 1 | 6.10 / 5.89 | 5.95 / 5.84 |

Automatic individual and automatic batched trials both consumed about 49.9-50.1
helper CPU-seconds (829-848% and 845-848% utilization respectively). The
decoder=1/filter=1 trials used about 37.7 CPU-seconds but took almost ten seconds.
Lower CPU consumption alone does not establish a throughput improvement.

Batching's approximately 0-2% difference is too small to justify another
extraction path. Moderate explicit decoder counts had only a small staged
signal, below the observed full-game classification variation; they were not
promoted or claimed as improvements. Every staged extraction produced exactly
the same 80 raw grayscale-frame hashes and all 40 orientation scores.

### VideoToolbox and CPU-frame transfers

The bundled binary advertises VideoToolbox. Both of these working paths were
tested against the best CPU configuration, with the original CPU-only filters:

1. Input `-hwaccel videotoolbox`: FFmpeg's implicit transfer to software frames.
2. Additionally `-hwaccel_output_format videotoolbox_vld`, followed by
   `hwdownload,format=nv12` before `scale`/`select` or grayscale conversion.

| Method | Scan window 1 / 2 | 40-clip classification, trials 1 / 2 |
|---|---:|---:|
| CPU, automatic decoder | 7.12 / 7.36 | 6.03 / 5.90 |
| CPU, automatic decoder, scan filters=2 | 6.86 / 7.06 | Unchanged individual path |
| VideoToolbox, implicit transfer | 57.88 / 58.41 | 14.50 / 14.70 |
| VideoToolbox, explicit download | 57.59 / 57.52 | 13.92 / 13.74 |

Hardware scan helper utilization was only about 68-70%, versus roughly
749-773% for the best staged CPU scan. Its longer wall time includes hardware
decode/session overhead, transfer, and software filters; no reliable attribution
to each component or power savings is available. `-skip_frame noref` remained
in the scan command; hardware advertising support does not prove equivalent
reference-frame skipping or a benefit for this workload.

Both hardware paths preserved all window candidates and all 80 sampled frame
hashes/orientation scores. They are compatible here but substantially slower.
There was no reason to spend full-game runs on these rejected paths.

## Correctness, application behavior, and remaining limitations

| Comparison | Result |
|---|---|
| All six Bengals full runs | Identical info, 308 candidates, cut boundaries, 302 clips, orientation scores, and all fields of 150 camera pairs |
| All six Saints full runs, including exploratory ones | Identical info, 305 candidates, cut boundaries, 289 clips, orientations, and all fields of 140 pairs |
| Bengals orientation inputs | All 604 raw-frame hashes identical in every full run |
| Clean Saints orientation inputs | All 578 raw-frame hashes identical between control and retained code |
| All staged scan variants | Exact candidate times/scores match the automatic CPU reference within each respective window |
| Low cut sensitivity | Regression fixture at threshold 0.03 retains both subtle cuts; candidate scores also match the original automatic-filter command |

For reproducibility, SHA-256 of JSON containing sorted `[sample timestamp,
frame SHA-256]` entries was:

```text
Bengals: eb7d3d1bd2c546a4e1b7f316360ea45c82b6d94c428df25b5670c5aa10a28b80
Saints:  2650c1ee1b326a7841b98c102f19cc97e8d82707147c304b7d94da8b8fb78da0
```

The actual running app used an isolated `A22_USER_DATA` directory, actual 2026
week 7 CIN/BAL play-by-play, and only `bengalsA22.mp4` in single-file mode. All
151 play-to-pair mapping entries matched baseline, with 150 linked plays.
Twelve selections distributed across all four quarters settled in 21.5-287.4 ms
(median 94.3 ms). Opening plus requesting cached analysis took 3.5 ms, returned
the same clip data, and did not launch another scan. Cancelling a forced
analysis at the beginning of its scan rejected with `Cancelled` in 123.5 ms;
the existing cached result remained usable. Analysis version/key semantics
are unchanged.

Actual first-linked-play images from Q1/Q2/Q3/Q4 were inspected, not just
counts. The **existing Q1/Q2 sequence-alignment mismatch remains**: Q2 15:00,
D. Henry at CIN 49, maps to zero-based pair 34 (sideline 1179.670 s, end zone
1197.690 s), showing a formation around BAL 36. It is the same mapping and
footage as baseline, not a new scan regression. The first-quarter kickoff,
third-quarter kickoff, and fourth-quarter CIN 12 formation were plausible
spot checks, not verification of every snap or play result. Use existing
**Link clip ↔ play** and **No film** corrections; 150 pairs do not certify
correct alignment.

Four plays, one per quarter, were also sampled at 1x, 0.5x, and 0.25x, after a
one-second warm-up with three seconds of measurement each. In the final pass:

| Rate | Sideline dropped / total, by play | End zone dropped / total, by play |
|---|---|---|
| 1x | 0/180, 0/181, 0/180, 0/180 | 0/180, 5/181, 0/181, 1/181 |
| 0.5x | 7/91, 5/91, 2/91, 15/91 | 3/91, 5/90, 0/90, 2/90 |
| 0.25x | 0/45, 0/46, 0/45, 0/45 | 0/45, 0/46, 0/45, 0/45 |

Maximum sampled inter-angle `currentTime` offset difference was 23.45 ms.
**Half-speed is not consistently drop-free; neither is 1x in these samples.**
These app checks occurred after the benchmark pause ended, so they are not
isolated playback performance benchmarks or before/after evidence of a playback
improvement. Playback code was not changed. The full file still completes
before play links are published; progressive loading remains deferred.

Documentation/screenshots: existing screenshots are unchanged and screenshot
refresh is **not applicable** because this is an internal processing-option
change with no new UI or controls. Private validation captures were taken only
from the real running app and real game film, not used as replacement product
screenshots or as proof that all automatic links are correct.

## Reproducing the measurements

Install locked dependencies with `npm ci`. On this Mac, set the source and a
fresh parent output directory (never place outputs over an original recording):

```sh
FILM="$HOME/Movies/2026 Ravens Games/w7vBengals/bengalsA22.mp4"
RESULTS="$(mktemp -d /tmp/amp22-performance.XXXXXX)"

# Baseline-equivalent scan command on this branch: explicitly remove the filter cap.
node scripts/benchmark-film.js "$FILM" --scan-filter-threads auto --out "$RESULTS/control-1"
sleep 20
# Actual production defaults, with no benchmark option overrides.
node scripts/benchmark-film.js "$FILM" --out "$RESULTS/retained-1"
sleep 20
node scripts/benchmark-film.js "$FILM" --out "$RESULTS/retained-2"
sleep 20
node scripts/benchmark-film.js "$FILM" --scan-filter-threads auto --out "$RESULTS/control-2"
```

Each output directory must be new. `analysis.json` contains the results;
`metrics.json` contains timings, command options, helper CPU, frame hashes,
source code hash, startup/cache notes, and interference diagnostics. Keep
these local: reports/analysis contain the source file path. Do not run tests,
exports, another AMP22 instance, or other analysis during a measurement.
The harness deliberately refuses/cancels competing media/app jobs. It uses
macOS `/usr/bin/time` and `ps`; it is not a Windows benchmark runner.

Compare full results and every sampled frame, excluding only volatile analysis
metadata such as creation time:

```sh
node - "$RESULTS/control-1" "$RESULTS/retained-1" <<'NODE'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const [before, after] = process.argv.slice(2);
const read = (dir, file) => JSON.parse(fs.readFileSync(`${dir}/${file}.json`));
const a = read(before, 'analysis'), b = read(after, 'analysis');
for (const key of ['info', 'candidates', 'clips', 'pairs']) assert.deepEqual(a[key], b[key], key);
function frames(dir) {
  return read(dir, 'metrics').commands.flatMap(c => {
    const times = c.args.flatMap((v, i) => v === '-ss' ? [c.args[i + 1]] : []);
    return c.frames.map((hash, i) => [times[i], hash]);
  }).sort((a, b) => a[0].localeCompare(b[0]));
}
assert.deepEqual(frames(before), frames(after), 'raw orientation samples');
console.log('Identical candidates, clips, orientations, pairs, and sampled frames');
NODE
```

To reproduce individual staged variables:

```sh
node scripts/benchmark-film.js "$FILM" --mode scan --seconds 180 --start 0 \
  --scan-filter-threads auto --threads 2 --out "$RESULTS/scan-decoder-2"
node scripts/benchmark-film.js "$FILM" --mode scan --seconds 180 --start 2400 \
  --scan-filter-threads 2 --out "$RESULTS/scan-filter-2"
node scripts/benchmark-film.js "$FILM" --mode classify \
  --analysis "$RESULTS/control-1/analysis.json" --samples 40 --out "$RESULTS/individual"
node scripts/benchmark-film.js "$FILM" --mode classify --batch \
  --analysis "$RESULTS/control-1/analysis.json" --samples 40 --out "$RESULTS/batch"
node scripts/benchmark-film.js "$FILM" --mode scan --seconds 180 \
  --scan-filter-threads auto --hardware videotoolbox --out "$RESULTS/hardware-implicit"
node scripts/benchmark-film.js "$FILM" --mode scan --seconds 180 \
  --scan-filter-threads auto --hardware download --out "$RESULTS/hardware-download"
```

`--threads N` changes input decoding only. `--filter-threads N` changes software
filter threading for the measured phases; `--scan-filter-threads auto|N`
overrides scan filtering independently. Omit these flags to measure production
defaults; automatic decoder selection remains the default. Use `--samples 302`
with Bengals classification mode to cover every clip rather than the staged
subset. Always reverse/repeat configuration order and compare output content
before accepting a timing difference. Ctrl-C cancels the helper processes.

Focused regression command:

```sh
node --test test/benchmark-film.test.js test/media.test.js test/scenes.test.js \
  test/orientation.test.js test/pairing.test.js test/align.test.js test/film-workflows.test.js
```

Result: **30 passed, 0 failed, 1 skipped** (the existing opt-in native split-film
workflow test). Real single-file app checks above cover the requested workflow;
no synthetic three-file import was substituted.
