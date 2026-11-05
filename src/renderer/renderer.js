/* global A22 */
'use strict';

const { ACTIONS, mergeSettings, comboFromEvent, keyLabel, buildKeymap, DEFAULT_SETTINGS } = A22.settings;
const P = A22.plays;
const ADV = A22.advanced;
const REPORT = A22.reports;
const $ = (id) => document.getElementById(id);

// Cut times are frame timestamps rounded to ~0.01 s, and the frame grid's phase changes from
// clip to clip (A22 files are stitched together), so positions are kept on a grid relative to
// each clip's start, offset slightly so a seek always lands inside the intended frame.
const { START_PAD, END_TRIM_FRAMES } = A22.clipExport;

const S = {
  settings: null,
  keymap: new Map(),
  games: [],
  sel: { season: null, team: null, week: null, gameId: null },
  game: null, // schedule row
  gameData: {}, // persisted film paths and per-format/team corrections
  plays: [], // normalized plays + derived fields
  mapping: [], // play index -> pair index | null
  film: null, // {path, url, info, analysis}
  splitFilms: {},
  filmRevision: 0,
  filmSetupOpen: false,
  analyzing: false,
  fps: 59.94,
  pairs: [],
  curPlay: -1,
  curPair: -1,
  range: null, // {aStart, bStart, len}
  playing: false,
  speedIdx: 0,
  filter: {
    type: 'all', text: '', offense: '', qtr: '', result: '',
    airMin: null, airMax: null, yardsMin: null, yardsMax: null, distMin: null, distMax: null,
    choices: {}, // ADV_CHOICES key -> option value; player -> selected player IDs
  },
  visible: [], // play indices in list order
  selected: new Set(),
  selectionAnchor: -1,
  multiSelect: false,
  exporting: false,
  exportCancelRequested: false,
  exportDraft: null,
};

/* ---------------- utilities ---------------- */

function fmtTime(t) {
  if (!isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function setStatus(msg, isErr) {
  const el = $('status');
  el.textContent = msg || '';
  el.title = msg || '';
  el.style.color = isErr ? 'var(--bad)' : '';
}
function showMessage(html) {
  $('message').innerHTML = html ? `<div>${html}</div>` : '';
  renderFilmSetup();
}
function pairKey(pair) {
  return (pair.role ? `${S.sel.team}:${pair.role}|` : '') + pair.sideline.start.toFixed(2);
}
function pairIndexForKey(key) {
  const parts = String(key).split('|');
  const prefix = parts.length > 1 ? parts[0] : '';
  const t = Number(parts[parts.length - 1]);
  let best = -1, bd = 0.5;
  S.pairs.forEach((p, i) => {
    if ((p.role ? `${S.sel.team}:${p.role}` : '') !== prefix) return;
    const d = Math.abs(p.sideline.start - t);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function isSplitFilm() {
  return S.gameData.filmFormat === 'split';
}

function corrections() {
  return isSplitFilm() ? (S.gameData.splitCorrections || {})[S.sel.team] || {} : S.gameData;
}

async function saveCorrections(patch) {
  if (!isSplitFilm()) return saveGame(patch);
  await saveGame({ splitCorrections: {
    ...S.gameData.splitCorrections,
    [S.sel.team]: { ...corrections(), ...patch },
  } });
}

/* ---------------- settings ---------------- */

function applySettings(s) {
  S.settings = mergeSettings(s);
  S.keymap = buildKeymap(S.settings.shortcuts);
  S.speedIdx = Math.min(S.speedIdx, S.settings.speeds.length - 1);
  updateSpeedLabel();
  updateEndLabel();
  renderHelp();
  updateTooltips();
  if (S.plays.length) {
    derivePlays();
    renderList();
    renderInfo();
  }
}

/* ---------------- schedule / selection ---------------- */

function fillSelect(el, options, value) {
  el.innerHTML = options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  if (value != null) el.value = String(value);
}

function seasonsList() {
  return [...new Set(S.games.map((g) => g.season))].sort((a, b) => b - a);
}
function teamsList(season) {
  const s = new Set();
  S.games.forEach((g) => { if (g.season === season) { s.add(g.homeTeam); s.add(g.awayTeam); } });
  return [...s].sort();
}
function teamGames(season, team) {
  return S.games.filter((g) => g.season === season && (g.homeTeam === team || g.awayTeam === team)).sort((a, b) => a.week - b.week);
}
function gameLabel(g, team) {
  const home = g.homeTeam === team;
  const opp = home ? g.awayTeam : g.homeTeam;
  const names = { WC: 'Wild Card', DIV: 'Divisional', CON: 'Conference', SB: 'Super Bowl' };
  const wk = g.gameType && g.gameType !== 'REG' ? names[g.gameType] || g.gameType : `Week ${g.week}`;
  let res = '';
  if (g.homeScore != null && g.awayScore != null) {
    const us = home ? g.homeScore : g.awayScore;
    const them = home ? g.awayScore : g.homeScore;
    res = ` (${us > them ? 'W' : us < them ? 'L' : 'T'} ${us}-${them})`;
  }
  return `${wk} ${home ? 'vs' : '@'} ${opp}${res}`;
}

function renderSelectors() {
  fillSelect($('sel-season'), seasonsList().map((y) => ({ value: y, label: y })), S.sel.season);
  fillSelect($('sel-team'), teamsList(S.sel.season).map((t) => ({ value: t, label: `${t} – ${A22.teams.nickname(t)}` })), S.sel.team);
  const tg = teamGames(S.sel.season, S.sel.team);
  fillSelect($('sel-week'), tg.map((g) => ({ value: g.gameId, label: gameLabel(g, S.sel.team) })), S.sel.gameId);
}

function onSelectorChange(which) {
  const season = Number($('sel-season').value);
  let team = $('sel-team').value;
  let gameId = $('sel-week').value;
  if (which === 'season' || which === 'team') {
    if (!teamsList(season).includes(team)) team = teamsList(season)[0];
    const tg = teamGames(season, team);
    const prevWeek = S.game ? S.game.week : null;
    const g = tg.find((x) => x.week === prevWeek) || tg[tg.length - 1];
    gameId = g ? g.gameId : null;
  }
  S.sel = { season, team, gameId };
  renderSelectors();
  document.activeElement.blur();
  loadGame();
}

async function loadSchedule(force) {
  setStatus('Loading schedule…');
  try {
    const r = await window.api.getSchedule({ force });
    S.games = r.games;
    if (!S.sel.gameId) S.sel = { ...r.defaultSelection };
    setStatus(r.warning || '', !!r.warning);
    renderSelectors();
    return true;
  } catch (e) {
    setStatus(e.message, true);
    showMessage(`Couldn't load the NFL schedule (${esc(e.message)}).<br>You can still open a film with <b>Choose film…</b>.`);
    return false;
  }
}

/* ---------------- game loading ---------------- */

async function loadGame(force) {
  const gameId = S.sel.gameId;
  const team = S.sel.team;
  closeFilm();
  const revision = S.filmRevision;
  S.game = S.games.find((g) => g.gameId === gameId) || null;
  S.plays = [];
  S.participationNotice = '';
  S.participationWarning = '';
  renderParticipationStatus();
  S.mapping = [];
  S.curPlay = -1;
  S.selected.clear();
  S.selectionAnchor = -1;
  S.multiSelect = false;
  updateSelection();
  const gameData = gameId ? await window.api.getGame(gameId) : {};
  if (revision !== S.filmRevision) return;
  S.gameData = gameData;
  renderFilmControls();
  const opp = S.game ? (S.game.homeTeam === S.sel.team ? S.game.awayTeam : S.game.homeTeam) : '';
  fillSelect($('sel-offense'), [
    { value: '', label: 'Both offenses' },
    { value: S.sel.team, label: `${S.sel.team} offense` },
    ...(opp ? [{ value: opp, label: `${opp} offense` }] : []),
  ], '');
  S.filter.offense = '';
  renderQuarters();

  if (S.game) {
    setStatus('Loading play-by-play…');
    try {
      const r = await window.api.getPlays({ season: S.game.season, gameId, force });
      if (S.sel.gameId !== gameId || S.sel.team !== team || revision !== S.filmRevision) return;
      S.plays = r.plays;
      S.participationWarning = r.warning || '';
      setStatus(r.warning || '', !!r.warning);
    } catch (e) {
      if (revision !== S.filmRevision) return;
      S.participationWarning = e.message;
      setStatus(e.message, true);
    }
  }
  derivePlays();
  renderQuarters();
  renderAdvancedFilters();

  if (isSplitFilm()) {
    await openSplitFilms();
    return;
  }
  let filmPath = S.gameData.filmPath;
  if (!filmPath && S.game) {
    const s = await window.api.suggestFilm({ week: S.game.week, opponent: opp, season: S.game.season, team: S.sel.team });
    if (revision !== S.filmRevision) return;
    if (s.auto) {
      filmPath = s.auto;
      await saveGame({ filmPath });
      if (revision !== S.filmRevision) return;
    }
  }
  if (filmPath) await openFilm(filmPath);
  else {
    closeFilm();
    showMessage('Choose an All-22 file containing both sideline and end zone angles.<br><span class="muted">Tip: set a film folder in Settings ⚙ to find files automatically.</span>');
  }
  realign();
  renderList();
  const first = S.visible.find((i) => S.mapping[i] != null);
  if (first != null) selectPlay(first, { autoplay: false });
  else renderInfo();
}

async function saveGame(patch) {
  if (!S.sel.gameId) return;
  const gameId = S.sel.gameId;
  const team = S.sel.team;
  const data = await window.api.saveGame(gameId, patch);
  if (S.sel.gameId === gameId && S.sel.team === team) S.gameData = data;
}

function derivePlays() {
  for (const p of S.plays) {
    p.cat = P.category(p);
    p.filmWeight = P.filmWeight(p);
    p.key = P.keyReasons(p, S.settings.keyPlays);
    p.neg = P.negativeReasons(p, S.settings.keyPlays);
    p.box = P.boxScore(p);
    const players = [...(p.onField?.offense || []), ...(p.onField?.defense || [])];
    p.searchText = `${p.desc} ${p.posteam} ${P.downDistance(p)} ${p.key.join(' ')} ${p.neg.join(' ')} ${p.cat} ${ADV.tags(p).join(' ')} ${players.map((x) => `${x.name} ${x.position} ${x.number}`).join(' ')}`.toLowerCase();
  }
}

function realign() {
  if (!S.pairs.length || !S.plays.length) {
    S.mapping = S.plays.map(() => null);
    return;
  }
  const anchors = new Map();
  const a = corrections().anchors || {};
  S.plays.forEach((p, i) => {
    if (!(String(p.playId) in a)) return;
    const v = a[p.playId];
    if (v === null) anchors.set(i, null);
    else {
      const k = pairIndexForKey(v);
      if (k >= 0) anchors.set(i, k);
    }
  });
  S.mapping = isSplitFilm()
    ? A22.align.alignSplitPlays(S.plays, S.pairs, S.sel.team, anchors)
    : A22.align.alignPlays(S.plays, S.pairs.length, anchors);
}

/* ---------------- film ---------------- */

function closeFilm() {
  S.filmRevision++;
  S.filmSetupOpen = false;
  S.analyzing = false;
  $('progress').hidden = true;
  pause();
  dockAngle();
  S.film = null;
  S.splitFilms = {};
  S.pairs = [];
  S.range = null;
  S.curPair = -1;
  for (const video of [vidA(), vidB()]) {
    video._pending = null;
    video._target = null;
    video.removeAttribute('src');
    video.load();
  }
  resetDrift();
  updateAngleButtons();
  $('film-name').textContent = '';
  $('btn-analyze').hidden = true;
  renderFilmSetup();
}

function renderFilmSetup() {
  const ready = !!S.film && S.pairs.length > 0;
  const open = !ready || S.filmSetupOpen;
  $('film-setup').hidden = !open;
  $('film-setup-toggle').hidden = !ready || open;
  $('film-setup-toggle').setAttribute('aria-expanded', String(open));
  $('film-setup-close').hidden = !ready;
  $('film-setup-game').textContent = S.game ? gameLabel(S.game, S.sel.team) : '';
  $('film-setup-message').innerHTML = $('message').innerHTML;
  $('message').hidden = open;
  $('videos').classList.toggle('choosing-film', open);
}

function renderFilmControls() {
  const split = isSplitFilm();
  $('film-format').value = split ? 'split' : 'single';
  $('btn-film').textContent = split ? `Choose ${S.sel.team} offense…` : 'Choose film…';
  $('btn-film').title = split ? `Both angles of ${S.sel.team}'s offensive plays` : 'Choose the A22 film file for this game';
  $('btn-defense-film').hidden = !split;
  $('btn-defense-film').textContent = `Choose ${S.sel.team} defense…`;
  $('btn-defense-film').title = `Both angles of ${S.sel.team}'s defensive plays`;
  $('btn-special-film').hidden = !split;
  $('btn-special-film').title = 'Both angles of the game’s special-teams plays (kicks and returns)';
  renderFilmSetup();
}

function rebuildSplitPairs() {
  const current = S.pairs[S.curPair];
  S.pairs = ['offense', 'defense', 'special'].flatMap((role) => {
    const film = S.splitFilms[role];
    return (film?.analysis?.pairs || []).map((pair) => ({ ...pair, role, film }));
  });
  S.curPair = current ? S.pairs.findIndex((pair) => pairKey(pair) === pairKey(current)) : -1;
  $('videos').classList.toggle('single', !S.pairs.length);
  $('btn-analyze').hidden = !!S.analyzing || !Object.values(S.splitFilms).some((film) => !film.analysis);
  updateAngleButtons();
  renderFilmSetup();
}

function selectFirstLinked() {
  realign();
  renderList();
  const first = S.visible.find((i) => S.mapping[i] != null);
  if (first != null) selectPlay(first, { autoplay: false });
  else renderInfo();
}

async function openSplitFilms() {
  closeFilm();
  const revision = S.filmRevision;
  const paths = (S.gameData.splitFilmPaths || {})[S.sel.team] || {};
  const errors = [];
  for (const role of ['offense', 'defense', 'special']) {
    if (!paths[role]) continue;
    try {
      const film = await window.api.openFilm(paths[role]);
      if (revision !== S.filmRevision) return;
      S.splitFilms[role] = film;
    } catch (e) {
      if (revision !== S.filmRevision) return;
      errors.push(`${role}: ${e.message}`);
    }
  }
  S.film = S.splitFilms.offense || S.splitFilms.defense || S.splitFilms.special || null;
  $('film-name').textContent = ['offense', 'defense', 'special'].map((role) =>
    `${role === 'special' ? 'Special teams' : `${S.sel.team} ${role}`}: ${paths[role] ? paths[role].split(/[\\/]/).pop() : 'not selected'}`).join(' · ');
  $('film-name').title = $('film-name').textContent;
  rebuildSplitPairs();
  selectFirstLinked();
  if (errors.length) setStatus(`Couldn't open split film: ${errors.join('; ')}`, true);
  if (!S.pairs.length) showMessage('Choose offense, defense, and special-teams film for the selected team. Each file should contain sideline followed by end zone for each play.<br><span class="muted">Each file aligns independently. Plays from files you have not selected remain unlinked.</span>');
  if (S.settings.autoAnalyze && Object.values(S.splitFilms).some((film) => !film.analysis)) await analyze(false);
}

async function openFilm(file) {
  const revision = S.filmRevision;
  try {
    const f = await window.api.openFilm(file);
    if (revision !== S.filmRevision) return;
    S.film = f;
    S.fps = f.info.fps || 59.94;
    $('film-name').textContent = file.split(/[\\/]/).pop();
    $('film-name').title = file;
    const a = vidA(), b = vidB();
    if (a.src !== f.url) { a.src = f.url; b.src = f.url; }
    setAnalysis(f.analysis);
    if (!f.analysis) {
      $('btn-analyze').hidden = false;
      showMessage('This film has not been analyzed yet. Analysis finds each play\'s sideline and end zone clips (about 3–5 minutes per game, done once).');
      if (S.settings.autoAnalyze) analyze(false);
    }
  } catch (e) {
    if (revision !== S.filmRevision) return;
    closeFilm();
    showMessage(`Couldn't open film: ${esc(e.message)}`);
  }
}

function setAnalysis(analysis) {
  if (!analysis) dockAngle();
  S.pairs = analysis ? analysis.pairs : [];
  if (S.film) S.film.analysis = analysis;
  $('videos').classList.toggle('single', !S.pairs.length);
  $('btn-analyze').hidden = !!analysis;
  if (analysis) showMessage('');
  updateAngleButtons();
  renderFilmSetup();
}

async function analyze(force) {
  if (!S.film || S.analyzing) return;
  const revision = S.filmRevision;
  const split = isSplitFilm();
  const films = split ? Object.values(S.splitFilms).filter((film) => force || !film.analysis) : [S.film];
  if (!films.length) return;
  const run = {
    files: new Map(films.map((film) => [film.path, { film, fraction: 0, done: false, error: null }])),
    cancelled: false,
  };
  S.analyzing = run;
  $('progress').hidden = false;
  $('btn-analyze').hidden = true;
  renderAnalysisProgress();
  renderFilmSetup();
  try {
    await Promise.all([...run.files.values()].map(async (job) => {
      try {
        const a = await window.api.analyzeFilm(job.film.path, force);
        if (revision !== S.filmRevision) return;
        const hadPlayback = S.curPair >= 0 && !!S.range;
        const wasCurrentSource = S.film?.path === job.film.path;
        job.film.analysis = a;
        if (split) rebuildSplitPairs();
        else setAnalysis(a);
        if (hadPlayback && !wasCurrentSource) {
          realign();
          renderList();
          renderInfo();
        } else if (S.curPlay >= 0) {
          realign();
          renderList();
          selectPlay(S.curPlay, { autoplay: false, keepSelection: true });
        } else {
          selectFirstLinked();
          if (S.curPair < 0 && S.pairs.length) loadPair(0, { autoplay: false });
        }
      } catch (error) {
        job.error = error.message;
      } finally {
        job.done = true;
        job.fraction = 1;
        if (S.analyzing === run) renderAnalysisProgress();
      }
    }));
    if (revision !== S.filmRevision) return;
    const errors = [...run.files.values()].filter((job) => job.error && !/Cancelled/.test(job.error));
    const cancelled = run.cancelled || [...run.files.values()].some((job) => /Cancelled/.test(job.error || ''));
    const warningCount = [...run.files.values()].reduce((n, job) => n + (job.film.analysis?.warnings?.length || 0), 0);
    if (errors.length) setStatus(`Analysis failed: ${errors.map((job) => `${analysisLabel(job.film)}: ${job.error}`).join('; ')}`, true);
    else if (cancelled) setStatus('Analysis cancelled. Completed film remains available.');
    else setStatus(`Found ${S.pairs.length} plays on film${warningCount ? ` (${warningCount} frame-sampling warnings; details in the analysis cache)` : ''}`, warningCount > 0);
  } catch (e) {
    if (revision === S.filmRevision) {
      $('btn-analyze').hidden = false;
      setStatus(/Cancelled/.test(e.message) ? 'Analysis cancelled' : `Analysis failed: ${e.message}`, !/Cancelled/.test(e.message));
    }
  } finally {
    if (S.analyzing === run) {
      S.analyzing = false;
      $('progress').hidden = true;
      if (isSplitFilm()) rebuildSplitPairs();
      else $('btn-analyze').hidden = !!S.film?.analysis;
      if (isSplitFilm() && S.curPlay >= 0 && S.curPair < 0 && S.mapping[S.curPlay] == null) {
        selectPlay(S.curPlay, { autoplay: false, keepSelection: true });
      }
      renderFilmSetup();
    }
  }
}

function analysisLabel(film) {
  if (!isSplitFilm()) return 'Film';
  const role = Object.keys(S.splitFilms).find((key) => S.splitFilms[key].path === film.path);
  return role === 'special' ? 'Special teams' : role === 'offense' ? 'Offense' : 'Defense';
}

function renderAnalysisProgress(progress) {
  const run = S.analyzing;
  if (!run?.files) return;
  if (progress) {
    const job = run.files.get(progress.file);
    if (!job || job.done) return;
    const phases = { probe: [0, 0.02], scan: [0.02, 0.8], classify: [0.8, 1], done: [1, 1] };
    const [a, b] = phases[progress.phase] || [0, 1];
    job.fraction = Math.max(job.fraction, a + (b - a) * progress.fraction);
    job.message = progress.message;
  }
  const jobs = [...run.files.values()];
  const fraction = jobs.reduce((n, job) => n + job.fraction, 0) / (jobs.length || 1);
  $('progress').querySelector('.fill').style.width = `${Math.round(fraction * 100)}%`;
  $('progress').querySelector('.label').textContent = run.cancelled ? 'Cancelling analysis…' : jobs.map((job) => {
    const state = job.done ? (job.error ? 'stopped' : 'ready') : `${Math.round(job.fraction * 100)}%${jobs.length === 1 && job.message ? ` ${job.message}` : ''}`;
    return `${analysisLabel(job.film)}: ${state}`;
  }).join(' · ');
}

async function cancelAnalysis() {
  const run = S.analyzing;
  if (!run?.files || run.cancelled) return;
  run.cancelled = true;
  renderAnalysisProgress();
  try {
    await Promise.all([...run.files.values()].filter((job) => !job.done)
      .map((job) => window.api.cancelAnalysis(job.film.path)));
  } catch (error) {
    if (S.analyzing === run) {
      run.cancelled = false;
      renderAnalysisProgress();
      setStatus(`Could not cancel analysis: ${error.message}`, true);
    }
  }
}

/* ---------------- play list ---------------- */

const RESULT_FILTERS = {
  key: (p) => p.key.length > 0,
  negative: (p) => p.neg.length > 0,
  sack: (p) => p.flags.sack && p.playType !== 'no_play',
  turnover: (p) => p.key.some((k) => ['INT', 'FUM', 'TOD'].includes(k)) || (p.playType !== 'no_play' && (p.flags.interception || p.flags.fumble_lost)),
  score: (p) => p.key.some((k) => ['TD', 'FG', 'SAF', '2PT'].includes(k)) || (p.playType !== 'no_play' && (p.flags.touchdown || p.fieldGoalResult === 'made')),
  big: (p) => p.key.includes('BIG'),
  firstdown: (p) => p.flags.first_down && p.playType !== 'no_play',
  penalty: (p) => p.flags.penalty,
};

/** Inclusive numeric bounds (S.filter[`${key}Min`/`${key}Max`]); plays without a value are excluded while a bound is set. */
const RANGE_FILTERS = {
  yards: (p) => (p.playType !== 'no_play' && (p.cat === 'run' || p.cat === 'pass') ? p.yards : null),
  air: (p) => p.airYards,
  dist: (p) => p.ydstogo,
};

const YES_NO = [['true', 'Yes'], ['false', 'No']];
/**
 * Advanced select filters. Each is shown only when the loaded game has data for it. Option
 * values match exactly, or as "N+" (at least N) / "<=N" (at most N). `options: 'values'` lists
 * the values present in the game.
 */
const ADV_CHOICES = [
  { key: 'down', label: 'Down', get: (p) => p.down, options: [['1', '1st'], ['2', '2nd'], ['3', '3rd'], ['4', '4th']] },
  { key: 'player', label: 'On-field player', get: (p) => [...(p.onField?.offense || []), ...(p.onField?.defense || [])].map(ADV.playerKey).filter(Boolean), options: 'players' },
  { key: 'offPersonnel', label: 'Off. personnel', get: (p) => p.personnel?.offense, options: 'values', title: 'RB count then TE count (11 = 1 RB, 1 TE, 3 WR)' },
  { key: 'defPackage', label: 'Def. package', get: (p) => p.personnel?.defense, options: 'values', order: ADV.DEFENSE_ORDER, title: '4 DBs: front (DL-LB); 5 DBs: Nickel; 6: Dime; 7+: Quarter; 3 or fewer: Goal line' },
  { key: 'qbLocation', label: 'QB alignment', get: (p) => p.charting?.qbLocation, options: 'values' },
  { key: 'formation', label: 'Formation', get: (p) => p.charting?.formation, options: 'values' },
  { key: 'backfield', label: 'Backfield', get: (p) => p.charting?.backfield, options: [['0', '0 (empty)'], ['1', '1'], ['2', '2'], ['3+', '3+']], title: 'Offensive players in the backfield, excluding the QB' },
  { key: 'box', label: 'Box count', get: (p) => p.charting?.box, options: [['<=5', '5 or fewer'], ['6', '6'], ['7', '7'], ['8+', '8+']], title: 'Defenders in the box at the snap' },
  { key: 'rushers', label: 'Pass rushers', get: (p) => p.charting?.rushers, options: [['<=3', '3 or fewer'], ['4', '4'], ['5+', '5+'], ['6+', '6+']] },
  { key: 'blitzers', label: 'Blitzers', get: (p) => p.charting?.blitzers, options: [['0', 'No blitz'], ['1+', 'Blitz (1+)'], ['2+', '2+']] },
  { key: 'motion', label: 'Motion', get: (p) => p.charting?.motion, options: YES_NO },
  { key: 'playAction', label: 'Play action', get: (p) => p.charting?.playAction, options: YES_NO },
  { key: 'rpo', label: 'RPO', get: (p) => p.charting?.rpo, options: YES_NO },
  { key: 'screen', label: 'Screen', get: (p) => p.charting?.screen, options: YES_NO },
  { key: 'noHuddle', label: 'No-huddle', get: (p) => p.charting?.noHuddle, options: YES_NO },
  { key: 'coverage', label: 'Coverage', get: (p) => p.charting?.coverage, options: 'values' },
  { key: 'manZone', label: 'Man/zone', get: (p) => p.charting?.manZone, options: 'values' },
];

function hasValue(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v != null && v !== '';
}

function choiceMatches(option, v) {
  if (Array.isArray(option)) return option.every((selected) => choiceMatches(selected, v));
  if (Array.isArray(v)) return v.includes(option);
  if (!hasValue(v)) return false;
  if (option.endsWith('+')) return Number(v) >= Number(option.slice(0, -1));
  if (option.startsWith('<=')) return Number(v) <= Number(option.slice(2));
  return String(v) === option;
}

function choiceOptions(spec, sourcePlays = S.plays) {
  if (spec.options === 'players') {
    const players = new Map();
    for (const p of sourcePlays) {
      for (const side of ['offense', 'defense']) {
        for (const player of p.onField?.[side] || []) {
          const key = ADV.playerKey(player);
          const team = (side === 'offense' ? p.posteam : p.defteam) || '';
          const listed = { position: player.position, positionInference: player.positionInference };
          const position = player.position ? ADV.displayPosition(listed) + (player.positionInference ? '*' : '') : '';
          if (key) players.set(key, {
            name: player.name || key,
            label: `${player.name || key} · ${team} ${position}`.trim(), team, positionRank: ADV.playerPositionRank(listed),
          });
        }
      }
    }
    return [...players].map(([key, player]) => [key, player.label, player.name, player]).sort((a, b) => a[1].localeCompare(b[1]));
  }
  if (spec.options !== 'values') return spec.options;
  const values = [...new Set(sourcePlays.map(spec.get).filter(hasValue).map(String))];
  const rank = (v) => (spec.order && spec.order.includes(v) ? spec.order.indexOf(v) : Infinity);
  values.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }));
  return values.map((v) => [v, v]);
}

function activeAdvancedCount() {
  const f = S.filter;
  const ranges = Object.keys(RANGE_FILTERS).filter((k) => f[`${k}Min`] != null || f[`${k}Max`] != null).length;
  return ranges + Object.values(f.choices).reduce((count, value) =>
    count + (Array.isArray(value) ? value.length : value ? 1 : 0), 0);
}

function updateAdvancedIndicator() {
  const n = activeAdvancedCount();
  const el = $('adv-filter-active');
  el.hidden = !n;
  el.textContent = `· ${n} active`;
}

function renderPlayerFilter() {
  const el = $('player-choice');
  if (!el) return;
  const spec = ADV_CHOICES.find(({ key }) => key === 'player');
  const all = choiceOptions(spec);
  const selected = S.filter.choices.player || [];
  const scoped = choiceOptions(spec, S.plays.filter(p => passesFilter(p, 'player')));
  const remaining = scoped.filter(([id]) => !selected.includes(id));
  const counts = new Map();
  for (const play of S.plays) {
    if (!passesFilter(play)) continue;
    for (const id of new Set(spec.get(play))) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const available = remaining.filter(([id]) => (counts.get(id) || 0) > 0);
  const mode = S.settings.playerFilterSort;
  const analyzed = S.sel.team || S.settings.defaultTeam;
  const groups = new Map();
  for (const option of available) {
    const team = option[3].team || '';
    if (!groups.has(team)) groups.set(team, []);
    groups.get(team).push(option);
  }
  const teamRank = team => team === analyzed ? 0 : team ? 1 : 2;
  const groupHtml = [...groups].sort(([a], [b]) => teamRank(a) - teamRank(b) || a.localeCompare(b))
    .map(([team, options]) => {
      options.sort((a, b) => (mode === 'position' ? a[3].positionRank - b[3].positionRank : 0) ||
        (mode === 'plays' || mode === 'position' ? (counts.get(b[0]) || 0) - (counts.get(a[0]) || 0) : 0) ||
        a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]));
      return `<optgroup label="${esc(team ? `${team}${team === analyzed ? ' · Analyzed team' : ''}` : 'Unknown team')}">` +
        options.map(([id, label]) => {
          const count = counts.get(id) || 0;
          return `<option value="${esc(id)}">${esc(label)} (${count} ${count === 1 ? 'play' : 'plays'})</option>`;
        }).join('') + '</optgroup>';
    }).join('');
  const placeholder = available.length ? 'Add player…' : remaining.length || !scoped.length ? 'No players match these filters' : 'All players selected';
  const html = `<label for="on-field-player">On-field players<select id="on-field-player" data-choice="player" aria-describedby="on-field-player-help"${available.length ? '' : ' disabled'}>` +
    `<option value="">${placeholder}</option>` +
    groupHtml +
    `</select></label><ul class="player-filter-tags" aria-label="Selected on-field players">` +
    selected.map((id) => {
      const name = all.find(([v]) => v === id)?.[2] || id;
      return `<li class="player-filter-tag"><span title="${esc(name)}">${esc(name)}</span>` +
        `<button type="button" data-remove-player="${esc(id)}" aria-label="Remove ${esc(name)} from on-field filter" title="Remove ${esc(name)}">&times;</button></li>`;
    }).join('') + `</ul><small id="on-field-player-help" class="muted">Match all selected players. Counts include other filters. Only matching players are listed.</small>`;
  if (el.innerHTML !== html) el.innerHTML = html;
}

/** Builds the select filters available for the loaded game, dropping selections it can't satisfy. */
function renderAdvancedFilters() {
  const html = [];
  const choices = {};
  for (const spec of ADV_CHOICES) {
    if (!S.plays.some((p) => hasValue(spec.get(p)))) continue;
    const opts = choiceOptions(spec);
    const cur = S.filter.choices[spec.key];
    if (spec.options === 'players') {
      const selected = [...new Set(Array.isArray(cur) ? cur : cur ? [cur] : [])].filter((id) => opts.some(([v]) => v === id));
      if (selected.length) choices[spec.key] = selected;
      html.push('<div id="player-choice" class="player-choice"></div>');
      continue;
    }
    if (cur && opts.some(([v]) => v === cur)) choices[spec.key] = cur;
    html.push(`<label${spec.title ? ` title="${esc(spec.title)}"` : ''}>${esc(spec.label)}<select data-choice="${spec.key}">` +
      `<option value="">Any</option>${opts.map(([v, l]) => `<option value="${esc(v)}"${choices[spec.key] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`);
  }
  S.filter.choices = choices;
  $('adv-choices').innerHTML = html.join('');
  renderPlayerFilter();
  $('adv-note').hidden = !S.plays.length || S.plays.some((p) => p.personnel || p.charting);
  updateAdvancedIndicator();
}

function setAdvancedChoice(key, value) {
  if (key === 'player') {
    if (!value) return;
    S.filter.choices.player = [...new Set([...(S.filter.choices.player || []), value])];
    renderAdvancedFilters();
    $('on-field-player').focus();
  } else {
    S.filter.choices[key] = value;
  }
  updateAdvancedIndicator();
  renderList();
}

function removePlayerFilter(id) {
  S.filter.choices.player = (S.filter.choices.player || []).filter((selected) => selected !== id);
  renderAdvancedFilters();
  renderList();
  $('on-field-player').focus();
}

function passesFilter(p, excludedChoice) {
  const f = S.filter;
  if (['run', 'pass', 'special'].includes(f.type) && p.cat !== f.type) return false;
  if (f.offense && p.posteam !== f.offense) return false;
  if (f.qtr && String(p.qtr) !== f.qtr) return false;
  if (f.result && RESULT_FILTERS[f.result] && !RESULT_FILTERS[f.result](p)) return false;
  for (const [key, get] of Object.entries(RANGE_FILTERS)) {
    const min = f[`${key}Min`];
    const max = f[`${key}Max`];
    if (min == null && max == null) continue;
    const v = get(p);
    if (v == null) return false;
    if (min != null && v < min) return false;
    if (max != null && v > max) return false;
  }
  for (const spec of ADV_CHOICES) {
    if (spec.key === excludedChoice) continue;
    const option = f.choices[spec.key];
    if (option && !choiceMatches(option, spec.get(p))) return false;
  }
  if (f.text) {
    for (const w of f.text.toLowerCase().split(/\s+/).filter(Boolean)) if (!p.searchText.includes(w)) return false;
  }
  return true;
}

function renderQuarters() {
  const qs = [...new Set(S.plays.map((p) => p.qtr).filter((q) => q != null))].sort((a, b) => a - b);
  const opts = [{ value: '', label: 'All quarters' }].concat(qs.map((q) => ({ value: String(q), label: q >= 5 ? (q === 5 ? 'OT' : `OT${q - 4}`) : `Q${q}` })));
  if (!opts.some((o) => o.value === S.filter.qtr)) S.filter.qtr = '';
  fillSelect($('sel-qtr'), opts, S.filter.qtr);
}

function renderParticipationStatus() {
  const imported = S.plays.filter((p) => p.participation?.source === 'NFL Pro');
  const el = $('participation-status');
  el.hidden = !S.game || (!S.settings.participationRoot && !imported.length);
  if (el.hidden) return;
  const complete = imported.filter((p) => p.participation.status === 'complete').length;
  const summary = imported.length
    ? `NFL Pro: ${imported.length} ${imported.length === 1 ? 'play' : 'plays'} imported · ${complete} complete, ${imported.length - complete} partial`
    : 'NFL Pro: no matching plays imported yet';
  const notice = S.participationWarning
    ? `Data warning: ${S.participationWarning}`
    : S.participationNotice || 'Watching the configured CSV folder. No manual refresh needed.';
  if ($('participation-summary').textContent !== summary) $('participation-summary').textContent = summary;
  if ($('participation-notice').textContent !== notice) $('participation-notice').textContent = notice;
  el.classList.toggle('warning', !!S.participationWarning);
}

function renderList() {
  S.visible = [];
  const html = [];
  const anchors = corrections().anchors || {};
  let drive = null;
  let shade = false;
  S.plays.forEach((p, i) => {
    if (!passesFilter(p)) return;
    S.visible.push(i);
    const dkey = `${p.driveNum}`;
    if (dkey !== drive) {
      drive = dkey;
      shade = !shade;
      html.push(driveHeader(p, i));
    }
    const noFilm = S.pairs.length && S.mapping[i] == null;
    const cls = [p.cat, p.key.length ? 'key' : '', p.neg.length ? 'neg' : '', noFilm ? 'nofilm' : '', i === S.curPlay ? 'sel' : '', shade ? 'shade' : ''].join(' ');
    const badges = p.key.concat(p.neg).map((k) => `<span class="badge ${k}">${k}</span>`);
    if (String(p.playId) in anchors) badges.push('<span class="badge fix" title="Manually corrected">✎</span>');
    if (noFilm) badges.push('<span class="badge nofilm">no film</span>');
    html.push(
      `<li data-i="${i}" class="${cls}"><div class="r1"><input class="play-check" type="checkbox" hidden aria-label="Select ${esc(P.clockLabel(p))} for export"${S.selected.has(i) ? ' checked' : ''} /><span class="clock">${esc(P.clockLabel(p))}</span>` +
        `<span class="dd">${esc(P.downDistance(p))}</span><span class="team">${esc(p.yrdln)}</span>${personnelHtml(p)}` +
        `<span class="badges">${badges.join('')}</span></div>${boxHtml(p)}<div class="desc">${esc(p.desc)}</div></li>`
    );
  });
  $('play-list').innerHTML = html.join('') || `<li class="muted" style="cursor:default">${S.plays.length ? 'No plays match the filters.' : S.game ? 'No play-by-play available for this game yet.' : ''}</li>`;
  const filmed = S.mapping.filter((x) => x != null).length;
  $('list-footer').textContent = S.plays.length
    ? `${S.visible.length} of ${S.plays.length} plays shown · ${S.pairs.length ? `${filmed} linked to ${S.pairs.length} film clips` : 'film not analyzed'}`
    : '';
  scrollToSelected();
  updateSelection();
  renderParticipationStatus();
  renderPlayerFilter();
}

function boxHtml(p) {
  const b = p.box;
  return `<div class="box"><span class="who">${esc(b.who)}</span>` +
    (b.yards ? `<span class="yds ${b.tone}">${esc(b.yards)}</span>` : '') +
    (b.result ? `<span class="res ${b.tone}">${esc(b.result)}</span>` : '') +
    (p.airYards != null ? `<span class="res" title="Pass depth from the line of scrimmage, excluding yards after catch">Air: ${esc(p.airYards)} yd</span>` : '') +
    (b.penalty ? `<span class="pen" title="${esc(b.penalty)}">PEN</span>` : '') + '</div>';
}

function personnelHtml(p) {
  const pers = p.personnel;
  if (!pers || (!pers.offense && !pers.defense)) return '';
  const text = [pers.offense, pers.defense].filter(Boolean).join(' v ');
  return `<span class="pers" title="${pers.inferred ? 'Inferred from listed player positions, not charted alignment' : 'Offensive personnel v defensive package'}">${esc(text)}${pers.inferred ? '*' : ''}</span>`;
}

function playerLine(pl) {
  const num = pl.number ? `#${pl.number} ` : '';
  const inferred = !pl.eligibleReceiver && pl.positionInference;
  const title = pl.eligibleReceiver ? `Eligible lineman reported in play description; listed ${pl.position}` :
    inferred ? `${inferred.source}, ${inferred.asOf}; inferred, not confirmed snap alignment; listed ${pl.position}` : `Listed position: ${pl.position || 'unknown'}`;
  return `<li><span class="pos" title="${esc(title)}">${esc(ADV.displayPosition(pl))}${inferred ? '*' : ''}</span>${esc(num)}${esc(pl.name || `Unknown player${pl.id ? ` (${pl.id})` : ''}`)}</li>`;
}

function renderAdvancedInfo(p) {
  const tags = p ? ADV.tags(p) : [];
  if (p?.personnel?.inferred) tags.push('Personnel inferred from positions');
  if (p?.participation) tags.push(`${p.participation.source} participation · ${p.participation.status}`);
  $('play-adv').innerHTML = tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  const onField = p && p.onField;
  const box = $('on-field');
  box.hidden = !onField;
  if (!onField) return;
  const side = (title, key) => `<div><h4>${esc(title)}</h4><ul>${ADV.orderedPlayers(p, key).map(playerLine).join('')}</ul></div>`;
  const notes = [];
  if (onField.offense.some(player => player.positionInference)) notes.push('* Depth-chart inference, not confirmed snap alignment.');
  if (onField.offense.some(player => player.eligibleReceiver)) notes.push('OL-E: extra lineman explicitly reported eligible in the play description.');
  $('on-field-lists').innerHTML = side(`${p.posteam} offense`, 'offense') + side(`${p.defteam} defense`, 'defense') +
    (notes.length ? `<p class="position-note muted">${esc(notes.join(' '))}</p>` : '');
}

function driveHeader(p) {
  const bits = [];
  if (p.drivePlays != null) bits.push(`${p.drivePlays} play${p.drivePlays === 1 ? '' : 's'}`);
  if (p.driveYards != null) bits.push(`${p.driveYards} yds`);
  if (p.driveTop) bits.push(p.driveTop);
  const res = P.driveLabel(p);
  const tone = /touchdown|field goal/i.test(res) ? 'good' : /turnover|interception|fumble|safety|downs/i.test(res) ? 'bad' : '';
  const team = p.posteam ? `<span class="dteam">${esc(p.posteam)}</span>` : '';
  return `<li class="drive-head">${team}<span>Drive ${esc(p.driveNum ?? '')}</span>` +
    `<span class="muted">${esc(bits.join(' · '))}</span>${res ? `<span class="dres ${tone}">${esc(res)}</span>` : ''}</li>`;
}

function scrollToSelected() {
  const el = $('play-list').querySelector('li.sel');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function markSelected() {
  $('play-list').querySelectorAll('li.sel').forEach((el) => el.classList.remove('sel'));
  const el = $('play-list').querySelector(`li[data-i="${S.curPlay}"]`);
  if (el) { el.classList.add('sel'); el.scrollIntoView({ block: 'nearest' }); }
}

/* ---------------- info panel ---------------- */

function renderInfo() {
  const p = S.plays[S.curPlay];
  const head = $('play-head');
  if (p) {
    const swatch = `<i class="sw ${p.cat === 'other' ? 'penalty' : p.cat}"></i>`;
    head.innerHTML = `${swatch}<span>${esc(P.clockLabel(p))}</span><span>${esc(P.downDistance(p))}${p.yrdln ? ' at ' + esc(p.yrdln) : ''}</span>` +
      `<span class="muted">${esc(p.posteam)} ball</span>${boxHtml(p)}` +
      p.key.concat(p.neg).map((k) => `<span class="badge ${k}">${k}</span>`).join('');
    $('play-desc').textContent = p.desc;
    renderAdvancedInfo(p);
  } else {
    renderAdvancedInfo(null);
    head.textContent = S.curPair >= 0 ? `Film clip ${S.curPair + 1}` : '';
    $('play-desc').textContent = '';
  }
  const pairInfo = S.curPair >= 0 && S.pairs[S.curPair]
    ? `Clip ${S.curPair + 1} / ${S.pairs.length} @ ${fmtTime(S.pairs[S.curPair].sideline.start)}`
    : S.pairs.length ? 'No clip' : '';
  const linked = p && S.mapping[S.curPlay] === S.curPair;
  $('clip-label').textContent = pairInfo + (p && S.curPair >= 0 && !linked ? '  (browsing — not linked to this play)' : '');
  updateOffsetLabel();
}

/* ---------------- playback ---------------- */

const angleVideos = {};
const vidA = () => angleVideos.a || $('vidA');
const vidB = () => angleVideos.b || $('vidB');
let detachedAngle = null;
let closingWindow = false;
let playbackFrame = null;

function updateAngleButtons() {
  $('pop-a').disabled = $('pop-b').disabled = !S.film || !S.pairs.length || !!detachedAngle;
}

function popAngle(key) {
  if (detachedAngle || !S.film || !S.pairs.length) return;
  const popup = window.open('angle.html', 'a22-angle', 'width=1100,height=700');
  if (!popup) {
    showMessage('Could not open the angle window.');
    return;
  }
  const video = key === 'a' ? vidA() : vidB();
  const figure = $(key === 'a' ? 'figA' : 'figB');
  angleVideos[key] = video;
  const closedTimer = window.setInterval(() => {
    if (popup.closed) dockAngle(false);
  }, 250);
  detachedAngle = { popup, video, figure, key, closedTimer };
  updateAngleButtons();
}

function attachAngleWindow(popup) {
  if (!detachedAngle || detachedAngle.popup !== popup) return;
  const { video, figure, key } = detachedAngle;
  const name = key === 'a' ? 'Sideline' : 'End zone';
  const doc = popup.document;
  doc.title = `${name} - AMP22`;
  doc.getElementById('angle-name').textContent = name;
  const rel = currentRel();
  const playing = S.playing;
  pause();
  // Keep the original player and its event handlers on the shared playback clock.
  doc.getElementById('angle-stage').appendChild(video);
  figure.classList.add('detached');
  $('detached-label').textContent = `${name} is in a separate window. Drag it to another display.`;
  $('detached-angle').hidden = false;
  seekRel(rel);
  resetDrift();
  if (playing) play();
  popup.addEventListener('keydown', handleKeydown, true);
  doc.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      button.blur();
      runAction(button.dataset.action);
    });
  });
  doc.getElementById('angle-return').addEventListener('click', () => dockAngle());
  doc.getElementById('angle-fullscreen').addEventListener('click', () => {
    const request = doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen();
    request.catch((e) => { doc.getElementById('angle-error').textContent = `Could not change fullscreen: ${e.message}`; });
  });
  doc.addEventListener('fullscreenchange', () => {
    doc.getElementById('angle-fullscreen').textContent = doc.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  });
  popup.addEventListener('beforeunload', () => dockAngle(false));
}

function dockAngle(close = true) {
  if (!detachedAngle) return;
  const { popup, video, figure, closedTimer } = detachedAngle;
  detachedAngle = null;
  window.clearInterval(closedTimer);
  const rel = currentRel();
  const playing = S.playing;
  pause();
  figure.prepend(video);
  figure.classList.remove('detached');
  $('detached-angle').hidden = true;
  resetDrift();
  if (!closingWindow) {
    seekRel(rel);
    if (playing) play();
  }
  updateAngleButtons();
  if (close && !popup.closed) popup.close();
}

window.addEventListener('beforeunload', () => {
  closingWindow = true;
  dockAngle();
});

function setVideoTime(v, t) {
  v._target = t;
  if (v.readyState === 0 || v.seeking) { v._pending = t; return; }
  v.currentTime = t;
}
function onSeeked(e) {
  const v = e.target;
  if (v._pending != null) {
    const t = v._pending;
    v._pending = null;
    v.currentTime = t;
  }
}
function snap(t) {
  return (Math.floor(t * S.fps + 1e-6) + 0.25) / S.fps;
}
function snapRel(rel) {
  return Math.round(rel * S.fps) / S.fps;
}
function offsetFrames(pairIdx) {
  const pair = S.pairs[pairIdx];
  if (!pair) return 0;
  return (corrections().offsets || {})[pairKey(pair)] || 0;
}

function computeRange(pairIdx) {
  const pair = S.pairs[pairIdx];
  const off = offsetFrames(pairIdx) / S.fps;
  const aStart = pair.sideline.start + START_PAD;
  const bStart = pair.endzone.start + START_PAD + off;
  const trim = END_TRIM_FRAMES / S.fps;
  const len = Math.max(0.2, Math.min(pair.sideline.end - aStart, pair.endzone.end - bStart) - trim);
  return { aStart, bStart, len };
}

function currentRel() {
  if (!S.range) return vidA().currentTime;
  const a = vidA();
  const t = !S.playing && a._target != null ? a._target : a.currentTime;
  return t - S.range.aStart;
}

function seekRel(rel) {
  if (!S.range) {
    const a = vidA();
    const t = Math.max(0, Math.min(a.duration || 0, rel));
    setVideoTime(a, snap(t));
    updateTimeUI(t);
    return;
  }
  rel = snapRel(Math.max(0, Math.min(S.range.len, rel)));
  setVideoTime(vidA(), S.range.aStart + rel);
  setVideoTime(vidB(), S.range.bStart + rel);
  updateTimeUI(rel);
}

function loadPair(pairIdx, { autoplay = false, keepRel = false } = {}) {
  if (!S.pairs[pairIdx]) return;
  const rel = keepRel ? currentRel() : 0;
  const wasPlaying = S.playing;
  pause();
  const film = S.pairs[pairIdx].film;
  if (film) {
    S.film = film;
    S.fps = film.info.fps || 59.94;
    if (vidA().src !== film.url) {
      for (const video of [vidA(), vidB()]) {
        video._pending = null;
        video._target = null;
        video.src = film.url;
      }
      resetDrift();
    }
  }
  S.curPair = pairIdx;
  S.range = computeRange(pairIdx);
  S.filmSetupOpen = false;
  showMessage('');
  seekRel(rel);
  renderInfo();
  if (autoplay || (keepRel && wasPlaying)) play();
}

function selectPlay(i, { autoplay = true, keepSelection = false } = {}) {
  if (!S.plays[i]) return;
  if (!keepSelection) {
    S.selected = new Set([i]);
    S.selectionAnchor = i;
    S.multiSelect = false;
  }
  S.curPlay = i;
  markSelected();
  updateSelection();
  const role = isSplitFilm() ? A22.align.filmRole(S.plays[i], S.sel.team) : null;
  const source = role ? S.splitFilms[role] : null;
  const pi = S.mapping[i];
  if (pi != null && S.pairs[pi]) {
    loadPair(pi, { autoplay });
  } else {
    pause();
    S.curPair = -1;
    S.range = null;
    renderInfo();
    if (isSplitFilm() && !role) {
      showMessage('This play cannot be classified as offense, defense, or special teams and has no linked film.');
    } else if (isSplitFilm() && !source) {
      S.filmSetupOpen = true;
      showMessage('Choose the matching offense, defense, or special-teams file to watch this play.');
    } else if (isSplitFilm() && !source.analysis) {
      const job = S.analyzing?.files?.get(source.path);
      showMessage(job && !job.done
        ? 'This play’s film is still processing. You can watch plays from completed files while it finishes.'
        : 'This play’s film has not finished analysis. Open Film setup and choose Analyze film to retry.');
    } else if (S.film && S.pairs.length) showMessage('No film linked to this play.<br><span class="muted">Browse clips with Shift+↑/↓ and press Shift+L to link one.</span>');
  }
}

/* ---------------- clip export ---------------- */

function updateSelection() {
  const multi = S.multiSelect || S.selected.size > 1;
  $('selection-bar').hidden = !multi;
  $('selection-count').textContent = `${S.selected.size} selected`;
  $('selection-count').hidden = !multi;
  $('btn-clear-selection').hidden = !multi;
  $('btn-clear-selection').disabled = !S.selected.size;
  $('btn-multi-select').setAttribute('aria-pressed', String(multi));
  $('btn-share').disabled = S.exporting || !S.selected.size || !S.film || !S.pairs.length;
  $('btn-export-data').disabled = !S.plays.length;
  $('play-list').querySelectorAll('li[data-i]').forEach((el) => {
    const selected = S.selected.has(Number(el.dataset.i));
    el.classList.toggle('export-selected', selected && multi);
    el.querySelector('.play-check').hidden = !multi;
    el.querySelector('.play-check').checked = selected;
  });
}

function drawWrapped(ctx, text, x, y, width, lineHeight, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((value, i) => {
    if (i === maxLines - 1 && lines.length > maxLines) value += '…';
    while (ctx.measureText(value).width > width && value.length > 1) value = value.slice(0, -2) + '…';
    ctx.strokeText(value, x, y + i * lineHeight);
    ctx.fillText(value, x, y + i * lineHeight);
  });
}

function trimHeadshot(image) {
  const source = document.createElement('canvas');
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const ctx = source.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, source.width, source.height);
  let left = source.width, top = source.height, right = -1, bottom = -1;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (!data[(y * source.width + x) * 4 + 3]) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('Headshot is fully transparent');
  const cropped = document.createElement('canvas');
  cropped.width = right - left + 1;
  cropped.height = bottom - top + 1;
  cropped.getContext('2d').drawImage(source, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return cropped;
}

function drawHeadshot(ctx, image, x, y, size) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(size / sourceWidth, size / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  ctx.drawImage(image, x + (size - width) / 2, y + size - height, width, height);
}

function buildPlayCard(play, mode, matchup, headshot = null, position, appearance = currentOverlayAppearance()) {
  position = A22.clipExport.overlayPosition(position);
  const { width, height } = A22.clipExport.dimensions(mode);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const both = mode === 'both';
  const color = appearance.accent;
  const context = [P.clockLabel(play), P.downDistance(play), play.yrdln, play.posteam && `${play.posteam} ball`].filter(Boolean).join('  ·  ');
  const box = play.box;
  const summary = P.overlaySummary(play);
  const notes = [box.penalty, ...play.key, ...play.neg].filter(Boolean).join('  ·  ');
  ctx.textBaseline = 'top';
  ctx.strokeStyle = appearance.outline;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  function background(x, y, w, h) {
    ctx.fillStyle = appearance.background;
    ctx.globalAlpha = appearance.opacity;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = appearance.text;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.strokeStyle = appearance.outline;
    ctx.lineWidth = 3;
  }
  if (!both || position.preset !== 'original') {
    const padding = 24;
    const photoSpace = headshot ? 148 : 0;
    const maxWidth = Math.floor(width * (both ? 0.9 : 0.72)) - padding * 2 - photoSpace;
    const rows = [
      { text: context, font: '24px sans-serif', color: appearance.text, height: 28 },
      { text: summary, font: 'bold 32px sans-serif', color: appearance.text, height: 38 },
      { text: notes, font: '22px sans-serif', color: appearance.text, height: 26 },
    ].filter((row) => row.text);
    const contentWidth = Math.ceil(Math.min(maxWidth, Math.max(0, ...rows.map((row) => {
      ctx.font = row.font;
      return ctx.measureText(row.text).width;
    }))));
    const cardWidth = contentWidth + padding * 2 + photoSpace;
    const contentHeight = Math.max(headshot ? 128 : 0, rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * 10);
    const cardHeight = padding * 2 + contentHeight;
    const bounds = A22.clipExport.overlayBounds(mode, cardWidth, cardHeight, position);
    const { x: left, y: top } = bounds;
    background(left, top, cardWidth, cardHeight);
    ctx.fillStyle = color;
    ctx.fillRect(left, top, 4, cardHeight);
    if (headshot) drawHeadshot(ctx, headshot, left + padding, top + padding + (contentHeight - 128) / 2, 128);
    let y = top + padding;
    for (const row of rows) {
      ctx.font = row.font;
      ctx.fillStyle = row.color;
      drawWrapped(ctx, row.text, left + padding + photoSpace, y, contentWidth, row.height, 1);
      y += row.height + 10;
    }
    return { canvas, bounds };
  }
  const top = 1216;
  const left = 48;
  const available = width - left * 2;
  background(0, top, width, height - top);
  ctx.fillStyle = color;
  ctx.fillRect(0, top, width, 8);
  ctx.fillStyle = appearance.text;
  ctx.font = '28px sans-serif';
  drawWrapped(ctx, matchup, left, top + 32, available, 34, 1);
  ctx.fillStyle = appearance.text;
  ctx.font = '32px sans-serif';
  drawWrapped(ctx, context, left, top + 80, available, 40, 1);
  ctx.font = 'bold 42px sans-serif';
  const photoSpace = headshot ? 232 : 0;
  if (headshot) drawHeadshot(ctx, headshot, left, top + 130, 208);
  drawWrapped(ctx, summary, left + photoSpace, top + 138, available - photoSpace, 52, 2);
  ctx.font = '30px sans-serif';
  ctx.fillStyle = appearance.text;
  drawWrapped(ctx, notes, left + photoSpace, top + 252, available - photoSpace, 38, 2);
  ctx.fillStyle = appearance.text;
  ctx.font = '32px sans-serif';
  drawWrapped(ctx, play.desc, left, top + 350, available, 42, 7);
  return { canvas, bounds: { x: 0, y: top, width, height: height - top } };
}

function playCard(play, mode, matchup, headshot = null, position, appearance) {
  return buildPlayCard(play, mode, matchup, headshot, position, appearance).canvas.toDataURL('image/png');
}

let headshotQueue = Promise.resolve();

async function prepareHeadshots(clips) {
  const previous = headshotQueue;
  let release;
  headshotQueue = new Promise((resolve) => { release = resolve; });
  await previous;
  try { return await loadHeadshots(clips); }
  finally { release(); }
}

async function loadHeadshots(clips) {
  const players = clips.map(({ play }) => P.primaryPlayer(play)).filter(Boolean);
  const byId = new Map(players.filter((player) => player.id).map((player) => [player.id, player]));
  const images = new Map();
  const warnings = new Set(players.filter((player) => !player.id).map((player) => `${player.name}: no player ID available`));
  if (!byId.size) return { images, warnings };
  const results = await window.api.getHeadshots([...byId.keys()]);
  for (const result of results) {
    if (S.exportCancelRequested) break;
    const player = byId.get(result.id);
    if (result.warning) warnings.add(`${player.name || player.id}: ${result.warning}`);
    if (!result.dataUrl) continue;
    try {
      const image = new Image();
      image.src = result.dataUrl;
      await image.decode();
      images.set(result.id, trimHeadshot(image));
    } catch (e) {
      warnings.add(`${player.name || player.id}: could not decode headshot (${e.message})`);
    }
  }
  return { images, warnings };
}

function openShare() {
  pause();
  toggleOverlay('share', true);
  $('share-status').textContent = '';
  $('share-status').classList.remove('error');
  $('share-progress').hidden = true;
  $('share-reveal').hidden = true;
  S.exportDraft = null;
  ++previewRevision;
  clearTimeout(previewTimer);
  $('share-preview-a').hidden = true;
  $('share-preview-b').hidden = true;
  $('share-preview-figure-a').hidden = true;
  $('share-preview-figure-b').hidden = true;
  $('share-preview-status').textContent = '';
  $('share-preview-play').innerHTML = '';
  $('share-overlay-seconds').value = S.settings.overlaySeconds;
  $('share-overlay-seconds').disabled = $('share-clean').checked;
  sharePosition = A22.clipExport.overlayPosition(S.settings.overlayPosition);
  shareTheme = S.settings.overlayTheme == null ? null : A22.overlay.theme(S.settings.overlayTheme);
  shareOpacity = S.settings.overlayOpacity;
  $('share-theme-name').value = '';
  $('share-theme-status').textContent = '';
  renderThemeOptions(shareTheme ? 'custom' : 'auto');
  positionDrag = null;
  positionFrames = null;
  positionHeadshots = null;
  positionHeadshotPromise = null;
  $('share-position-saved').textContent = '';
  $('share-location-name').value = '';
  renderPositionOptions();
  updatePositionControls();
  const report = REPORT.mergeOptions(S.settings.playReport);
  $('share-report-format').value = report.format;
  $('share-report-advanced').checked = report.includeAdvanced;
  updateReportOptions();
  const indices = A22.clipExport.selectedIndices(S.selected);
  $('share-summary').textContent = `${indices.length} play${indices.length === 1 ? '' : 's'} in game order, joined into one video.`;
  try {
    if (!S.film || !indices.length) throw new Error('Select at least one play with film.');
    const clips = indices.map((i) => {
      const pairIdx = S.mapping[i];
      if (pairIdx == null || !S.pairs[pairIdx]) throw new Error(`${P.clockLabel(S.plays[i])} has no linked film. Deselect it or link its film before exporting.`);
      const pair = S.pairs[pairIdx];
      const film = pair.film || S.film;
      return { ...A22.clipExport.clipRange(pair, film.info.fps || 59.94, offsetFrames(pairIdx)), file: film.path, play: S.plays[i], playNumber: i + 1, trim: S.settings.exportTrim };
    });
    const matchup = S.game ? `${S.game.awayTeam} at ${S.game.homeTeam} · ${S.game.season} · Week ${S.game.week}` : 'AMP22';
    S.exportDraft = { file: S.film.path, clips, matchup, team: S.sel.team || S.settings.defaultTeam };
    $('share-preview-play').innerHTML = clips.map(({ play }, i) => `<option value="${i}">${i + 1}. ${esc(P.clockLabel(play))} · ${esc(P.overlaySummary(play))}</option>`).join('');
    selectTrimPlay();
  } catch (e) {
    $('share-status').textContent = e.message;
    $('share-status').classList.add('error');
  }
  updateExportOptions();
  $('share-angle').focus();
}

function trimmedExportClips() {
  return S.exportDraft.clips.map(({ trim, ...clip }, i) => {
    try { return A22.clipExport.trimRange(clip, trim); }
    catch (e) { throw new Error(`Play ${i + 1} (${P.clockLabel(clip.play)}): ${e.message}`); }
  });
}

function updateExportOptions() {
  try {
    if (!S.exportDraft) {
      $('share-export').disabled = true;
      return;
    }
    trimmedExportClips();
    const seconds = $('share-overlay-seconds').valueAsNumber;
    if (!$('share-clean').checked && (!Number.isFinite(seconds) || seconds < 0)) throw new Error('Overlay duration must be zero or more seconds.');
    $('share-status').textContent = '';
    $('share-status').classList.remove('error');
    $('share-export').disabled = S.exporting || positionSaving;
  } catch (e) {
    $('share-status').textContent = e.message;
    $('share-status').classList.add('error');
    $('share-export').disabled = true;
  }
}

let previewRevision = 0;
let previewTimer = null;
let sharePosition = { preset: 'original' };
let positionFrames = null;
let positionHeadshots = null;
let positionHeadshotPromise = null;
let positionBounds = null;
let positionDrag = null;
let positionSaving = false;
let shareTheme = null;
let shareOpacity = A22.overlay.DEFAULT_OPACITY;

function currentOverlayAppearance() {
  return A22.overlay.appearance(shareTheme, shareOpacity, S.exportDraft?.team || S.sel.team || S.settings.defaultTeam);
}

function renderThemeOptions(selected) {
  const team = S.sel.team || S.settings.defaultTeam;
  $('share-theme').innerHTML = `<option value="auto">Automatic · ${esc(A22.teams.teamName(team))}</option>` +
    Object.keys(A22.teams.TEAMS).map((id) => `<option value="team-${id}">${esc(A22.teams.teamName(id))}</option>`).join('') +
    S.settings.overlayThemes.map((item, i) => `<option value="saved-${i}">${esc(item.name)}</option>`).join('') +
    '<option value="custom">Custom / modified</option>';
  $('share-theme').value = selected;
}

function updateThemeControls() {
  $('share-theming').disabled = S.exporting || positionSaving || $('share-clean').checked;
  const appearance = currentOverlayAppearance();
  $('share-theme-background').value = appearance.background;
  $('share-theme-accent').value = appearance.accent;
  $('share-opacity').value = shareOpacity * 100;
  $('share-opacity-value').textContent = `${Math.round(shareOpacity * 100)}%`;
  $('share-theme-delete').disabled = !$('share-theme').value.startsWith('saved-');
}

async function saveThemePreference(action) {
  if (positionSaving || S.exporting || $('share-clean').checked) return;
  const next = { ...S.settings, overlayThemes: S.settings.overlayThemes.slice() };
  const selected = $('share-theme').value;
  let message;
  let selection = selected;
  if (action === 'default') {
    next.overlayTheme = shareTheme == null ? null : A22.overlay.theme(shareTheme);
    next.overlayOpacity = shareOpacity;
    message = 'Theme and opacity defaults saved for future exports.';
  } else if (action === 'delete') {
    if (!selected.startsWith('saved-')) return;
    next.overlayThemes.splice(Number(selected.slice(6)), 1);
    selection = 'custom';
    message = 'Saved theme deleted. Current colors and defaults are unchanged.';
  } else {
    const name = $('share-theme-name').value.trim();
    if (!name || name.length > 60) {
      $('share-theme-status').textContent = 'Enter a theme name (1-60 characters).';
      return;
    }
    const item = { name, ...A22.overlay.theme(currentOverlayAppearance()) };
    let index = next.overlayThemes.findIndex((saved) => saved.name === name);
    if (index < 0) index = next.overlayThemes.length;
    next.overlayThemes[index] = item;
    shareTheme = A22.overlay.theme(item);
    selection = `saved-${index}`;
    message = `Theme "${name}" saved. Use Make theme / opacity default for future exports.`;
  }
  positionSaving = true;
  updatePositionControls();
  updateExportOptions();
  try {
    S.settings = mergeSettings(await window.api.saveSettings(next));
    renderThemeOptions(selection);
    $('share-theme-status').textContent = message;
  } catch (e) {
    $('share-theme-status').textContent = `Could not save overlay theme: ${e.message}`;
  } finally {
    positionSaving = false;
    updatePositionControls();
    updateExportOptions();
  }
}

function renderPositionOptions(selected) {
  const labels = ['Original layout', 'Top left', 'Top right', 'Bottom left', 'Bottom right', 'Custom (drag or adjust below)'];
  $('share-position').innerHTML = A22.clipExport.OVERLAY_PRESETS.map((value, i) =>
    `<option value="${value}">${labels[i]}</option>`).join('') +
    S.settings.overlayLocations.map((location, i) => `<option value="saved-${i}">${esc(location.name)}</option>`).join('');
  $('share-position').value = selected || sharePosition.preset;
  $('share-location-delete').disabled = !$('share-position').value.startsWith('saved-');
}

function updatePositionControls() {
  updateThemeControls();
  $('share-positioning').disabled = S.exporting || positionSaving || $('share-clean').checked;
  const custom = sharePosition.preset === 'custom';
  $('share-position-x').value = custom ? sharePosition.x * 100 : sharePosition.preset.endsWith('right') ? 100 : 0;
  $('share-position-y').value = custom ? sharePosition.y * 100 : sharePosition.preset.startsWith('top') ? 0 : 100;
  $('share-position-preview').setAttribute('aria-disabled', String($('share-positioning').disabled));
  renderPositionPreview();
}

async function loadPositionHeadshots() {
  if (!S.exportDraft || $('share-clean').checked || !($('share-overlay-seconds').valueAsNumber > 0) || positionHeadshots || positionHeadshotPromise) return;
  const currentDraft = S.exportDraft;
  const pending = prepareHeadshots(currentDraft.clips);
  positionHeadshotPromise = pending;
  try {
    const result = await pending;
    if (S.exportDraft !== currentDraft || $('share').hidden) return;
    positionHeadshots = result;
    renderPositionPreview();
  } catch (e) {
    if (S.exportDraft === currentDraft && !$('share').hidden) {
      $('share-position-status').textContent = `Headshot preview unavailable: ${e.message}`;
    }
  } finally {
    if (positionHeadshotPromise === pending) positionHeadshotPromise = null;
  }
}

function renderPositionPreview() {
  const canvas = $('share-position-preview');
  const clip = S.exportDraft?.clips[Number($('share-preview-play').value)];
  const mode = $('share-angle').value;
  const clean = $('share-clean').checked;
  canvas.hidden = !positionFrames || positionFrames.clip !== clip || positionFrames.mode !== mode;
  positionBounds = null;
  if (canvas.hidden) return;
  const { width, height } = A22.clipExport.dimensions(mode);
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = mode === 'both' ? '236px' : '100%';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = clean || sharePosition.preset !== 'original' ? 'black' : '#0d1117';
  ctx.fillRect(0, 0, width, height);
  function drawFrame(image, x, y, w, h) {
    const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
    const iw = image.naturalWidth * scale, ih = image.naturalHeight * scale;
    ctx.drawImage(image, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }
  if (mode === 'both') {
    const top = clean || sharePosition.preset !== 'original' ? 352 : 0;
    drawFrame($('share-preview-a'), 0, top, 1080, 608);
    drawFrame($('share-preview-b'), 0, top + 608, 1080, 608);
  } else {
    drawFrame($(mode === 'endzone' || mode === 'endzone-first' ? 'share-preview-b' : 'share-preview-a'), 0, 0, width, height);
  }
  if (!clean && $('share-overlay-seconds').valueAsNumber > 0) {
    const card = buildPlayCard(clip.play, mode, S.exportDraft.matchup,
      positionHeadshots?.images.get(P.primaryPlayer(clip.play)?.id), sharePosition);
    ctx.drawImage(card.canvas, 0, 0);
    positionBounds = card.bounds;
    if (sharePosition.preset !== 'custom') {
      $('share-position-x').value = positionBounds.x / Math.max(1, width - positionBounds.width) * 100;
      $('share-position-y').value = positionBounds.y / Math.max(1, height - positionBounds.height) * 100;
    }
  }
  const warnings = positionHeadshots?.warnings;
  $('share-position-status').textContent = clean ? 'Clean export: overlays are disabled.'
    : $('share-overlay-seconds').valueAsNumber === 0 ? 'Overlay duration is zero: overlays are hidden.'
    : `First retained frame${mode.endsWith('-first') ? ' of the first angle block' : ''}. Drag the card or adjust its position below.${warnings?.size ? ` Headshot notices: ${[...warnings].join('; ')}` : ''}`;
}

function setCustomPosition(x, y) {
  sharePosition = { preset: 'custom', x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  $('share-position').value = 'custom';
  $('share-location-delete').disabled = true;
  $('share-position-saved').textContent = '';
  updatePositionControls();
}

function positionPoint(event) {
  const canvas = $('share-position-preview');
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
}

function startPositionDrag(event) {
  if (event.button !== 0 || $('share-positioning').disabled || !positionBounds) return;
  const point = positionPoint(event);
  const bounds = positionBounds;
  if (point.x < bounds.x || point.x > bounds.x + bounds.width || point.y < bounds.y || point.y > bounds.y + bounds.height) return;
  event.preventDefault();
  if ($('share-angle').value === 'both' && sharePosition.preset === 'original') {
    setCustomPosition(0, 1);
  }
  positionDrag = {
    id: event.pointerId,
    x: Math.min(positionBounds.width, point.x - positionBounds.x),
    y: Math.max(0, Math.min(positionBounds.height, point.y - positionBounds.y)),
  };
  $('share-position-preview').setPointerCapture(event.pointerId);
}

function movePositionDrag(event) {
  if (!positionDrag || event.pointerId !== positionDrag.id || !positionBounds || $('share-positioning').disabled) return;
  const point = positionPoint(event);
  const canvas = $('share-position-preview');
  setCustomPosition((point.x - positionDrag.x) / Math.max(1, canvas.width - positionBounds.width),
    (point.y - positionDrag.y) / Math.max(1, canvas.height - positionBounds.height));
}

async function savePositionPreference(action) {
  if (positionSaving || S.exporting || $('share-clean').checked) return;
  const locations = S.settings.overlayLocations.slice();
  const selected = $('share-position').value;
  let message;
  const next = { ...S.settings };
  if (action === 'default') {
    next.overlayPosition = A22.clipExport.overlayPosition(sharePosition);
    message = 'Default overlay position saved for future exports.';
  } else if (action === 'delete') {
    if (!selected.startsWith('saved-')) return;
    locations.splice(Number(selected.slice(6)), 1);
    next.overlayLocations = locations;
    message = 'Saved location deleted. Your current position and default are unchanged.';
  } else {
    const name = $('share-location-name').value.trim();
    if (!name || name.length > 60) {
      $('share-position-saved').textContent = 'Enter a location name (1-60 characters).';
      return;
    }
    const location = { name, position: A22.clipExport.overlayPosition(sharePosition) };
    const index = locations.findIndex((item) => item.name === name);
    if (index < 0) locations.push(location);
    else locations[index] = location;
    next.overlayLocations = locations;
    message = `Location "${name}" saved. Use Make default to apply it to future exports.`;
  }
  positionSaving = true;
  updatePositionControls();
  $('share-export').disabled = true;
  try {
    S.settings = mergeSettings(await window.api.saveSettings(next));
    const index = S.settings.overlayLocations.findIndex((item) => item.name === $('share-location-name').value.trim());
    renderPositionOptions(action === 'save' ? `saved-${index}` : action === 'default' ? selected : undefined);
    $('share-position-saved').textContent = message;
  } catch (e) {
    $('share-position-saved').textContent = `Could not save overlay preference: ${e.message}`;
  } finally {
    positionSaving = false;
    updatePositionControls();
    updateExportOptions();
  }
}

function selectTrimPlay() {
  const clip = S.exportDraft?.clips[Number($('share-preview-play').value)];
  if (!clip) return;
  $('share-trim').value = clip.trim;
  queueTrimPreview();
}

function queueTrimPreview() {
  const revision = ++previewRevision;
  clearTimeout(previewTimer);
  positionFrames = null;
  renderPositionPreview();
  const clip = S.exportDraft?.clips[Number($('share-preview-play').value)];
  const sequence = clip ? A22.clipExport.exportSequence([clip], $('share-angle').value) : [];
  const previews = [
    { angle: 'sideline', image: 'share-preview-a', figure: 'share-preview-figure-a', start: 'aStart' },
    { angle: 'endzone', image: 'share-preview-b', figure: 'share-preview-figure-b', start: 'bStart' },
  ];
  const selected = previews.filter(({ angle }) => sequence.some(({ mode }) => mode === 'both' || mode === angle));
  for (const preview of previews) {
    $(preview.image).hidden = true;
    $(preview.figure).hidden = !selected.includes(preview);
  }
  if (!clip) {
    $('share-preview-status').textContent = '';
    $('share-position-status').textContent = '';
    return;
  }
  $('share-position-status').textContent = 'Loading export preview…';
  $('share-preview-status').textContent = `Loading first retained ${selected.length === 1 ? 'frame' : 'frames'}…`;
  previewTimer = setTimeout(async () => {
    if (revision !== previewRevision || $('share').hidden) return;
    try {
      const range = A22.clipExport.trimRange(clip, clip.trim);
      const frames = await Promise.all(selected.map(({ start }) => window.api.previewFrame(clip.file, range[start])));
      if (revision !== previewRevision || $('share').hidden) return;
      for (const [i, { image }] of selected.entries()) {
        $(image).src = frames[i];
        await $(image).decode();
        if (revision !== previewRevision || $('share').hidden) return;
        $(image).hidden = false;
      }
      positionFrames = { clip, mode: $('share-angle').value };
      renderPositionPreview();
      loadPositionHeadshots();
      $('share-preview-status').textContent = `${range.len.toFixed(2)} seconds retained${selected.length === 2 ? ' per angle' : ''}.`;
    } catch (e) {
      if (revision === previewRevision && !$('share').hidden) {
        $('share-preview-status').textContent = `Preview unavailable: ${e.message}`;
        $('share-position-status').textContent = `Preview unavailable: ${e.message}`;
      }
    }
  }, 300);
}

function updateReportOptions() {
  const options = REPORT.mergeOptions(S.settings.playReport);
  const active = $('share-report-format').value !== 'none';
  $('share-report-advanced').disabled = !active || S.exporting;
  $('share-report-fields').textContent = !active ? 'No play breakdown will be saved.' : $('share-report-advanced').checked
    ? `Included fields: ${REPORT.ADVANCED_FIELDS.filter((f) => options.fields.includes(f.key)).map((f) => f.label).join(', ') || 'none selected in Settings'}.`
    : 'Basic play information only. Advanced statistics are not included.';
}

async function exportSelection() {
  if (!S.exportDraft || S.exporting || positionSaving) return;
  S.exporting = true;
  S.exportCancelRequested = false;
  updateSelection();
  $('share-angle').disabled = true;
  $('share-clean').disabled = true;
  $('share-report-format').disabled = true;
  $('share-report-advanced').disabled = true;
  $('share-export').disabled = true;
  $('share-close').hidden = true;
  $('share-cancel').hidden = false;
  $('share-cancel').disabled = false;
  $('share-progress').hidden = false;
  $('share-progress').value = 0;
  $('share-status').classList.remove('error');
  $('share-status').textContent = 'Choose where to save the MP4…';
  $('share-reveal').hidden = true;
  $('share-trimming').disabled = true;
  $('share-overlay-seconds').disabled = true;
  $('share-positioning').disabled = true;
  updateThemeControls();
  try {
    const mode = $('share-angle').value;
    const clean = $('share-clean').checked;
    const { file, matchup, team } = S.exportDraft;
    const clips = trimmedExportClips();
    const overlaySeconds = clean ? 0 : $('share-overlay-seconds').valueAsNumber;
    const appearance = currentOverlayAppearance();
    if (!Number.isFinite(overlaySeconds) || overlaySeconds < 0) throw new Error('Invalid overlay duration.');
    const report = {
      ...REPORT.mergeOptions(S.settings.playReport),
      format: $('share-report-format').value,
      includeAdvanced: $('share-report-advanced').checked,
      matchup, team, plays: A22.clipExport.exportSequence(clips, mode).map(({ clip }) => clip.play),
    };
    let images = new Map();
    let warnings = new Set();
    if (report.format === 'pdf' || (!clean && overlaySeconds > 0)) {
      $('share-status').textContent = 'Preparing player headshots…';
      ({ images, warnings } = positionHeadshots || await (positionHeadshotPromise || prepareHeadshots(clips)));
    }
    if (report.format === 'pdf') {
      report.headshots = Object.fromEntries([...images].map(([id, image]) => [id, image.toDataURL('image/png')]));
    }
    if (S.exportCancelRequested) {
      $('share-status').textContent = 'Export cancelled.';
      return;
    }
    $('share-status').textContent = 'Choose where to save the MP4…';
    const result = await window.api.exportClips({
      file, mode, clean, report, overlaySeconds,
      overlayPosition: sharePosition,
      suggestedName: A22.clipExport.exportFilename(clips.map((clip) => clip.play), {
        team, playNumber: clips[0].playNumber, role: A22.align.filmRole(clips[0].play, team),
      }),
      clips: clips.map(({ play, playNumber, ...range }) => clean ? range : { ...range, card: playCard(play, mode, matchup, images.get(P.primaryPlayer(play)?.id), sharePosition, appearance) }),
    });
    $('share-status').textContent = result.cancelled ? 'Export cancelled.' : `Saved to ${result.path}`;
    if (!result.cancelled) {
      $('share-progress').value = 1;
      $('share-reveal').hidden = false;
      if (result.reportPath) $('share-status').textContent += ` · Play breakdown: ${result.reportPath}`;
      if (result.reportError) {
        $('share-status').textContent = result.reportError + ` Video: ${result.path}`;
        $('share-status').classList.add('error');
      }
      if (warnings.size) $('share-status').textContent += ` · Headshot notices: ${[...warnings].join('; ')}`;
    }
  } catch (e) {
    $('share-status').textContent = S.exportCancelRequested ? 'Export cancelled.' : `Export failed: ${e.message}`;
    $('share-status').classList.toggle('error', !S.exportCancelRequested);
  } finally {
    S.exporting = false;
    $('share-angle').disabled = false;
    $('share-clean').disabled = false;
    $('share-trimming').disabled = false;
    $('share-overlay-seconds').disabled = $('share-clean').checked;
    updatePositionControls();
    $('share-report-format').disabled = false;
    updateReportOptions();
    $('share-export').disabled = false;
    $('share-close').hidden = false;
    $('share-cancel').hidden = true;
    updateSelection();
  }
}

function play() {
  if (isSplitFilm() && !S.range) return;
  const a = vidA(), b = vidB();
  if (!a.src) return;
  if (S.range && currentRel() >= S.range.len - 1 / S.fps) seekRel(0);
  const rate = S.settings.speeds[S.speedIdx] || 1;
  a.playbackRate = rate;
  b.playbackRate = rate;
  a._target = null;
  b._target = null;
  S.playing = true;
  resetDrift();
  const pa = a.play();
  if (pa && pa.catch) pa.catch(() => {});
  if (S.range) {
    const pb = b.play();
    if (pb && pb.catch) pb.catch(() => {});
  }
  $('btn-play').textContent = '❚❚';
  if (playbackFrame == null) playbackFrame = requestAnimationFrame(tick);
}

function pause() {
  const a = vidA(), b = vidB();
  S.playing = false;
  if (playbackFrame != null) cancelAnimationFrame(playbackFrame);
  playbackFrame = null;
  a.pause();
  b.pause();
  $('btn-play').textContent = '▶';
  if (S.range && a.src) {
    // Re-align B exactly on the frame A stopped on.
    const rel = snapRel(Math.max(0, Math.min(S.range.len, a.currentTime - S.range.aStart)));
    setVideoTime(a, S.range.aStart + rel);
    setVideoTime(b, S.range.bStart + rel);
    updateTimeUI(rel);
  }
}

// Presented-frame clocks (requestVideoFrameCallback) are far more precise than currentTime
// for keeping the two angles locked together while playing.
const frameClock = { a: null, b: null };
function watchFrames(v, key) {
  if (!v.requestVideoFrameCallback) return;
  const cb = (now, m) => {
    frameClock[key] = { media: m.mediaTime, at: m.expectedDisplayTime || now };
    v.requestVideoFrameCallback(cb);
  };
  v.requestVideoFrameCallback(cb);
}
function mediaNow(v, key) {
  const c = frameClock[key];
  const dt = c ? (performance.now() - c.at) / 1000 : -1;
  if (!c || dt < -0.05 || dt > 0.25 || v.seeking) return v.currentTime;
  return c.media + Math.max(0, dt) * v.playbackRate;
}
function resetDrift() {
  frameClock.a = frameClock.b = null;
  S.drift = 0;
}

function tick() {
  playbackFrame = null;
  if (!S.playing) return;
  const a = vidA(), b = vidB();
  if (S.range) {
    const rel = a.currentTime - S.range.aStart;
    if (rel >= S.range.len) return onEnd();
    const rate = S.settings.speeds[S.speedIdx] || 1;
    if (!b.seeking && !a.seeking) {
      const drift = mediaNow(b, 'b') - (S.range.bStart + mediaNow(a, 'a') - S.range.aStart);
      if (Math.abs(drift) > 0.25) {
        b.currentTime = S.range.bStart + rel + 0.03 * rate;
        resetDrift();
      } else {
        S.drift = (S.drift || 0) * 0.85 + drift * 0.15;
        const df = S.drift * S.fps; // in frames
        const want = Math.abs(df) < 0.35 ? rate : rate * (1 - Math.max(-0.12, Math.min(0.12, S.drift * 4)));
        if (Math.abs(b.playbackRate - want) > 0.004) b.playbackRate = want;
      }
    }
    if (b.paused && !b.seeking) b.play().catch(() => {});
    updateTimeUI(rel);
  } else {
    updateTimeUI(a.currentTime);
  }
  playbackFrame = requestAnimationFrame(tick);
}

function onEnd() {
  const mode = S.settings.endOfPlay;
  if (mode === 'loop') {
    pause();
    seekRel(0);
    play();
  } else if (mode === 'advance') {
    if (!navPlay(1, true)) { pause(); seekRel(S.range.len); }
  } else {
    pause();
    seekRel(S.range.len);
  }
}

function step(frames) {
  if (!vidA().src) return;
  if (S.playing) pause();
  seekRel(currentRel() + frames / S.fps);
}

function updateTimeUI(rel) {
  const len = S.range ? S.range.len : vidA().duration || 0;
  $('time-label').textContent = `${fmtTime(rel)} / ${fmtTime(len)}`;
  $('frame-label').textContent = `frame ${Math.round(rel * S.fps)}`;
  if (!S.scrubbing) $('scrub').value = len ? Math.round((rel / len) * 1000) : 0;
}

function updateSpeedLabel() {
  const r = S.settings.speeds[S.speedIdx] || 1;
  $('btn-speed').textContent = `${r}×`;
}
function updateEndLabel() {
  $('btn-end').textContent = { stop: 'Stop at end', advance: 'Auto-advance', loop: 'Loop' }[S.settings.endOfPlay];
}
function updateOffsetLabel() {
  const off = S.curPair >= 0 ? offsetFrames(S.curPair) : 0;
  $('offset-label').textContent = off ? `(sync ${off > 0 ? '+' : ''}${off}f)` : '';
}

/* ---------------- navigation ---------------- */

function navPlay(dir, autoplay) {
  if (S.plays.length && (S.pairs.length || !S.film || isSplitFilm())) {
    let pos = S.visible.indexOf(S.curPlay);
    if (pos < 0) {
      const next = S.visible.findIndex((i) => i > S.curPlay);
      pos = next < 0 ? S.visible.length : next;
      if (dir > 0) pos--;
    }
    for (let k = pos + dir; k >= 0 && k < S.visible.length; k += dir) {
      const i = S.visible[k];
      if (S.settings.skipNoFilm && S.pairs.length && S.mapping[i] == null) continue;
      selectPlay(i, { autoplay: autoplay || S.playing });
      return true;
    }
    return false;
  }
  if (S.pairs.length) return navClip(dir, autoplay);
  return false;
}

function navClip(dir, autoplay) {
  let n = S.curPair + dir;
  if (isSplitFilm()) {
    const role = A22.align.filmRole(S.plays[S.curPlay] || {}, S.sel.team);
    if (!role) return false;
    const indices = S.pairs.flatMap((pair, i) => pair.role === role ? [i] : []);
    const pos = indices.indexOf(S.curPair);
    n = indices[pos < 0 ? (dir > 0 ? 0 : indices.length - 1) : pos + dir];
  }
  if (n == null) return false;
  if (n < 0 || n >= S.pairs.length) return false;
  loadPair(n, { autoplay: autoplay || S.playing });
  return true;
}

/* ---------------- corrections ---------------- */

async function setAnchor(play, value) {
  if (isSplitFilm() && value != null && S.pairs[S.curPair]?.role !== A22.align.filmRole(play, S.sel.team)) {
    setStatus('Link a clip from the selected play’s offense, defense, or special-teams file.', true);
    return;
  }
  const anchors = Object.assign({}, corrections().anchors || {});
  if (value === undefined) delete anchors[play.playId];
  else anchors[play.playId] = value;
  await saveCorrections({ anchors });
  realign();
  renderList();
  renderInfo();
}

async function nudge(delta) {
  if (S.curPair < 0) return;
  const key = pairKey(S.pairs[S.curPair]);
  const offsets = Object.assign({}, corrections().offsets || {});
  const v = delta === 0 ? 0 : (offsets[key] || 0) + delta;
  if (v) offsets[key] = v;
  else delete offsets[key];
  await saveCorrections({ offsets });
  const rel = currentRel();
  S.range = computeRange(S.curPair);
  if (!S.playing) seekRel(rel);
  updateOffsetLabel();
}

/* ---------------- actions ---------------- */

const actions = {
  playPause: () => (S.playing ? pause() : play()),
  frameForward: () => step(1),
  frameBack: () => step(-1),
  jumpForward: () => step(S.settings.jumpFrames),
  jumpBack: () => step(-S.settings.jumpFrames),
  nextPlay: () => navPlay(1, false),
  prevPlay: () => navPlay(-1, false),
  restartPlay: () => { const p = S.playing; pause(); seekRel(0); if (p) play(); },
  cycleSpeed: () => {
    S.speedIdx = (S.speedIdx + 1) % S.settings.speeds.length;
    const r = S.settings.speeds[S.speedIdx];
    vidA().playbackRate = r;
    vidB().playbackRate = r;
    updateSpeedLabel();
  },
  toggleEnd: async () => {
    const order = ['stop', 'advance', 'loop'];
    const s = Object.assign({}, S.settings, { endOfPlay: order[(order.indexOf(S.settings.endOfPlay) + 1) % 3] });
    applySettings(await window.api.saveSettings(s));
  },
  nudgeBack: () => nudge(-1),
  nudgeForward: () => nudge(1),
  nudgeReset: () => nudge(0),
  nextClip: () => navClip(1, false),
  prevClip: () => navClip(-1, false),
  linkClip: () => {
    const p = S.plays[S.curPlay];
    if (p && S.curPair >= 0) setAnchor(p, pairKey(S.pairs[S.curPair]));
  },
  markNoFilm: () => {
    const p = S.plays[S.curPlay];
    if (p) setAnchor(p, null).then(() => { pause(); showMessage('Marked as no film.'); });
  },
  clearFix: () => {
    const p = S.plays[S.curPlay];
    if (p) setAnchor(p, undefined).then(() => selectPlay(S.curPlay, { autoplay: false }));
  },
  search: () => { $('search').focus(); $('search').select(); },
  help: () => toggleOverlay('help'),
};

function runAction(id) {
  const fn = actions[id];
  if (fn) fn();
}

/* ---------------- overlays ---------------- */

let updateResult = null;
let checkingUpdates = false;

function renderUpdate(result) {
  updateResult = result;
  const available = result.status === 'available';
  const message = available
    ? `AMP22 ${result.release.version} is available. You have ${result.currentVersion}.`
    : result.status === 'current' ? `You're up to date. AMP22 ${result.currentVersion} is the latest version.`
    : result.status === 'disabled' ? 'Development build: check for updates manually.'
    : `Could not check for updates: ${result.message}`;
  $('update-status').textContent = message;
  $('btn-update').hidden = !available;
  $('updates-title').textContent = available ? 'A new version of AMP22 is available' : 'Software update';
  $('updates-summary').textContent = message;
  $('updates-release').hidden = !available;
  $('updates-notes').textContent = available ? result.release.notes : '';
  $('updates-download').hidden = !available;
  $('updates-retry').hidden = result.status !== 'error';
  $('updates-close').textContent = available ? 'Later' : 'Close';
  $('updates-error').textContent = '';
}

function showUpdate() {
  if (!$('updates').open) $('updates').showModal();
}

async function checkUpdates(automatic = false) {
  if (checkingUpdates) return;
  checkingUpdates = true;
  $('check-updates').disabled = $('updates-retry').disabled = true;
  $('update-status').textContent = 'Checking for updates…';
  try {
    const result = await window.api.checkUpdates(automatic);
    renderUpdate(result);
    const busy = S.playing || S.exporting || capture || [...document.querySelectorAll('.overlay')].some((el) => !el.hidden);
    if (!automatic || (result.notify && !busy)) showUpdate();
  } catch (error) {
    renderUpdate({ status: 'error', message: error.message });
    if (!automatic) showUpdate();
  } finally {
    checkingUpdates = false;
    $('check-updates').disabled = $('updates-retry').disabled = false;
  }
}

async function closeUpdate() {
  try {
    if (updateResult && updateResult.status === 'available') await window.api.dismissUpdate();
    $('updates').close();
  } catch (error) {
    $('updates-error').textContent = `Could not save your update preference: ${error.message}`;
  }
}

function toggleOverlay(id, show) {
  if (S.exporting) return;
  const el = $(id);
  const want = show == null ? el.hidden : show;
  document.querySelectorAll('.overlay').forEach((o) => { o.hidden = true; });
  el.hidden = !want;
  if (want && id === 'settings') renderSettings();
}

/** Adds the current keyboard shortcut(s) to the tooltip of every control bound to an action. */
function updateTooltips() {
  document.querySelectorAll('[data-action], [data-shortcut]').forEach((el) => {
    if (el.dataset.tip == null) el.dataset.tip = el.getAttribute('title') || '';
    const id = el.dataset.shortcut || el.dataset.action;
    const keys = (S.settings.shortcuts[id] || []).map(keyLabel);
    const base = el.dataset.tip.replace('{N}', String(S.settings.jumpFrames));
    el.title = keys.length ? `${base}  (${keys.join(' or ')})` : base;
  });
}

function renderHelp() {
  $('help-table').innerHTML = ACTIONS.map((a) => {
    const keys = S.settings.shortcuts[a.id] || [];
    const label = a.id.startsWith('jump') ? a.label.replace('N', String(S.settings.jumpFrames)) : a.label;
    return `<tr><td>${esc(label)}</td><td>${keys.map((k) => `<kbd>${esc(keyLabel(k))}</kbd>`).join(' ') || '<span class="muted">—</span>'}</td></tr>`;
  }).join('');
}

let draft = null;
let capture = null; // {id, index}

function renderSettings() {
  if (!draft) draft = JSON.parse(JSON.stringify(S.settings));
  $('set-jump').value = draft.jumpFrames;
  $('set-end').value = draft.endOfPlay;
  $('set-speeds').value = draft.speeds.join(', ');
  $('set-player-sort').value = draft.playerFilterSort;
  fillSelect($('set-team'), Object.keys(A22.teams.TEAMS).filter((t) => !['OAK', 'SD', 'STL'].includes(t)).sort().map((t) => ({ value: t, label: `${t} – ${A22.teams.teamName(t)}` })), draft.defaultTeam);
  $('set-root').value = draft.filmRoot || '';
  $('set-participation-root').value = draft.participationRoot || '';
  $('set-auto').checked = draft.autoAnalyze;
  $('set-skipnofilm').checked = draft.skipNoFilm;
  $('set-cut').value = draft.cutThreshold;
  $('set-export-trim').value = draft.exportTrim;
  $('set-overlay-seconds').value = draft.overlaySeconds;
  $('set-report-format').value = draft.playReport.format;
  $('set-report-advanced').checked = draft.playReport.includeAdvanced;
  $('set-report-fields').innerHTML = REPORT.ADVANCED_FIELDS.map((f) =>
    `<label><input id="set-report-${f.key}" type="checkbox"${draft.playReport.fields.includes(f.key) ? ' checked' : ''} /> ${esc(f.label)}</label>`).join('');
  const kp = draft.keyPlays;
  $('kp-turnovers').checked = kp.turnovers;
  $('kp-scores').checked = kp.scores;
  $('kp-run').value = kp.runYards;
  $('kp-pass').value = kp.passYards;
  $('kp-sacks').checked = kp.sacks;
  $('kp-fourth').checked = kp.fourthDownConversions;
  $('kp-loss').value = kp.lossYards;
  renderShortcutTable();
}

function renderShortcutTable() {
  $('shortcut-table').innerHTML = ACTIONS.map((a) => {
    const keys = draft.shortcuts[a.id] || [];
    const cells = keys.map((k, n) => {
      const cap = capture && capture.id === a.id && capture.index === n;
      return `<kbd class="kbtn ${cap ? 'capture' : ''}" data-id="${a.id}" data-n="${n}">${cap ? 'press a key…' : esc(keyLabel(k))}</kbd><span class="kdel" data-id="${a.id}" data-n="${n}" title="Remove">×</span>`;
    });
    const adding = capture && capture.id === a.id && capture.index === keys.length;
    return `<tr><td>${esc(a.label)}</td><td>${cells.join('')}${adding ? '<kbd class="capture">press a key…</kbd>' : ''}<button class="kadd" data-id="${a.id}">+</button></td></tr>`;
  }).join('');
}

function readSettingsForm() {
  const d = draft;
  d.jumpFrames = Number($('set-jump').value);
  d.endOfPlay = $('set-end').value;
  d.speeds = $('set-speeds').value.split(/[,\s]+/).map(Number).filter((x) => x > 0 && x <= 4);
  d.defaultTeam = $('set-team').value;
  d.playerFilterSort = $('set-player-sort').value;
  d.filmRoot = $('set-root').value;
  d.participationRoot = $('set-participation-root').value;
  d.autoAnalyze = $('set-auto').checked;
  d.skipNoFilm = $('set-skipnofilm').checked;
  d.exportTrim = $('set-export-trim').valueAsNumber;
  d.overlaySeconds = $('set-overlay-seconds').valueAsNumber;
  d.playReport = {
    format: $('set-report-format').value,
    includeAdvanced: $('set-report-advanced').checked,
    fields: REPORT.ADVANCED_FIELDS.filter((f) => $(`set-report-${f.key}`).checked).map((f) => f.key),
  };
  const cut = Number($('set-cut').value);
  d.cutThreshold = cut >= 0.03 && cut <= 0.5 ? cut : DEFAULT_SETTINGS.cutThreshold;
  d.keyPlays = {
    turnovers: $('kp-turnovers').checked,
    scores: $('kp-scores').checked,
    runYards: Number($('kp-run').value) || 0,
    passYards: Number($('kp-pass').value) || 0,
    sacks: $('kp-sacks').checked,
    fourthDownConversions: $('kp-fourth').checked,
    lossYards: Math.max(0, Number($('kp-loss').value) || 0),
  };
  return d;
}

/* ---------------- keyboard ---------------- */

function isTextTarget(t) {
  if (!t) return false;
  if (t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT') return true;
  return t.tagName === 'INPUT' && !['checkbox', 'range', 'button'].includes(t.type);
}

function handleKeydown(e) {
  if ($('updates').open) return;
  if (capture) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { capture = null; renderShortcutTable(); return; }
    const combo = comboFromEvent(e);
    if (!combo) return;
    for (const id of Object.keys(draft.shortcuts)) draft.shortcuts[id] = draft.shortcuts[id].filter((k) => k !== combo);
    const list = draft.shortcuts[capture.id];
    list[capture.index] = combo;
    draft.shortcuts[capture.id] = list.filter(Boolean);
    capture = null;
    renderShortcutTable();
    return;
  }
  if (e.key === 'Escape') {
    if (S.exporting) return;
    if (!$('help').hidden || !$('settings').hidden || !$('share').hidden) { toggleOverlay('help', false); draft = null; return; }
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    return;
  }
  if (!$('settings').hidden || !$('share').hidden) return;
  if (e.target.classList.contains('play-check') && e.key === ' ') return;
  if (isTextTarget(e.target)) {
    if (e.target.id === 'search' && (e.key === 'Enter' || e.key === 'ArrowDown')) { e.preventDefault(); e.target.blur(); if (S.visible.length) selectPlay(S.visible[0]); }
    return;
  }
  const combo = comboFromEvent(e);
  if (!combo) return;
  const id = S.keymap.get(combo);
  if (!id) return;
  if (!$('help').hidden && id !== 'help') toggleOverlay('help', false);
  e.preventDefault();
  if (e.target && e.target.blur && e.target.tagName === 'BUTTON') e.target.blur();
  runAction(id);
}
window.addEventListener('keydown', handleKeydown, true);

/* ---------------- wiring ---------------- */

function wire() {
  $('check-updates').addEventListener('click', () => checkUpdates());
  $('updates-retry').addEventListener('click', () => checkUpdates());
  $('btn-update').addEventListener('click', showUpdate);
  $('updates-close').addEventListener('click', closeUpdate);
  $('updates').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeUpdate();
  });
  $('updates-download').addEventListener('click', async () => {
    $('updates-download').disabled = true;
    try {
      await window.api.downloadUpdate();
      $('updates').close();
    } catch (error) {
      $('updates-error').textContent = `Could not open the download page: ${error.message}`;
    } finally {
      $('updates-download').disabled = false;
    }
  });
  $('pop-a').addEventListener('click', () => popAngle('a'));
  $('pop-b').addEventListener('click', () => popAngle('b'));
  $('return-angle').addEventListener('click', () => dockAngle());
  $('sel-season').addEventListener('change', () => onSelectorChange('season'));
  $('sel-team').addEventListener('change', () => onSelectorChange('team'));
  $('sel-week').addEventListener('change', () => onSelectorChange('week'));

  $('film-format').addEventListener('change', async () => {
    await saveGame({ filmFormat: $('film-format').value });
    await loadGame();
  });
  async function chooseFilm(role) {
    const revision = S.filmRevision;
    const split = isSplitFilm();
    const paths = (S.gameData.splitFilmPaths || {})[S.sel.team] || {};
    const f = await window.api.chooseFilm({ defaultPath: split ? paths[role] : S.gameData.filmPath });
    if (!f || revision !== S.filmRevision) return;
    if (split) {
      if (Object.entries(paths).some(([unit, file]) => unit !== role && file === f)) {
        setStatus('Choose different files for offense, defense, and special teams, or use Single file mode.', true);
        return;
      }
      await saveGame({ splitFilmPaths: { ...S.gameData.splitFilmPaths, [S.sel.team]: { ...paths, [role]: f } } });
      if (revision !== S.filmRevision) return;
      await openSplitFilms();
      return;
    }
    await saveGame({ filmPath: f });
    if (revision !== S.filmRevision) return;
    closeFilm();
    await openFilm(f);
    selectFirstLinked();
  }
  $('btn-film').addEventListener('click', () => chooseFilm('offense'));
  $('btn-defense-film').addEventListener('click', () => chooseFilm('defense'));
  $('btn-special-film').addEventListener('click', () => chooseFilm('special'));
  $('btn-analyze').addEventListener('click', () => analyze(false));
  $('btn-cancel').addEventListener('click', cancelAnalysis);
  $('btn-refresh').addEventListener('click', async () => { await loadSchedule(true); await loadGame(true); });
  $('btn-settings').addEventListener('click', () => { draft = null; toggleOverlay('settings', true); });
  $('btn-help').addEventListener('click', () => toggleOverlay('help'));
  $('btn-share').addEventListener('click', openShare);
  $('btn-export-data').addEventListener('click', () => {
    $('data-export-status').textContent = '';
    toggleOverlay('analysis-export', true);
  });
  $('data-export-close').addEventListener('click', () => toggleOverlay('analysis-export', false));
  $('data-export-save').addEventListener('click', async () => {
    const scope = $('data-scope').value;
    const indices = scope === 'all' ? S.plays.map((_p, i) => i) :
      scope === 'selected' ? S.plays.map((_p, i) => i).filter((i) => S.selected.has(i)) : S.visible;
    if (!indices.length) {
      $('data-export-status').textContent = 'No plays in this selection.';
      return;
    }
    $('data-export-save').disabled = true;
    try {
      const r = await window.api.exportData({
        ...REPORT.mergeOptions(), format: 'csv', layout: $('data-layout').value,
        matchup: `${S.game.awayTeam} at ${S.game.homeTeam} · ${S.game.season} · Week ${S.game.week}`,
        team: S.sel.team, plays: indices.map((i) => S.plays[i]),
      });
      $('data-export-status').textContent = r.cancelled ? 'Export cancelled.' : `Saved ${indices.length} plays to ${r.path}`;
    } catch (e) { $('data-export-status').textContent = `Export failed: ${e.message}`; }
    finally { $('data-export-save').disabled = false; }
  });
  $('film-setup-toggle').addEventListener('click', () => {
    pause();
    S.filmSetupOpen = true;
    renderFilmSetup();
    $('film-format').focus();
  });
  $('film-setup-close').addEventListener('click', () => {
    S.filmSetupOpen = false;
    renderFilmSetup();
    $('film-setup-toggle').focus();
  });
  $('share-angle').addEventListener('change', queueTrimPreview);
  $('share-clean').addEventListener('change', () => {
    $('share-overlay-description').hidden = $('share-clean').checked;
    $('share-clean-description').hidden = !$('share-clean').checked;
    $('share-overlay-seconds').disabled = $('share-clean').checked;
    updatePositionControls();
    loadPositionHeadshots();
    updateExportOptions();
  });
  $('share-position').addEventListener('change', () => {
    const selected = $('share-position').value;
    if (selected.startsWith('saved-')) {
      const location = S.settings.overlayLocations[Number(selected.slice(6))];
      sharePosition = A22.clipExport.overlayPosition(location.position);
      $('share-location-name').value = location.name;
    } else if (selected === 'custom') {
      sharePosition = { preset: 'custom', x: Number($('share-position-x').value) / 100, y: Number($('share-position-y').value) / 100 };
    } else {
      sharePosition = { preset: selected };
    }
    $('share-location-delete').disabled = !selected.startsWith('saved-');
    $('share-position-saved').textContent = '';
    updatePositionControls();
  });
  for (const axis of ['x', 'y']) {
    $(`share-position-${axis}`).addEventListener('input', () =>
      setCustomPosition(Number($('share-position-x').value) / 100, Number($('share-position-y').value) / 100));
  }
  $('share-position-preview').addEventListener('pointerdown', startPositionDrag);
  $('share-position-preview').addEventListener('pointermove', movePositionDrag);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    $('share-position-preview').addEventListener(event, () => { positionDrag = null; });
  }
  $('share-location-save').addEventListener('click', () => savePositionPreference('save'));
  $('share-location-delete').addEventListener('click', () => savePositionPreference('delete'));
  $('share-position-default').addEventListener('click', () => savePositionPreference('default'));
  $('share-theme').addEventListener('change', () => {
    const selected = $('share-theme').value;
    if (selected === 'auto') shareTheme = null;
    else if (selected.startsWith('team-')) shareTheme = A22.overlay.teamTheme(selected.slice(5));
    else if (selected.startsWith('saved-')) {
      const saved = S.settings.overlayThemes[Number(selected.slice(6))];
      shareTheme = A22.overlay.theme(saved);
      $('share-theme-name').value = saved.name;
    } else shareTheme = A22.overlay.theme(currentOverlayAppearance());
    $('share-theme-status').textContent = '';
    updatePositionControls();
  });
  for (const key of ['background', 'accent']) {
    $(`share-theme-${key}`).addEventListener('input', () => {
      shareTheme = A22.overlay.theme({ ...currentOverlayAppearance(), [key]: $(`share-theme-${key}`).value });
      $('share-theme').value = 'custom';
      $('share-theme-status').textContent = '';
      updatePositionControls();
    });
  }
  $('share-opacity').addEventListener('input', () => {
    shareOpacity = A22.overlay.opacity(Number($('share-opacity').value) / 100);
    $('share-theme-status').textContent = '';
    updatePositionControls();
  });
  $('share-theme-save').addEventListener('click', () => saveThemePreference('save'));
  $('share-theme-delete').addEventListener('click', () => saveThemePreference('delete'));
  $('share-theme-default').addEventListener('click', () => saveThemePreference('default'));
  $('share-preview-play').addEventListener('change', selectTrimPlay);
  $('share-trim').addEventListener('input', () => {
    const clip = S.exportDraft?.clips[Number($('share-preview-play').value)];
    if (!clip) return;
    clip.trim = $('share-trim').valueAsNumber;
    updateExportOptions();
    queueTrimPreview();
  });
  $('share-overlay-seconds').addEventListener('input', () => {
    updateExportOptions();
    updatePositionControls();
    loadPositionHeadshots();
  });
  $('share-report-format').addEventListener('change', updateReportOptions);
  $('share-report-advanced').addEventListener('change', updateReportOptions);
  $('share-export').addEventListener('click', exportSelection);
  $('share-close').addEventListener('click', () => toggleOverlay('share', false));
  $('share-reveal').addEventListener('click', async () => {
    try {
      await window.api.revealExport();
    } catch (e) {
      $('share-status').textContent = `Could not show the exported file: ${e.message}`;
      $('share-status').classList.add('error');
    }
  });
  $('share-cancel').addEventListener('click', async () => {
    S.exportCancelRequested = true;
    $('share-cancel').disabled = true;
    try {
      await window.api.cancelExport();
      if (S.exporting) $('share-status').textContent = 'Cancelling export…';
    } catch (e) {
      $('share-status').textContent = `Could not cancel export: ${e.message}`;
      $('share-status').classList.add('error');
      $('share-cancel').disabled = false;
    }
  });
  $('btn-clear-selection').addEventListener('click', () => {
    S.selected.clear();
    S.selectionAnchor = -1;
    S.multiSelect = false;
    updateSelection();
  });
  $('btn-multi-select').addEventListener('click', () => {
    if (S.multiSelect || S.selected.size > 1) {
      const i = S.selected.has(S.curPlay) ? S.curPlay : A22.clipExport.selectedIndices(S.selected)[0];
      S.selected = new Set(i == null ? [] : [i]);
      S.selectionAnchor = i ?? -1;
      S.multiSelect = false;
    } else {
      S.multiSelect = true;
    }
    updateSelection();
  });
  window.api.onExportProgress((p) => {
    $('share-progress').value = p.fraction;
    $('share-status').textContent = `${p.message} · ${Math.round(p.fraction * 100)}%`;
  });
  $('help').addEventListener('click', (e) => { if (e.target.id === 'help') toggleOverlay('help', false); });

  $('btn-reset-fixes').addEventListener('click', async () => {
    if (!confirm('Remove all play↔clip corrections and sync offsets for this game?')) return;
    await saveCorrections({ anchors: {}, offsets: {} });
    realign();
    renderList();
    if (S.curPlay >= 0) selectPlay(S.curPlay, { autoplay: false });
  });

  window.api.onProgress(renderAnalysisProgress);

  document.querySelectorAll('[data-action]').forEach((btn) =>
    btn.addEventListener('click', (e) => { e.currentTarget.blur(); runAction(btn.dataset.action); })
  );

  $('play-list').addEventListener('mousedown', (e) => {
    if (e.shiftKey && e.target.closest('li[data-i]')) e.preventDefault();
  });
  $('play-list').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    const i = Number(li.dataset.i);
    if (e.shiftKey) {
      if (!S.visible.includes(S.selectionAnchor)) S.selectionAnchor = i;
      S.selected = new Set(A22.clipExport.selectionRange(S.visible, S.selectionAnchor, i));
      selectPlay(i, { autoplay: false, keepSelection: true });
    } else if (e.target.classList.contains('play-check') || S.multiSelect) {
      const checked = e.target.classList.contains('play-check') ? e.target.checked : !S.selected.has(i);
      S.selectionAnchor = i;
      if (checked) {
        S.selected.add(i);
        selectPlay(i, { autoplay: false, keepSelection: true });
      } else {
        S.selected.delete(i);
        updateSelection();
      }
    } else selectPlay(i);
  });

  $('search').addEventListener('input', (e) => { S.filter.text = e.target.value; renderList(); });
  $('type-chips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    b.blur();
    S.filter.type = b.dataset.type;
    $('type-chips').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderList();
  });
  $('sel-offense').addEventListener('change', (e) => { S.filter.offense = e.target.value; e.target.blur(); renderList(); });
  $('sel-qtr').addEventListener('change', (e) => { S.filter.qtr = e.target.value; e.target.blur(); renderList(); });
  $('sel-result').addEventListener('change', (e) => { S.filter.result = e.target.value; e.target.blur(); renderList(); });
  for (const [id, field] of [
    ['air-yards-min', 'airMin'], ['air-yards-max', 'airMax'],
    ['yards-min', 'yardsMin'], ['yards-max', 'yardsMax'],
    ['dist-min', 'distMin'], ['dist-max', 'distMax'],
  ]) {
    $(id).addEventListener('input', (e) => {
      if (!e.target.reportValidity()) return;
      S.filter[field] = e.target.value === '' ? null : e.target.valueAsNumber;
      updateAdvancedIndicator();
      renderList();
    });
  }
  $('adv-choices').addEventListener('change', (e) => {
    const key = e.target.dataset.choice;
    if (!key) return;
    e.target.blur();
    setAdvancedChoice(key, e.target.value);
  });
  $('adv-choices').addEventListener('click', (e) => {
    const button = e.target.closest('[data-remove-player]');
    if (button) removePlayerFilter(button.dataset.removePlayer);
  });

  const scrub = $('scrub');
  scrub.addEventListener('input', () => {
    S.scrubbing = true;
    if (S.playing) pause();
    const len = S.range ? S.range.len : vidA().duration || 0;
    seekRel((Number(scrub.value) / 1000) * len);
  });
  scrub.addEventListener('change', () => { S.scrubbing = false; scrub.blur(); });

  for (const v of [vidA(), vidB()]) {
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadedmetadata', () => {
      if (v._pending != null) {
        const time = v._pending;
        v._pending = null;
        setVideoTime(v, time);
      }
      if (v === vidA() && !S.range) updateTimeUI(0);
    });
  }
  const layout = () => {
    // Side by side or stacked, whichever shows the two 16:9 angles larger.
    const el = $('videos');
    const w = el.clientWidth, h = el.clientHeight;
    const side = Math.min(w / 2, (h * 16) / 9);
    const stacked = Math.min(w, ((h / 2) * 16) / 9);
    el.classList.toggle('stacked', stacked > side * 1.2);
  };
  new ResizeObserver(layout).observe($('videos'));
  watchFrames(vidA(), 'a');
  watchFrames(vidB(), 'b');
  vidA().addEventListener('click', () => runAction('playPause'));
  vidB().addEventListener('click', () => runAction('playPause'));
  vidA().addEventListener('error', () => {
    if (vidA().src) showMessage('This video could not be played. A22 film should be H.264 MP4.');
  });

  // Settings panel
  $('set-root-btn').addEventListener('click', async () => {
    const f = await window.api.chooseFolder();
    if (f) $('set-root').value = f;
  });
  $('set-root-clear').addEventListener('click', () => { $('set-root').value = ''; });
  $('set-participation-btn').addEventListener('click', async () => {
    const folder = await window.api.chooseParticipationFolder();
    if (folder) $('set-participation-root').value = folder;
  });
  $('set-participation-clear').addEventListener('click', () => { $('set-participation-root').value = ''; });
  $('shortcut-table').addEventListener('click', (e) => {
    const t = e.target;
    if (!t.dataset.id) return;
    readSettingsForm();
    const list = draft.shortcuts[t.dataset.id];
    if (t.classList.contains('kdel')) {
      list.splice(Number(t.dataset.n), 1);
      capture = null;
    } else if (t.classList.contains('kadd')) {
      capture = { id: t.dataset.id, index: list.length };
    } else {
      capture = { id: t.dataset.id, index: Number(t.dataset.n) };
    }
    t.blur();
    renderShortcutTable();
  });
  $('set-reset').addEventListener('click', () => {
    draft = JSON.parse(JSON.stringify(Object.assign({}, DEFAULT_SETTINGS, {
      filmRoot: $('set-root').value, participationRoot: $('set-participation-root').value,
    })));
    capture = null;
    renderSettings();
  });
  $('set-cancel').addEventListener('click', () => { draft = null; capture = null; toggleOverlay('settings', false); });
  $('set-save').addEventListener('click', async () => {
    for (const id of ['set-export-trim', 'set-overlay-seconds']) {
      if (!$(id).reportValidity()) {
        $(id).focus();
        return;
      }
    }
    const prev = S.settings;
    const next = readSettingsForm();
    applySettings(await window.api.saveSettings(next));
    draft = null;
    capture = null;
    toggleOverlay('settings', false);
    if (prev.participationRoot !== S.settings.participationRoot) await refreshParticipation();
    if (prev.filmRoot !== S.settings.filmRoot && S.game && !S.gameData.filmPath) loadGame();
    if (prev.cutThreshold !== S.settings.cutThreshold && S.film && confirm('Cut sensitivity changed. Re-analyze this film now?')) analyze(true);
  });
}

let participationRevision = 0;
async function refreshParticipation(automatic = false) {
  if (!S.game) return;
  const gameId = S.game.gameId;
  const revision = ++participationRevision;
  const filmRevision = S.filmRevision;
  const before = JSON.stringify(S.plays.map((p) => [p.playId, p.participation, p.onField]));
  S.participationNotice = automatic ? 'Checking imports automatically…' : 'Checking imports…';
  renderParticipationStatus();
  try {
    const r = await window.api.getPlays({ season: S.game.season, gameId });
    if (revision !== participationRevision || S.game?.gameId !== gameId || filmRevision !== S.filmRevision) return;
    const current = S.plays[S.curPlay]?.playId;
    const selected = new Set([...S.selected].map((i) => S.plays[i]?.playId));
    S.plays = r.plays;
    const changed = before !== JSON.stringify(S.plays.map((p) => [p.playId, p.participation, p.onField]));
    S.participationWarning = r.warning || '';
    S.participationNotice = `${automatic && changed ? 'Updated automatically' : automatic ? 'Checked automatically' : 'Imports checked'} at ${new Date().toLocaleTimeString()}.`;
    S.curPlay = S.plays.findIndex((p) => p.playId === current);
    S.selected = new Set(S.plays.map((_p, i) => i).filter((i) => selected.has(S.plays[i].playId)));
    derivePlays();
    realign();
    renderAdvancedFilters();
    renderList();
    renderInfo();
    setStatus(r.warning || 'Participation imports refreshed.', !!r.warning);
  } catch (e) {
    if (revision !== participationRevision || S.game?.gameId !== gameId || filmRevision !== S.filmRevision) return;
    S.participationWarning = e.message;
    renderParticipationStatus();
    setStatus(`Participation import failed: ${e.message}`, true);
  }
}

/* ---------------- boot ---------------- */

(async function boot() {
  wire();
  const init = await window.api.init();
  $('app-version').textContent = `AMP22 ${init.version}`;
  $('share-reveal').textContent = init.platform === 'darwin' ? 'Show in Finder' : init.platform === 'win32' ? 'Show in File Explorer' : 'Show in folder';
  applySettings(init.settings);
  window.api.onParticipationChanged(() => refreshParticipation(true));
  checkUpdates(true);
  if (await loadSchedule(false)) await loadGame(false);
})();
