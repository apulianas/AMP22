/* global A22 */
'use strict';

const { ACTIONS, mergeSettings, comboFromEvent, keyLabel, buildKeymap, DEFAULT_SETTINGS } = A22.settings;
const P = A22.plays;
const ADV = A22.advanced;
const PRESETS = A22.filterPresets;
const REPORT = A22.reports;
const $ = (id) => document.getElementById(id);
const REPORT_FIELD_PRESETS = {
  basic: ['airYards', 'epa'],
  coach: ['airYards', 'epa', 'personnel', 'defense', 'formation', 'qbLocation', 'backfield', 'box', 'motion',
    'playAction', 'rpo', 'screen', 'noHuddle', 'qbSneak', 'rushers', 'blitzers', 'coverage', 'manZone'],
  everything: REPORT.ADVANCED_FIELDS.map((field) => field.key),
};

// Cut times are frame timestamps rounded to ~0.01 s, and the frame grid's phase changes from
// clip to clip (A22 files are stitched together), so positions are kept on a grid relative to
// each clip's start, offset slightly so a seek always lands inside the intended frame.
const { START_PAD, END_TRIM_FRAMES } = A22.clipExport;

const S = {
  mode: 'film',
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
  suggestedFilms: [],
  analyzing: false,
  batchAnalyzing: false,
  coverageRetune: [],
  fps: 59.94,
  pairs: [],
  curPlay: -1,
  curPair: -1,
  range: null, // {aStart, bStart, len}
  playing: false,
  speedIdx: 0,
  filter: PRESETS.emptyFilter(),
  appliedPreset: null,
  pendingPreset: null,
  savingPreset: false,
  visible: [], // play indices in list order
  progressFile: null,
  selected: new Set(),
  selectionAnchor: -1,
  multiSelect: false,
  exporting: false,
  exportCancelRequested: false,
  exportDraft: null,
};
let analysisLab = null;
let analysisFilterSource = null;
let analysisSelectionMatches = null;
let highlightEditor = null;
let statusToastTimer = null;

function persistLastSelection() {
  try { localStorage.setItem('amp22.lastSelection', JSON.stringify(S.sel)); }
  catch (error) { setStatus(`Game selection could not be saved: ${error.message}`, true); }
}

function renderAlignmentTimeline() {
  const anchors = corrections().anchors || {};
  const entries = Object.entries(anchors).filter(([, key]) => key !== null);
  const mapped = new Map();
  for (const [playId, key] of entries) {
    const index = S.plays.findIndex(play => String(play.playId) === String(playId));
    const pair = pairIndexForKey(key);
    if (index >= 0 && pair >= 0) mapped.set(pair, index);
  }
  $('alignment-summary').textContent = `${entries.length} corrections · ${S.pairs.length} clips`;
  $('alignment-timeline').innerHTML = S.pairs.map((pair, index) => {
    const playIndex = mapped.get(index);
    const corrected = playIndex != null;
    const title = corrected ? `${P.clockLabel(S.plays[playIndex])} linked to clip ${index + 1}` : `Clip ${index + 1}`;
    return `<button type="button" class="${corrected ? 'corrected ' : ''}${index === S.curPair ? 'current' : ''}" data-alignment-pair="${index}" aria-label="${esc(title)}" title="${esc(title)}"></button>`;
  }).join('');
}

function renderSuggestedFilms() {
  const host = $('film-suggestions');
  if (!host) return;
  const candidates = S.suggestedFilms.slice(0, 5);
  host.hidden = !candidates.length;
  host.innerHTML = candidates.length
    ? `<strong>Suggested files</strong>${candidates.map((candidate, index) => {
      const name = candidate.path.split(/[\\/]/).pop();
      const why = `${candidate.a22 ? 'A22 name' : 'video'} · match score ${candidate.score}`;
      return `<button type="button" data-film-suggestion="${index}">${esc(name)}<span class="suggestion-reason">${why}</span></button>`;
    }).join('')}`
    : '';
}

async function chooseSuggestedFilm(index) {
  const candidate = S.suggestedFilms[index];
  if (!candidate || isSplitFilm()) return;
  const revision = S.filmRevision;
  await saveGame({ filmPath: candidate.path });
  if (revision !== S.filmRevision) return;
  closeFilm();
  await openFilm(candidate.path);
  selectFirstLinked();
}

function renderCommandResults(query = '') {
  const q = query.trim().toLowerCase();
  const actions = [
    ['Open film…', 'Choose or change this game’s film', 'open-film'],
    ['Game library', 'Browse scheduled games and saved film', 'game-library'],
    ['Settings', 'Playback, folders, export, and accessibility', 'settings'],
    ['Film Room', 'Watch synced film', 'mode-film'],
    ['Analysis Lab', 'Explore personnel and efficiency', 'mode-analysis'],
    ['Export clip', 'Export the selected play or plays', 'export-clip'],
    ['Export stats', 'Export game statistics and participation', 'export-stats'],
    ['Keyboard shortcuts', 'View and remap shortcuts', 'help'],
  ].filter(([label, hint]) => `${label} ${hint}`.toLowerCase().includes(q));
  const games = teamGames(S.sel.season, S.sel.team).map((game) =>
    ({ label: gameLabel(game, S.sel.team), hint: `${game.season} ${S.sel.team}`, kind: 'game', value: game.gameId }))
    .filter(item => `${item.label} ${item.hint}`.toLowerCase().includes(q))
    .map(item => `<li role="option" tabindex="-1" data-command-kind="game" data-command-value="${esc(item.value)}"><strong>${esc(item.label)}</strong><span class="muted">${esc(item.hint)}</span></li>`);
  $('command-results').innerHTML = actions.map(([label, hint, value]) =>
    `<li role="option" tabindex="-1" data-command-kind="action" data-command-value="${value}"><strong>${label}</strong><span class="muted">${hint}</span></li>`).join('') + games.join('');
  const first = $('command-results').querySelector('[role=option]');
  first?.setAttribute('aria-selected', 'true');
}

function openCommandPalette() {
  toggleOverlay('command-palette', true);
  $('command-search').value = '';
  renderCommandResults();
  $('command-search').focus();
}

async function openGameLibrary() {
  toggleOverlay('game-library', true);
  const host = $('library-games');
  host.textContent = 'Checking saved film and suggestions…';
  const games = teamGames(S.sel.season, S.sel.team);
  try {
    const summaries = await window.api.getFilmLibrary(games.map(game => ({
      gameId: game.gameId, season: game.season, week: game.week, team: S.sel.team,
      opponent: game.homeTeam === S.sel.team ? game.awayTeam : game.homeTeam,
    })));
    if ($('game-library').hidden) return;
    host.innerHTML = games.map((game, index) => ({ game, summary: summaries[index] }))
      .sort((a, b) => Number(b.summary.hasFilm) - Number(a.summary.hasFilm) || a.game.week - b.game.week)
      .map(({ game, summary }) => {
      const state = !summary.hasFilm ? 'No film found' : summary.analyzed ? 'Analyzed' :
        summary.suggested ? 'Film suggested' : 'Film saved · not analyzed';
      return `<div class="library-game"><button type="button" data-library-game="${esc(game.gameId)}">${esc(gameLabel(game, S.sel.team))}</button><span class="muted">${esc(summary.filmNames.join(', ') || state)}</span><strong>${state}</strong></div>`;
    }).join('');
  } catch (error) {
    host.textContent = `Could not load game library: ${error.message}`;
  }
}

async function analyzeNewLibraryFilms() {
  const button = $('library-analyze-new');
  if (button.disabled) return;
  button.disabled = true;
  S.batchAnalyzing = true;
  const original = { ...S.sel };
  const originalMode = S.mode;
  let completed = 0;
  let attempted = 0;
  try {
    if (S.mode !== 'film') await setWorkspaceMode('film', false);
    const games = teamGames(S.sel.season, S.sel.team);
    const summaries = await window.api.getFilmLibrary(games.map(game => ({
      gameId: game.gameId, season: game.season, week: game.week, team: S.sel.team,
      opponent: game.homeTeam === S.sel.team ? game.awayTeam : game.homeTeam,
    })));
    const pending = games.filter((_game, index) => summaries[index].hasFilm && !summaries[index].analyzed && !summaries[index].suggested);
    for (const game of pending) {
      attempted++;
      $('library-status').textContent = `Analyzing ${gameLabel(game, S.sel.team)} (${attempted}/${pending.length})…`;
      S.sel = { season: game.season, team: original.team, week: game.week, gameId: game.gameId };
      renderSelectors();
      await loadGame(false);
      if (S.film && !S.film.analysis && !S.analyzing) await analyze(false);
      while (S.analyzing) await new Promise(resolve => setTimeout(resolve, 250));
      if (S.film?.analysis || S.pairs.length) completed++;
    }
    $('library-status').textContent = `Analyzed ${completed} of ${pending.length} saved games.`;
  } catch (error) {
    $('library-status').textContent = `Batch analysis stopped: ${error.message}`;
  } finally {
    S.sel = original;
    if (S.mode !== originalMode) await setWorkspaceMode(originalMode, false);
    renderSelectors();
    try { await loadGame(false); } finally { S.batchAnalyzing = false; }
    button.disabled = false;
    openGameLibrary();
  }
}

function runCommand(action) {
  toggleOverlay('command-palette', false);
  if (action === 'open-film') {
    $('btn-film').click();
  } else if (action === 'game-library') openGameLibrary();
  else if (action === 'settings') { draft = null; toggleOverlay('settings', true); }
  else if (action === 'mode-film') setWorkspaceMode('film');
  else if (action === 'mode-analysis') setWorkspaceMode('analysis');
  else if (action === 'export-clip') {
    if (!$('btn-share').disabled) openShare();
    else setStatus('Select a play with linked film before exporting a clip.', false);
  } else if (action === 'export-stats') {
    if (!$('btn-export-data').disabled) $('btn-export-data').click();
    else setStatus('Load a game before exporting statistics.', false);
  } else if (action === 'help') toggleOverlay('help', true);
}

function applyComfortSettings(settings) {
  document.body.dataset.theme = settings.uiTheme === 'system'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : settings.uiTheme;
  document.documentElement.style.setProperty('--ui-scale', String(settings.textScale));
  document.documentElement.style.setProperty('--sidebar-width', `${settings.sidebarWidth}px`);
  $('sidebar-resizer')?.setAttribute('aria-valuenow', String(settings.sidebarWidth));
}

function lastPlayId() {
  try { return localStorage.getItem(`amp22.lastPlay.${S.sel.gameId}.${S.sel.team}`); }
  catch (error) { setStatus(`Last-play preference could not be read: ${error.message}`, true); return null; }
}

function filterSource() {
  return S.mode === 'analysis' && analysisFilterSource !== null ? analysisFilterSource : S.plays;
}

async function setWorkspaceMode(mode, reload = true) {
  const analysisEntry = mode === 'analysis' && S.mode === 'film' ? prepareAnalysisEntry() : null;
  S.mode = mode;
  document.body.classList.toggle('analysis-mode', mode === 'analysis');
  $('viewer').hidden = mode === 'analysis';
  $('analysis-lab').hidden = mode !== 'analysis';
  $('mode-film').setAttribute('aria-pressed', String(mode === 'film'));
  $('mode-analysis').setAttribute('aria-pressed', String(mode === 'analysis'));
  $('analysis-sidebar-note').hidden = mode !== 'analysis';
  $('analysis-perspective').hidden = mode !== 'analysis';
  $('lab-selection-controls').hidden = mode !== 'analysis';
  try { localStorage.setItem('amp22.workspace', mode); }
  catch (error) { setStatus(`Workspace preference could not be saved: ${error.message}`, true); }
  if (reload && S.sel.gameId) {
    await loadGame(undefined, { preserveFilters: true, preservePlay: true });
    if (analysisEntry) {
      if (analysisEntry.playIds.length) {
        const playIds = new Set(analysisEntry.playIds);
        analysisLab?.selectFilmPlays(S.plays.filter(play => playIds.has(play.playId)));
      } else if (!analysisEntry.preserveFilters) {
        analysisLab?.clearSelectionFilter();
      }
    }
  }
}

function prepareAnalysisEntry() {
  const playIds = S.multiSelect
    ? [...S.selected].map(index => S.plays[index]?.playId).filter(playId => playId != null)
    : [];
  const preserveFilters = activeAdvancedCount() > 0 || !!S.appliedPreset;
  if (!preserveFilters) {
    S.filter = PRESETS.emptyFilter();
    S.appliedPreset = null;
  }
  return { playIds, preserveFilters };
}

function analysisFilterDescription() {
  const f = S.filter;
  const active = [];
  if (f.type !== 'all') active.push(`Type: ${f.type}`);
  if (f.offense) active.push(`Offense: ${f.offense}`);
  if (f.qtr) active.push(`Quarter: ${f.qtr}`);
  if (f.result) active.push(`Result: ${f.result}`);
  if (f.text) active.push(`Search: ${f.text}`);
  for (const [key, label] of [['air', 'Air yards'], ['yards', 'Yards'], ['dist', 'To go']]) {
    if (f[`${key}Min`] != null) active.push(`${label} >= ${f[`${key}Min`]}`);
    if (f[`${key}Max`] != null) active.push(`${label} <= ${f[`${key}Max`]}`);
  }
  for (const [key, value] of Object.entries(f.choices)) {
    if (value && (!Array.isArray(value) || value.length)) active.push(`${ADV_CHOICES.find((x) => x.key === key)?.label || key}: ${Array.isArray(value) ? value.join(' + ') : value}`);
  }
  return active.join('; ') || 'None';
}

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
  if (isErr && msg) {
    const toast = $('app-toast');
    if (toast) {
      toast.textContent = msg;
      toast.hidden = false;
      clearTimeout(statusToastTimer);
      statusToastTimer = setTimeout(() => { toast.hidden = true; }, 9000);
    }
    el.textContent = '';
    el.title = '';
  } else {
    el.textContent = msg || '';
    el.title = msg || '';
  }
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
  applyComfortSettings(S.settings);
  S.keymap = buildKeymap(S.settings.shortcuts);
  S.speedIdx = Math.min(S.speedIdx, S.settings.speeds.length - 1);
  updateSpeedLabel();
  updateEndLabel();
  renderHelp();
  updateTooltips();
  renderPresetOptions();
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
  persistLastSelection();
  renderSelectors();
  document.activeElement.blur();
  loadGame();
}

async function loadSchedule(force) {
  setStatus('Loading schedule…');
  try {
    const r = await window.api.getSchedule({ force });
    S.games = r.games;
    if (!S.sel.gameId) {
      try {
        const saved = JSON.parse(localStorage.getItem('amp22.lastSelection') || 'null');
        const game = saved && S.games.find((item) => item.gameId === saved.gameId &&
          item.season === Number(saved.season) && [item.homeTeam, item.awayTeam].includes(saved.team));
        if (game) S.sel = { season: game.season, team: saved.team, week: game.week, gameId: game.gameId };
        else S.sel = { ...r.defaultSelection };
      } catch (error) {
        setStatus(`Last-game preference could not be loaded: ${error.message}`, true);
        S.sel = { ...r.defaultSelection };
      }
      persistLastSelection();
    }
    setStatus(S.mode === 'analysis' ? '' : r.warning || '', false);
    renderSelectors();
    return true;
  } catch (e) {
    setStatus(e.message, true);
    showMessage(`Couldn't load the NFL schedule (${esc(e.message)}).<br>You can still open a film with <b>Choose film…</b>.`);
    return false;
  }
}

/* ---------------- game loading ---------------- */

async function loadGame(force, { preserveFilters = false, preservePlay = false } = {}) {
  const playId = preservePlay ? S.plays[S.curPlay]?.playId : lastPlayId();
  analysisLab?.invalidate();
  const gameId = S.sel.gameId;
  const team = S.sel.team;
  // A new game starts a fresh preset application, including its team/data checks.
  if (!preserveFilters) {
    if (S.appliedPreset) S.filter = PRESETS.emptyFilter();
    S.appliedPreset = null;
  }
  S.pendingPreset = null;
  $('filter-preset-team').hidden = true;
  $('filter-preset-status').textContent = '';
  closeFilm();
  const revision = S.filmRevision;
  S.game = S.games.find((g) => g.gameId === gameId) || null;
  S.plays = [];
  renderPresetOptions();
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
  S.suggestedFilms = [];
  renderSuggestedFilms();
  renderFilmControls();
  const opp = S.game ? (S.game.homeTeam === S.sel.team ? S.game.awayTeam : S.game.homeTeam) : '';
  if (S.mode !== 'analysis' && !preserveFilters) S.filter.offense = '';
  renderOffenseOptions();
  renderQuarters();

  if (S.game) {
    setStatus('Loading play-by-play…');
    try {
      const r = await window.api.getPlays({ season: S.game.season, gameId, force });
      if (S.sel.gameId !== gameId || S.sel.team !== team || revision !== S.filmRevision) return;
      S.plays = r.plays;
      S.participationWarning = r.warning || '';
      setStatus(S.mode === 'analysis' ? '' : r.warning || '', false);
    } catch (e) {
      if (revision !== S.filmRevision) return;
      S.participationWarning = e.message;
      setStatus(e.message, true);
    }
  }
  derivePlays();
  renderQuarters();
  renderAdvancedFilters();
  syncFilterControls();

  if (S.mode === 'analysis') {
    S.curPlay = playId != null ? S.plays.findIndex((play) => play.playId === playId) : -1;
    realign();
    renderList();
    renderInfo();
    return;
  }
  if (isSplitFilm()) {
    await openSplitFilms({ playId });
    return;
  }
  let filmPath = S.gameData.filmPath;
  if (!filmPath && S.game) {
    const s = await window.api.suggestFilm({ week: S.game.week, opponent: opp, season: S.game.season, team: S.sel.team });
    if (revision !== S.filmRevision) return;
    S.suggestedFilms = s.ranked || [];
    renderSuggestedFilms();
    if (s.auto) {
      filmPath = s.auto;
      await saveGame({ filmPath });
      if (revision !== S.filmRevision) return;
    }
  }
  if (filmPath) await openFilm(filmPath);
  else {
    closeFilm();
    showMessage('Choose an All-22 file containing both sideline and end zone angles.<br><span class="muted">Drop a video here, choose a file, or set a film folder to see suggestions.</span>');
  }
  selectFirstLinked({ playId });
}

async function saveGame(patch) {
  if (!S.sel.gameId) return;
  const gameId = S.sel.gameId;
  const team = S.sel.team;
  const data = await window.api.saveGame(gameId, patch);
  if (S.sel.gameId === gameId && S.sel.team === team) S.gameData = data;
}

function derivePlays(list = S.plays) {
  for (const p of list) {
    p.cat = P.category(p);
    p.filmWeight = P.filmWeight(p);
    p.key = P.keyReasons(p, S.settings.keyPlays);
    p.neg = P.negativeReasons(p, S.settings.keyPlays);
    p.box = P.boxScore(p);
    const players = [...(p.onField?.offense || []), ...(p.onField?.defense || [])];
    const annotation = S.gameData.playAnnotations?.[p.playId];
    p.searchText = `${p.desc} ${p.posteam} ${P.downDistance(p)} ${p.key.join(' ')} ${p.neg.join(' ')} ${p.cat} ${ADV.tags(p).join(' ')} ${players.map((x) => `${x.name} ${x.position} ${x.number}`).join(' ')} ${annotation?.note || ''} ${(annotation?.tags || []).join(' ')}`.toLowerCase();
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
  S.progressFile = null;
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
  const open = !ready || S.filmSetupOpen || !!S.analyzing;
  $('film-setup').hidden = !open;
  $('film-setup-toggle').hidden = !ready || open;
  $('film-setup-toggle').setAttribute('aria-expanded', String(open));
  $('film-setup-close').hidden = !ready || !!S.analyzing;
  $('timeline').hidden = !ready;
  $('transport').hidden = !ready;
  $('alignment-tools').hidden = !ready;
  $('film-folder-clear').hidden = !S.settings?.filmRoot;
  $('film-folder-choose').textContent = S.settings?.filmRoot ? 'Change folder…' : 'Choose folder…';
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
  S.pairs = ['offense', 'defense', 'special'].flatMap((role) => {
    const film = S.splitFilms[role];
    return (film?.analysis?.pairs || []).map((pair) => ({ ...pair, role, film }));
  });
  $('videos').classList.toggle('single', !S.pairs.length);
  $('btn-analyze').hidden = !!S.analyzing || !Object.values(S.splitFilms).some((film) => !film.analysis);
  updateAngleButtons();
  renderFilmSetup();
}

function selectFirstLinked({ playId = null } = {}) {
  realign();
  renderList();
  const preferred = playId != null ? S.plays.findIndex((play) => play.playId === playId) : -1;
  const first = preferred >= 0 ? preferred : S.visible.find((i) => S.mapping[i] != null);
  if (first != null) selectPlay(first, { autoplay: false });
  else renderInfo();
  checkFilmCoverage();
}

async function openSplitFilms({ playId = null } = {}) {
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
  selectFirstLinked({ playId });
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

async function analyze(force, { auto = false, films: only = null } = {}) {
  if (!S.film || S.analyzing) return;
  const revision = S.filmRevision;
  const split = isSplitFilm();
  const current = split ? Object.values(S.splitFilms) : [S.film];
  const films = only ? only.filter((film) => current.includes(film)) : split ? current.filter((film) => force || !film.analysis) : current;
  if (!films.length) return;
  const run = {};
  let finished = false;
  S.analyzing = run;
  $('progress').hidden = false;
  $('btn-analyze').hidden = true;
  renderFilmSetup();
  try {
    for (const film of films) {
      if (revision !== S.filmRevision) return;
      S.progressFile = film.path;
      const a = await window.api.analyzeFilm(film.path, force, { filmWeights: filmWeightsFor(film), auto });
      if (revision !== S.filmRevision) return;
      film.analysis = a;
      if (split) rebuildSplitPairs();
      else setAnalysis(a);
      selectFirstLinked();
      if (S.curPair < 0 && S.pairs.length) loadPair(0, { autoplay: false });
    }
    const coverage = filmCoverage();
    setStatus(`Found ${S.pairs.length} plays on film${coverage.expected ? ` · ${coverage.expected - coverage.unmatched.length} of ${coverage.expected} expected plays linked` : ''}`);
    finished = true;
  } catch (e) {
    if (revision === S.filmRevision) {
      $('btn-analyze').hidden = false;
      setStatus(/Cancelled/.test(e.message) ? 'Analysis cancelled' : `Analysis failed: ${e.message}`, !/Cancelled/.test(e.message));
    }
  } finally {
    if (S.analyzing === run) {
      S.analyzing = false;
      S.progressFile = null;
      $('progress').hidden = true;
      if (isSplitFilm()) rebuildSplitPairs();
      renderFilmSetup();
      if (finished) checkFilmCoverage();
    }
  }
}

/* ---------------- film coverage ---------------- */

const COVERAGE_ALERT_RATIO = 0.05;
const COVERAGE_ALERTS_KEY = 'amp22.coverageAlerts';

/** Film weight (0–1 chance of being on film) of each play this film should contain, in game order. */
function filmWeightsFor(film) {
  const anchors = corrections().anchors || {};
  const role = isSplitFilm() ? Object.keys(S.splitFilms).find((key) => S.splitFilms[key] === film) : null;
  const weights = S.plays
    .filter((p) => anchors[p.playId] !== null && (!role || A22.align.filmRole(p, S.sel.team) === role))
    .map((p) => p.filmWeight);
  return weights.some((w) => w > 0) ? weights : null;
}

/** Plays that should be on analyzed film but have no linked clip (plays marked "No film" are excluded). */
function filmCoverage() {
  const anchors = corrections().anchors || {};
  const split = isSplitFilm();
  let expected = 0;
  const unmatched = [];
  S.plays.forEach((p, i) => {
    if (p.filmWeight < 1 || anchors[p.playId] === null) return;
    if (split && !S.splitFilms[A22.align.filmRole(p, S.sel.team)]?.analysis) return;
    expected++;
    if (S.mapping[i] == null) unmatched.push(i);
  });
  return { expected, unmatched, ratio: expected ? unmatched.length / expected : 0 };
}

/** Offers recovery once per analysis when more than 5% of expected plays have no film. */
function checkFilmCoverage() {
  if (!S.film || !S.pairs.length || S.analyzing || S.batchAnalyzing || S.mode !== 'film') return;
  const films = (isSplitFilm() ? Object.values(S.splitFilms) : [S.film]).filter(Boolean);
  if (S.settings.autoAnalyze && films.some((film) => !film.analysis)) return;
  if ([...document.querySelectorAll('.overlay')].some((overlay) => !overlay.hidden)) return;
  const coverage = filmCoverage();
  if (!coverage.expected || coverage.ratio <= COVERAGE_ALERT_RATIO) return;
  const key = [S.sel.gameId, S.sel.team, ...films.filter((film) => film.analysis)
    .map((film) => `${film.path}@${film.analysis.createdAt}`)].join('|');
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(COVERAGE_ALERTS_KEY) || '[]'); } catch { /* Treat unreadable history as empty. */ }
  if (!Array.isArray(seen)) seen = [];
  if (seen.includes(key)) return;
  try { localStorage.setItem(COVERAGE_ALERTS_KEY, JSON.stringify([...seen, key].slice(-100))); } catch { /* Best effort. */ }
  S.coverageRetune = films.filter((film) => film.analysis && film.analysis.cutMode !== 'auto');
  const n = coverage.unmatched.length;
  $('film-coverage-title').textContent = `${n} ${n === 1 ? 'play has' : 'plays have'} no film`;
  $('film-coverage-summary').textContent = `${n} of ${coverage.expected} plays (${Math.round(coverage.ratio * 100)}%) didn't match a film clip.`;
  $('film-coverage-detail').textContent = S.coverageRetune.length
    ? 'This film was analyzed with a fixed cut sensitivity. Automatic detection uses the play-by-play to choose the sensitivity that finds the most plays. It takes about 3–5 minutes per film.'
    : 'Cut detection was already matched to the play-by-play, so these plays may be missing from the film or may need to be linked by hand.';
  $('film-coverage-reanalyze').hidden = !S.coverageRetune.length;
  $('film-coverage-review').classList.toggle('primary', !S.coverageRetune.length);
  toggleOverlay('film-coverage-dialog', true);
}

function reviewUnmatchedPlays() {
  toggleOverlay('film-coverage-dialog', false);
  const { unmatched } = filmCoverage();
  const visible = new Set(S.visible);
  const first = unmatched.find((i) => visible.has(i)) ?? unmatched[0];
  if (first == null) return;
  selectPlay(first, { autoplay: false });
  $('alignment-tools').open = true;
  $('alignment-tools').scrollIntoView?.({ block: 'nearest' });
  setStatus(`${unmatched.length} unmatched plays · browse with ◀ clip / clip ▶, then Link clip ↔ play`);
}

/* ---------------- play list ---------------- */

const RESULT_FILTERS = {
  key: (p) => p.key.length > 0,
  negative: (p) => p.neg.length > 0,
  sack: (p) => p.flags.sack && p.playType !== 'no_play',
  incomplete: (p) => p.flags.incomplete_pass && p.playType !== 'no_play',
  turnover: (p) => p.key.some((k) => ['INT', 'FUM', 'TOD'].includes(k)) || (p.playType !== 'no_play' && (p.flags.interception || p.flags.fumble_lost)),
  score: (p) => p.key.some((k) => ['TD', 'FG', 'SAF', '2PT'].includes(k)) || (p.playType !== 'no_play' && (p.flags.touchdown || p.fieldGoalResult === 'made')),
  big: (p) => p.key.includes('BIG'),
  firstdown: (p) => p.flags.first_down && p.playType !== 'no_play',
  penalty: (p) => p.flags.penalty,
  bookmark: (p) => !!S.gameData.playAnnotations?.[p.playId]?.bookmarked,
};

/** Inclusive numeric bounds (S.filter[`${key}Min`/`${key}Max`]); plays without a value are excluded while a bound is set. */
const RANGE_FILTERS = {
  yards: (p) => (p.playType !== 'no_play' && (p.cat === 'run' || p.cat === 'pass') ? p.yards : null),
  air: (p) => p.airYards,
  dist: (p) => p.ydstogo,
};

/* ---------------- filter presets ---------------- */

function filterOpponent() {
  return S.game ? (S.game.homeTeam === S.sel.team ? S.game.awayTeam : S.game.homeTeam) : '';
}

function renderOffenseOptions(teams = [S.sel.team, filterOpponent()]) {
  const available = [...new Set(teams.filter(Boolean))];
  if (S.filter.offense && !available.includes(S.filter.offense)) available.push(S.filter.offense);
  fillSelect($('sel-offense'), [
    { value: '', label: 'Both offenses' },
    ...available.map(team => ({ value: team, label: `${A22.teams.teamName(team)} offense` })),
  ], S.filter.offense);
  $('sel-offense').title = 'Filter plays by the team in possession';
}

function renderPresetOptions() {
  fillSelect($('filter-preset'), [
    { value: '', label: 'Choose a preset…' },
    ...(S.settings?.filterPresets || []).map(preset => ({
      value: preset.name, label: `${preset.name}${preset.playerTeam ? ` · ${preset.playerTeam} players` : ''}`,
    })),
  ], S.appliedPreset?.name || '');
  $('filter-preset-delete').disabled = S.savingPreset || !(S.settings?.filterPresets || []).some(p => p.name === S.appliedPreset?.name);
  $('filter-preset-save').disabled = S.savingPreset || !S.game || !S.plays.length;
}

function syncFilterControls() {
  $('search').value = S.filter.text;
  $('sel-offense').value = S.filter.offense;
  $('sel-result').value = S.filter.result;
  $('adv-result-filter').value = S.filter.result;
  renderQuarters();
  document.querySelectorAll('#type-chips button').forEach(button => button.classList.toggle('on', button.dataset.type === S.filter.type));
  for (const [prefix, key] of [['air-yards', 'air'], ['yards', 'yards'], ['dist', 'dist']]) {
    for (const bound of ['min', 'max']) $(`${prefix}-${bound}`).value = S.filter[`${key}${bound === 'min' ? 'Min' : 'Max'}`] ?? '';
  }
}

function setResultFilter(value) {
  S.filter.result = value;
  $('sel-result').value = value;
  $('adv-result-filter').value = value;
  renderList();
}

function chooseFilterPreset(name, withoutPlayers = false) {
  const preset = (S.settings.filterPresets || []).find(p => p.name === name);
  S.pendingPreset = null;
  $('filter-preset-team').hidden = true;
  if (!preset) { renderPresetOptions(); return; }
  if (!S.game || !S.plays.length) {
    $('filter-preset-status').textContent = 'Load a game with play-by-play before applying a preset.';
    renderPresetOptions();
    return;
  }
  if (preset.playerTeam && preset.playerTeam !== S.sel.team && !withoutPlayers) {
    S.pendingPreset = preset.name;
    $('filter-preset-team-message').textContent =
      `“${preset.name}” uses specific players and is tied to ${A22.teams.teamName(preset.playerTeam)}, not ${A22.teams.teamName(S.sel.team)}. Apply all other filters without any players selected?`;
    $('filter-preset-team').hidden = false;
    renderPresetOptions();
    return;
  }
  try {
    S.filter = PRESETS.restore(preset, S.sel.team, filterOpponent(), withoutPlayers);
    S.appliedPreset = preset;
    syncFilterControls();
    renderAdvancedFilters();
    renderList();
    renderPresetOptions();
    $('filter-preset-status').textContent = `Applied “${preset.name}”${withoutPlayers ? ' without players' : ''}.`;
  } catch (e) {
    $('filter-preset-status').textContent = `Could not apply preset: ${e.message}`;
  }
}

async function saveFilterPreset(remove = false) {
  if (S.savingPreset) return;
  S.savingPreset = true;
  $('filter-preset-save').disabled = $('filter-preset-delete').disabled = true;
  try {
    const presets = S.settings.filterPresets || [];
    const filterBefore = JSON.stringify(S.filter);
    const teamBefore = S.sel.team;
    const gameBefore = S.sel.gameId;
    let captured;
    let next;
    if (remove) {
      next = presets.filter(p => p.name !== S.appliedPreset?.name);
    } else {
      if (!S.game || !S.plays.length) throw new Error('Load a game with play-by-play first.');
      const names = Object.fromEntries(choiceOptions(ADV_CHOICES.find(spec => spec.key === 'player')).map(([id, , name]) => [id, name]));
      const preset = PRESETS.capture($('filter-preset-name').value, S.filter, S.sel.team, filterOpponent(),
        { ...S.appliedPreset?.playerNames, ...names });
      if (presets.some(p => p.name.toLowerCase() === preset.name.toLowerCase())) throw new Error('That preset name already exists. Choose a new name.');
      next = [...presets, preset];
      captured = preset;
    }
    S.settings = mergeSettings(await window.api.saveSettings({ ...S.settings, filterPresets: next }));
    if (captured && S.sel.team === teamBefore && S.sel.gameId === gameBefore && JSON.stringify(S.filter) === filterBefore) {
      S.appliedPreset = captured;
    }
    $('filter-preset-status').textContent = remove ? 'Preset deleted. Current filters are unchanged.' : 'Current filters saved as a new preset.';
    if (!remove) $('filter-preset-name').value = '';
  } catch (e) {
    $('filter-preset-status').textContent = `Could not ${remove ? 'delete' : 'save'} preset: ${e.message}`;
  } finally {
    S.savingPreset = false;
    renderPresetOptions();
  }
}

function renderFilterDataWarning() {
  const source = filterSource();
  const messages = [];
  const participationChoices = ADV_CHOICES.filter(spec => ['player', 'offPersonnel', 'defPackage'].includes(spec.key) &&
    hasValue(S.filter.choices[spec.key]));
  const incomplete = participationChoices.some(spec => source.some(p => (p.cat === 'run' || p.cat === 'pass') &&
    (spec.key === 'player' ? spec.get(p).length < 22 : !hasValue(spec.get(p)))));
  const missing = ADV_CHOICES.filter(spec => hasValue(S.filter.choices[spec.key]) &&
    (spec.key === 'player'
      ? S.filter.choices.player.some(id => !source.some(p => spec.get(p).includes(id)))
      : !source.some(p => choiceMatches(S.filter.choices[spec.key], spec.get(p)))));
  if (missing.length) messages.push(`No matching data for: ${missing.map(spec => spec.label).join(', ')}. These filters remain applied; clear them to broaden results.`);
  const noPlayers = !source.some(p => p.onField?.offense?.length || p.onField?.defense?.length);
  const noPersonnel = !source.some(p => p.personnel?.offense) || !source.some(p => p.personnel?.defense);
  if (source.length && (noPlayers || noPersonnel || incomplete)) {
    messages.push('Player/personnel filtering needs participation data. If historical data is unavailable, capture this game with the optional NFL Pro extension (subscription required) and import its CSV. Personnel inference needs complete, supported player positions.');
  }
  if (missing.some(spec => ['qbLocation', 'motion', 'playAction', 'blitz', 'pressure', 'boxCategory', 'defPersonnelGroup'].includes(spec.key))) {
    messages.push('The updated NFL Pro extension can capture available NGS alignment, motion, play action, blitz/pressure flags, box categories, and personnel groups. Recapture the game to import them. Exact rush/blitz counts, RPO, screen, no-huddle, and coverage still need other data.');
  }
  if (incomplete) {
    messages.push('Only plays with the selected participation data match; missing or partial imports can omit matches.');
  }
  const el = $('filter-data-warning');
  el.hidden = !messages.length;
  el.textContent = messages.join(' ');
}

const YES_NO = [['true', 'Yes'], ['false', 'No']];
/**
 * Advanced select filters. Each is shown only when the loaded game has data for it. Option
 * values match exactly, or as "N+" (at least N) / "<=N" (at most N). `options: 'values'` lists
 * the values present in the game.
 */
const ADV_CHOICES = [
  { key: 'down', group: 'situation', label: 'Down', get: (p) => p.down, options: [['1', '1st'], ['2', '2nd'], ['3', '3rd'], ['4', '4th']] },
  { key: 'player', group: 'players', label: 'On-field player', get: (p) => [...(p.onField?.offense || []), ...(p.onField?.defense || [])].map(ADV.playerKey).filter(Boolean), options: 'players' },
  { key: 'offPersonnel', group: 'presnap', label: 'Off. personnel', get: (p) => ADV.formatOffensePackage(p.personnel?.offense, p), options: 'values', title: 'RB count then TE count; extra OL count as TEs, with total OL in parentheses. Direct snaps to backs/WRs append Wildcat; TE snaps or FTN QB sneaks append Tush push.' },
  { key: 'defPackage', group: 'defense', label: 'Def. package', get: (p) => p.personnel?.defense, options: 'values', order: ADV.DEFENSE_ORDER, title: 'Jumbo: 4+ DL, 2+ OLB and at most 4 DBs. Jumbo nickel: 3 DL, 1 OLB, 2 ILB/MLB and 5 DBs. 32 dime: 3 DL/OLB combined, 2 ILB/MLB and 6 DBs. Complete listed-position estimates. Otherwise 4 DBs: front (DL-LB); 5: Nickel; 6: Dime; 7+: Quarter; 3 or fewer: Goal line' },
  { key: 'qbLocation', group: 'presnap', label: 'QB alignment', get: (p) => p.charting?.qbLocation, options: 'values' },
  { key: 'formation', group: 'presnap', label: 'Formation', get: (p) => p.charting?.formation, options: 'values' },
  { key: 'backfield', group: 'presnap', label: 'Backfield', get: (p) => p.charting?.backfield, options: [['0', '0 (empty)'], ['1', '1'], ['2', '2'], ['3+', '3+']], title: 'Offensive players in the backfield, excluding the QB' },
  { key: 'box', group: 'defense', label: 'Box count', get: (p) => p.charting?.box, options: [['<=5', '5 or fewer'], ['6', '6'], ['7', '7'], ['8+', '8+']], title: 'Defenders in the box at the snap' },
  { key: 'rushers', group: 'passing', label: 'Pass rushers', get: (p) => p.charting?.rushers, options: [['<=3', '3 or fewer'], ['4', '4'], ['5+', '5+'], ['6+', '6+']] },
  { key: 'blitzers', group: 'passing', label: 'Blitzers', get: (p) => p.charting?.blitzers, options: [['0', 'No blitz'], ['1+', 'Blitz (1+)'], ['2+', '2+']] },
  { key: 'blitz', group: 'defense', label: 'NGS blitz', get: (p) => p.charting?.blitz, options: YES_NO, title: 'NFL Pro / Next Gen Stats flag, not an FTN blitzer count' },
  { key: 'pressure', group: 'defense', label: 'NGS pressure', get: (p) => p.charting?.pressure, options: YES_NO },
  { key: 'boxCategory', group: 'defense', label: 'NGS box', get: (p) => p.charting?.boxCategory, options: 'values', title: 'NFL Pro categories: Light (<7), Neutral (7), Stacked (8+). Does not supply an exact FTN box count.' },
  { key: 'defPersonnelGroup', group: 'defense', label: 'NGS personnel', get: (p) => p.charting?.defPersonnelGroup, options: 'values', title: 'NFL Pro Base/Nickel/Dime group, not a confirmed defensive front or inferred player-position package' },
  { key: 'motion', group: 'presnap', label: 'Motion', get: (p) => p.charting?.motion, options: YES_NO },
  { key: 'playAction', group: 'presnap', label: 'Play action', get: (p) => p.charting?.playAction, options: YES_NO },
  { key: 'rpo', group: 'presnap', label: 'RPO', get: (p) => p.charting?.rpo, options: YES_NO },
  { key: 'screen', group: 'presnap', label: 'Screen', get: (p) => p.charting?.screen, options: YES_NO },
  { key: 'noHuddle', group: 'presnap', label: 'No-huddle', get: (p) => p.charting?.noHuddle, options: YES_NO },
  { key: 'coverage', group: 'passing', label: 'Coverage', get: (p) => p.charting?.coverage, options: 'values' },
  { key: 'manZone', group: 'passing', label: 'Man/zone', get: (p) => p.charting?.manZone, options: 'values' },
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

function choiceOptions(spec, sourcePlays = filterSource()) {
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
  const scoped = choiceOptions(spec, filterSource().filter(p => passesFilter(p, 'player')));
  const remaining = scoped.filter(([id]) => !selected.includes(id));
  const counts = new Map();
  for (const play of filterSource()) {
    if (S.mode === 'analysis' && analysisSelectionMatches && !analysisSelectionMatches(play)) continue;
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
      return `<optgroup label="${esc(team ? A22.teams.teamName(team) : 'Unknown team')}">` +
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
      const name = all.find(([v]) => v === id)?.[2] || S.appliedPreset?.playerNames?.[id] || id;
      return `<li class="player-filter-tag"><span title="${esc(name)}">${esc(name)}</span>` +
        `<button type="button" data-remove-player="${esc(id)}" aria-label="Remove ${esc(name)} from on-field filter" title="Remove ${esc(name)}">&times;</button></li>`;
    }).join('') + `</ul><small id="on-field-player-help" class="muted">Match all selected players. Counts include other filters. Only matching players are listed.</small>`;
  if (el.innerHTML !== html) el.innerHTML = html;
}

/** Preset selections stay explicit even when the game cannot satisfy them. */
function renderAdvancedFilters() {
  const groups = { situation: [], presnap: [], passing: [], defense: [], players: [] };
  const choices = {};
  const source = filterSource();
  const preserve = S.mode === 'analysis' || !!S.appliedPreset;
  for (const spec of ADV_CHOICES) {
    const group = spec.group;
    const cur = S.filter.choices[spec.key];
    if (!source.some((p) => hasValue(spec.get(p))) && !(preserve && hasValue(cur))) continue;
    const opts = choiceOptions(spec).slice();
    if (spec.options === 'players') {
      const selected = [...new Set(Array.isArray(cur) ? cur : cur ? [cur] : [])].filter((id) => preserve || opts.some(([v]) => v === id));
      if (selected.length) choices[spec.key] = selected;
      groups[group].push('<div id="player-choice" class="player-choice"></div>');
      continue;
    }
    if (cur && (preserve || opts.some(([v]) => v === cur))) choices[spec.key] = cur;
    if (preserve && cur && !opts.some(([v]) => v === cur)) {
      opts.push([cur, `${cur} (${S.mode === 'analysis' ? 'not in scope' : 'unavailable this game'})`]);
    }
    groups[group].push(`<label${spec.title ? ` title="${esc(spec.title)}"` : ''}>${esc(spec.label)}<select data-choice="${spec.key}">` +
      `<option value="">Any</option>${opts.map(([v, l]) => `<option value="${esc(v)}"${choices[spec.key] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`);
  }
  S.filter.choices = choices;
  for (const [key, html] of Object.entries(groups)) {
      $(`adv-${key}`).innerHTML = html.join('');
      if (key !== 'situation') $(`filter-${key}`).hidden = !html.length;
  }
  renderPlayerFilter();
  renderFilterCounts();
  $('adv-note').hidden = !source.length || source.some((p) => p.personnel || p.charting);
  updateAdvancedIndicator();
  renderFilterDataWarning();
  renderPresetOptions();
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

function clearAllFilters() {
  S.filter = PRESETS.emptyFilter();
  S.appliedPreset = null;
  S.pendingPreset = null;
  $('filter-preset-team').hidden = true;
  $('filter-preset-status').textContent = '';
  if (S.mode === 'analysis') analysisLab?.clearSelectionFilter();
  syncFilterControls();
  renderAdvancedFilters();
  renderList();
  $('search').focus();
}

function passesFilter(p, excludedChoice) {
  const f = S.filter;
  if (excludedChoice !== 'type' && ['run', 'pass', 'special'].includes(f.type) && p.cat !== f.type) return false;
  if (excludedChoice !== 'offense' && f.offense && p.posteam !== f.offense) return false;
  if (excludedChoice !== 'qtr' && f.qtr && String(p.qtr) !== f.qtr) return false;
  if (excludedChoice !== 'result' && f.result && RESULT_FILTERS[f.result] && !RESULT_FILTERS[f.result](p)) return false;
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

function filterChoiceCount(key, value, source = filterSource()) {
  const spec = ADV_CHOICES.find(spec => spec.key === key);
  return source.reduce((count, play) => {
    if (S.mode === 'analysis' && analysisSelectionMatches && !analysisSelectionMatches(play)) return count;
    if (!passesFilter(play, key)) return count;
    let matches = !value;
    if (value) {
      if (key === 'type') matches = value === 'all' || play.cat === value;
      else if (key === 'offense') matches = play.posteam === value;
      else if (key === 'qtr') matches = String(play.qtr) === value;
      else if (key === 'result') matches = RESULT_FILTERS[value](play);
      else matches = choiceMatches(value, spec.get(play));
    }
    return count + (matches ? 1 : 0);
  }, 0);
}

function renderFilterCounts() {
  const source = filterSource();
  const selects = [
    [$('sel-offense'), 'offense'], [$('sel-qtr'), 'qtr'], [$('sel-result'), 'result'], [$('adv-result-filter'), 'result'],
    ...Array.from(document.querySelectorAll('#adv-choices select:not([data-choice="player"]):not([data-result-filter])'),
      select => [select, select.dataset.choice]),
  ];
  for (const [select, key] of selects) {
    for (const option of select.options || []) {
      // Keep the original label so repeated refreshes never accumulate count suffixes.
      const label = option.dataset.countLabel ??= option.textContent;
      const count = filterChoiceCount(key, option.value, source);
      const text = `${label} (${count})`;
      if (option.textContent !== text) option.textContent = text;
      option.title = `${label}: ${count} matching ${count === 1 ? 'play' : 'plays'} with other filters applied`;
    }
  }
  for (const button of document.querySelectorAll('#type-chips button')) {
    const label = button.dataset.countLabel ??= button.textContent;
    const count = filterChoiceCount('type', button.dataset.type, source);
    button.innerHTML = `${esc(label)} <span class="filter-choice-count">(${count})</span>`;
    button.title = `${label}: ${count} matching ${count === 1 ? 'play' : 'plays'} with other filters applied`;
  }
  $('clear-filters').hidden = !(S.filter.text || ['run', 'pass', 'special'].includes(S.filter.type) ||
    S.filter.offense || S.filter.qtr || S.filter.result || activeAdvancedCount() ||
    (S.mode === 'analysis' && analysisLab?.hasSelectionFilter()));
  renderActiveFilterChips();
}

function renderActiveFilterChips() {
  const chips = [];
  const add = (key, label, value = '') => chips.push(`<span class="active-filter-chip">${esc(label)}<button type="button" data-clear-filter="${esc(key)}" data-filter-value="${esc(value)}" aria-label="Remove ${esc(label)} filter">&times;</button></span>`);
  const f = S.filter;
  if (f.text) add('text', `Search: ${f.text}`);
  if (f.type !== 'all') add('type', f.type === 'special' ? 'Special teams' : f.type);
  if (f.offense) add('offense', `Offense: ${f.offense}`);
  if (f.qtr) add('qtr', `Quarter: ${f.qtr}`);
  if (f.result) add('result', `Result: ${f.result}`);
  for (const key of Object.keys(RANGE_FILTERS)) {
    for (const bound of ['Min', 'Max']) {
      const value = f[`${key}${bound}`];
      if (value != null) add(`${key}${bound}`, `${key === 'air' ? 'Air yards' : key === 'dist' ? 'Yards to go' : 'Yards'} ${bound === 'Min' ? '≥' : '≤'} ${value}`);
    }
  }
  for (const [key, value] of Object.entries(f.choices)) {
    for (const selected of Array.isArray(value) ? value : value ? [value] : []) {
      const name = key === 'player'
        ? choiceOptions(ADV_CHOICES.find(spec => spec.key === key)).find(([id]) => id === selected)?.[2] || selected
        : `${ADV_CHOICES.find(spec => spec.key === key)?.label || key}: ${selected}`;
      add(`choice:${key}`, name, selected);
    }
  }
  $('active-filter-chips').innerHTML = chips.join('');
}

function clearOneFilter(key, value) {
  if (key === 'text') S.filter.text = '';
  else if (key === 'type') S.filter.type = 'all';
  else if (key === 'offense' || key === 'qtr' || key === 'result') S.filter[key] = '';
  else if (/^(yards|air|dist)(Min|Max)$/.test(key)) S.filter[key] = null;
  else if (key.startsWith('choice:')) {
    const choice = key.slice(7);
    const current = S.filter.choices[choice];
    if (Array.isArray(current)) {
      const next = current.filter(item => item !== value);
      if (next.length) S.filter.choices[choice] = next;
      else delete S.filter.choices[choice];
    } else delete S.filter.choices[choice];
  }
  syncFilterControls();
  renderAdvancedFilters();
  renderList();
}

function renderQuarters() {
  const qs = [...new Set(filterSource().map((p) => p.qtr).filter((q) => q != null))].sort((a, b) => a - b);
  if (S.mode === 'analysis' && S.filter.qtr && !qs.includes(Number(S.filter.qtr))) qs.push(Number(S.filter.qtr));
  const opts = [{ value: '', label: 'All quarters' }].concat(qs.map((q) => ({ value: String(q), label: q >= 5 ? (q === 5 ? 'OT' : `OT${q - 4}`) : `Q${q}` })));
  if (S.appliedPreset && S.filter.qtr && !opts.some(o => o.value === S.filter.qtr)) {
    opts.push({ value: S.filter.qtr, label: `Q${S.filter.qtr} (unavailable)` });
  }
  if (!opts.some((o) => o.value === S.filter.qtr)) S.filter.qtr = '';
  fillSelect($('sel-qtr'), opts, S.filter.qtr);
}

function renderParticipationStatus() {
  const imported = S.plays.filter((p) => p.participation?.source === 'NFL Pro');
  const el = $('participation-status');
  el.hidden = S.mode === 'analysis' || !S.game || (!S.settings.participationRoot && !imported.length);
  if (el.hidden) return;
  const complete = imported.filter((p) => p.participation.status === 'complete').length;
  const charted = S.plays.filter(p => p.nflProCharting).length;
  const summary = (imported.length
    ? `NFL Pro: ${imported.length} ${imported.length === 1 ? 'play' : 'plays'} imported · ${complete} complete, ${imported.length - complete} partial`
    : 'NFL Pro: no matching plays imported yet') + (charted ? ` · ${charted} with NGS charting` : '');
  const notice = S.participationWarning
    ? `Data warning: ${S.participationWarning}`
    : S.participationNotice || 'Watching the configured CSV folder. No manual refresh needed.';
  if ($('participation-summary').textContent !== summary) $('participation-summary').textContent = summary;
  if ($('participation-notice').textContent !== notice) $('participation-notice').textContent = notice;
  el.classList.toggle('warning', !!S.participationWarning);
}

function renderList({ refreshAnalysis = true } = {}) {
  S.visible = [];
  const html = [];
  const analysisKeys = S.mode === 'analysis' && analysisFilterSource !== null
    ? new Set(analysisFilterSource.map(A22.analysis.playKey)) : null;
  const anchors = corrections().anchors || {};
  let drive = null;
  let shade = false;
  S.plays.forEach((p, i) => {
    if (analysisKeys && !analysisKeys.has(A22.analysis.playKey(p))) return;
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
    const annotation = S.gameData.playAnnotations?.[p.playId];
    if (annotation?.bookmarked) badges.push('<span class="badge bookmark" title="Bookmarked play">★</span>');
    if (annotation?.note || annotation?.tags?.length) badges.push('<span class="badge note" title="Has a private note or tags">Note</span>');
    if (String(p.playId) in anchors) badges.push('<span class="badge fix" title="Manually corrected">✎</span>');
    if (noFilm) badges.push('<span class="badge nofilm">no film</span>');
    html.push(
      `<li data-i="${i}" class="${cls}" tabindex="0" role="option" aria-selected="${i === S.curPlay}"><div class="r1"><input class="play-check" type="checkbox" hidden aria-label="Select ${esc(P.clockLabel(p))} for export"${S.selected.has(i) ? ' checked' : ''} /><span class="clock">${esc(P.clockLabel(p))}</span>` +
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
  renderFilterCounts();
  renderFilterDataWarning();
  if (refreshAnalysis) analysisLab?.refresh();
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
  const supplied = Object.keys(p?.chartingSources || {}).filter(key => p.chartingSources[key] === 'NFL Pro / NGS');
  if (supplied.length) tags.push(`NFL Pro / NGS: ${supplied.map(key => ADV_CHOICES.find(spec => spec.key === key)?.label || key).join(', ')}`);
  for (const [key, conflict] of Object.entries(p?.chartingConflicts || {})) {
    const label = ADV_CHOICES.find(spec => spec.key === key)?.label || key;
    const display = value => typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
    tags.push(`Data disagreement: ${label} · ${conflict.source} ${display(conflict.value)} retained; NFL Pro ${display(conflict.nflPro)}`);
  }
  $('play-adv').innerHTML = tags.map((t) => `<span class="tag${t.startsWith('Data disagreement:') ? ' warning' : ''}">${esc(t)}</span>`).join('');
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
  $('play-info').hidden = !S.game || !S.plays.length;
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
  renderPlayActions(p);
  renderAlignmentTimeline();
  const pairInfo = S.curPair >= 0 && S.pairs[S.curPair]
    ? `Clip ${S.curPair + 1} / ${S.pairs.length} @ ${fmtTime(S.pairs[S.curPair].sideline.start)}`
    : S.pairs.length ? 'No clip' : '';
  const linked = p && S.mapping[S.curPlay] === S.curPair;
  $('clip-label').textContent = pairInfo + (p && S.curPair >= 0 && !linked ? '  (browsing — not linked to this play)' : '');
  updateOffsetLabel();
}

function playAnnotation(play = S.plays[S.curPlay]) {
  return play ? S.gameData.playAnnotations?.[play.playId] || { bookmarked: false, note: '', tags: [] } : null;
}

function renderPlayActions(play) {
  const annotation = playAnnotation(play);
  const disabled = !play || !S.sel.gameId;
  $('play-bookmark').disabled = disabled;
  $('play-note').disabled = disabled;
  $('play-playlist').disabled = disabled;
  $('play-playlist-manage').disabled = disabled;
  $('play-export-playlist').disabled = disabled || !(S.gameData.playlists || []).some(list => list.playIds?.length);
  $('play-bookmark').setAttribute('aria-pressed', String(!!annotation?.bookmarked));
  $('play-bookmark').textContent = annotation?.bookmarked ? '★ Bookmarked' : '☆ Bookmark';
  $('play-note').textContent = annotation?.note || annotation?.tags?.length ? 'Edit note' : 'Add note';
  const lists = S.gameData.playlists || [];
  const selectedList = lists.find(list => list.playIds?.includes(String(play?.playId)))?.name || '';
  $('play-playlist').innerHTML = `<option value="">No playlist</option>${lists.map(list =>
    `<option value="${esc(list.name)}"${list.name === selectedList ? ' selected' : ''}>${esc(list.name)}</option>`).join('')}`;
}

async function savePlayAnnotation(playId, patch) {
  const current = S.gameData.playAnnotations?.[playId] || { bookmarked: false, note: '', tags: [] };
  await saveGame({ playAnnotations: {
    ...S.gameData.playAnnotations, [playId]: { ...current, ...patch },
  } });
  derivePlays();
  renderList();
  renderInfo();
}

async function setPlayPlaylist(name) {
  const play = S.plays[S.curPlay];
  if (!play) return;
  const id = String(play.playId);
  const playlists = (S.gameData.playlists || []).map(list => ({
    ...list, playIds: (list.playIds || []).filter(playId => playId !== id),
  }));
  if (name) {
    const target = playlists.find(list => list.name === name);
    if (target) target.playIds.push(id);
  }
  await saveGame({ playlists });
  renderPlayActions(play);
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
    S.selectionAnchor = i;
    if (S.mode !== 'analysis') {
      S.selected = new Set([i]);
      S.multiSelect = false;
    }
  }
  S.curPlay = i;
  try { localStorage.setItem(`amp22.lastPlay.${S.sel.gameId}.${S.sel.team}`, String(S.plays[i].playId)); }
  catch (error) { setStatus(`Last-play preference could not be saved: ${error.message}`, true); }
  markSelected();
  updateSelection();
  const pi = S.mapping[i];
  if (pi != null && S.pairs[pi]) {
    loadPair(pi, { autoplay });
  } else {
    pause();
    S.curPair = -1;
    S.range = null;
    renderInfo();
    if (isSplitFilm() && !A22.align.filmRole(S.plays[i], S.sel.team)) {
      showMessage('This play cannot be classified as offense, defense, or special teams and has no linked film.');
    } else if (isSplitFilm() && !S.splitFilms[A22.align.filmRole(S.plays[i], S.sel.team)]) {
      S.filmSetupOpen = true;
      showMessage('Choose the matching offense, defense, or special-teams file to watch this play.');
    } else if (S.film && S.pairs.length) showMessage('No film linked to this play.<br><span class="muted">Browse clips with Shift+↑/↓ and press Shift+L to link one.</span>');
  }
}

/* ---------------- clip export ---------------- */

function notifyAnalysisSelection() {
  if (S.mode === 'analysis') analysisLab?.selectionChanged(S.plays.filter((_play, index) => S.selected.has(index)));
}

function updateSelection() {
  const multi = S.mode === 'analysis' ? S.multiSelect : S.multiSelect || S.selected.size > 1;
  const showSelection = multi || (S.mode === 'analysis' && S.selected.size > 0);
  $('selection-bar').hidden = !showSelection;
  $('selection-count').textContent = `${S.selected.size} selected`;
  $('selection-count').hidden = !showSelection;
  $('btn-clear-selection').hidden = !showSelection;
  $('btn-clear-selection').disabled = !S.selected.size;
  $('btn-multi-select').setAttribute('aria-pressed', String(multi));
  $('btn-share').disabled = S.exporting || !S.selected.size || !S.film || !S.pairs.length;
  $('btn-export-data').disabled = !S.plays.length;
  $('btn-share').title = $('btn-share').disabled
    ? 'Select at least one play with linked film to export a clip'
    : `Export ${S.selected.size} selected play${S.selected.size === 1 ? '' : 's'} as a video clip`;
  $('btn-export-data').title = S.plays.length ? 'Export play statistics and participation without film' : 'Load a game before exporting statistics';
  $('play-list').querySelectorAll('li[data-i]').forEach((el) => {
    const selected = S.selected.has(Number(el.dataset.i));
    el.setAttribute('aria-selected', String(Number(el.dataset.i) === S.curPlay));
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
  $('export-preset').value = 'custom';
  try {
    const savedMode = localStorage.getItem('amp22.export.mode') || 'quick';
    setExportMode(savedMode === 'customize' ? 'customize' : 'quick', false);
    const preset = localStorage.getItem('amp22.export.preset');
    if (preset && ['social', 'coach', 'review'].includes(preset)) {
      $('export-preset').value = preset;
      applyExportPreset(preset, false);
    } else {
      const angle = localStorage.getItem('amp22.export.angle');
      if (['sideline', 'endzone', 'both', 'sideline-first', 'endzone-first'].includes(angle)) $('share-angle').value = angle;
    }
  } catch (error) { setStatus(`Export preferences could not be loaded: ${error.message}`, true); }
  highlightEditor?.select(null);
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
      const highlightKey = JSON.stringify([S.sel.team, S.plays[i].playId, film.path, film.size, film.mtimeMs,
        pair.sideline.start, pair.sideline.end, pair.endzone.start, pair.endzone.end]);
      return {
        ...A22.clipExport.clipRange(pair, film.info.fps || 59.94, offsetFrames(pairIdx)),
        file: film.path, url: film.url, info: film.info, fps: film.info.fps || 59.94,
        play: S.plays[i], playNumber: i + 1, trim: S.settings.exportTrim, highlightKey, gameId: S.sel.gameId,
        highlights: structuredClone(S.gameData.playerHighlights?.[highlightKey] || {}),
      };
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

function setExportMode(mode, persist = true) {
  const customized = mode === 'customize';
  $('share-advanced').hidden = !customized;
  $('export-customize-mode').setAttribute('aria-pressed', String(customized));
  $('export-quick-mode').setAttribute('aria-pressed', String(!customized));
  if (persist) {
    try { localStorage.setItem('amp22.export.mode', mode); }
    catch (error) { setStatus(`Export preference could not be saved: ${error.message}`, true); }
  }
}

function applyExportPreset(preset, persist = true) {
  if (preset === 'social') {
    $('share-angle').value = 'both';
    $('share-clean').checked = false;
    $('share-overlay-seconds').value = S.settings.overlaySeconds;
    $('share-report-format').value = 'none';
  } else if (preset === 'coach') {
    $('share-angle').value = 'sideline';
    $('share-clean').checked = true;
    $('share-report-format').value = 'none';
  } else if (preset === 'review') {
    $('share-angle').value = 'both';
    $('share-clean').checked = false;
    $('share-overlay-seconds').value = S.settings.overlaySeconds;
    $('share-report-format').value = 'pdf';
  }
  $('share-clean').dispatchEvent(new Event('change'));
  updateReportOptions();
  queueTrimPreview();
  if (persist) {
    try { localStorage.setItem('amp22.export.preset', preset); }
    catch (error) { setStatus(`Export preset could not be saved: ${error.message}`, true); }
  }
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
    const tracking = !!highlightEditor?.busy() && !$('share-clean').checked;
    if (tracking) $('share-status').textContent = 'Player tracking is running in the background. Finish or cancel tracking before exporting highlights, or choose Clean export.';
    $('share-export').disabled = S.exporting || positionSaving || tracking;
  } catch (e) {
    $('share-status').textContent = e.message;
    $('share-status').classList.add('error');
    $('share-export').disabled = true;
  }
}

let sharePosition = { preset: 'original' };
let positionFrames = null;
let positionHeadshots = null;
let positionHeadshotPromise = null;
let positionCard = null;
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
  $('highlight-canvas').setAttribute('aria-disabled', String($('share-positioning').disabled));
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
  positionCard = null;
  highlightEditor?.refresh();
}

function drawCutupPreview({ canvas, clip, angle, video, otherVideo, time, drawTrack }) {
  const mode = $('share-angle').value;
  const clean = $('share-clean').checked;
  positionBounds = null;
  const { width, height } = A22.clipExport.dimensions(mode);
  canvas.width = width;
  canvas.height = height;
  const previewHeight = Math.max(120, $('highlight-editor').clientHeight - ($('highlight-progress-panel').hidden ? 190 : 270));
  canvas.style.width = `min(100%, ${previewHeight * width / height}px)`;
  canvas.style.margin = '10px auto';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = clean || sharePosition.preset !== 'original' ? 'black' : '#0d1117';
  ctx.fillRect(0, 0, width, height);
  const viewports = {};
  function drawFrame(source, camera) {
    const geometry = A22.tracking.geometry(mode === 'both' ? 'both' : camera, camera,
      { width: source.videoWidth, height: source.videoHeight }, clean || sharePosition.preset !== 'original');
    viewports[camera] = geometry;
    ctx.drawImage(source, geometry.x, geometry.y, geometry.w, geometry.h);
    const timestamp = (camera === 'sideline' ? clip.aStart : clip.bStart) + clip.trim + time;
    drawTrack(ctx, geometry, camera, timestamp);
  }
  if (mode === 'both') {
    drawFrame(angle === 'sideline' ? video : otherVideo, 'sideline');
    drawFrame(angle === 'endzone' ? video : otherVideo, 'endzone');
  } else {
    drawFrame(video, angle);
  }
  if (!clean && time < $('share-overlay-seconds').valueAsNumber) {
    if (!positionCard || positionCard.clip !== clip || positionCard.mode !== mode) {
      positionCard = { clip, mode, ...buildPlayCard(clip.play, mode, S.exportDraft.matchup,
        positionHeadshots?.images.get(P.primaryPlayer(clip.play)?.id), sharePosition) };
    }
    const card = positionCard;
    ctx.drawImage(card.canvas, 0, 0);
    positionBounds = card.bounds;
    if (sharePosition.preset !== 'custom') {
      $('share-position-x').value = positionBounds.x / Math.max(1, width - positionBounds.width) * 100;
      $('share-position-y').value = positionBounds.y / Math.max(1, height - positionBounds.height) * 100;
    }
  }
  const warnings = positionHeadshots?.warnings;
  $('share-position-status').textContent = clean ? 'Clean export: overlays are disabled.'
    : !positionBounds ? 'Play information is hidden at this time; player highlights keep their own timing.'
    : `Choose Move play information to drag the card.${warnings?.size ? ` Headshot notices: ${[...warnings].join('; ')}` : ''}`;
  $('share-preview-status').textContent = `${(clip.len - clip.trim).toFixed(2)} seconds retained${mode === 'both' ? ' per camera' : ''}.${mode.endsWith('-first') ? ' Preview camera changes do not change export block order.' : ''}`;
  positionFrames = { clip, mode };
  return viewports;
}

function setCustomPosition(x, y) {
  sharePosition = { preset: 'custom', x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  $('share-position').value = 'custom';
  $('share-location-delete').disabled = true;
  $('share-position-saved').textContent = '';
  updatePositionControls();
}

function positionPoint(event) {
  const canvas = $('highlight-canvas');
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
}

function startPositionDrag(event) {
  if (event.button !== 0 || $('highlight-tool').value !== 'overlay' || $('share-positioning').disabled || !positionBounds || !highlightEditor.ready()) return;
  highlightEditor?.pause();
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
  $('highlight-canvas').setPointerCapture(event.pointerId);
}

function movePositionDrag(event) {
  if (!positionDrag || event.pointerId !== positionDrag.id || !positionBounds || $('share-positioning').disabled) return;
  const point = positionPoint(event);
  const canvas = $('highlight-canvas');
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
  positionFrames = null;
  const clip = S.exportDraft?.clips[Number($('share-preview-play').value)];
  try {
    if (clip) A22.clipExport.trimRange(clip, clip.trim);
    highlightEditor?.select(clip || null);
    loadPositionHeadshots();
  } catch (e) {
    highlightEditor?.select(null);
    $('share-preview-status').textContent = `Preview unavailable: ${e.message}`;
    $('share-status').textContent = `Preview unavailable: ${e.message}`;
    $('share-status').classList.add('error');
  }
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
  if (!S.exportDraft || S.exporting || positionSaving || highlightEditor?.busy() && !$('share-clean').checked) return;
  highlightEditor?.pause();
  S.exporting = true;
  highlightEditor?.refresh();
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
    let clips = trimmedExportClips();
    const overlaySeconds = clean ? 0 : $('share-overlay-seconds').valueAsNumber;
    const appearance = currentOverlayAppearance();
    if (!Number.isFinite(overlaySeconds) || overlaySeconds < 0) throw new Error('Invalid overlay duration.');
    const report = {
      ...REPORT.mergeOptions(S.settings.playReport),
      format: $('share-report-format').value,
      includeAdvanced: $('share-report-advanced').checked,
      matchup, team, plays: A22.clipExport.exportSequence(clips, mode).map(({ clip }) => clip.play),
      packages: analysisLab?.getPackages(),
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
    if (!clean) {
      const highlighted = await highlightEditor.export(clips, mode, appearance, sharePosition.preset !== 'original');
      clips = highlighted.clips;
      highlighted.warnings.forEach(warning => warnings.add(warning));
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
      clips: clips.map(({ play, playNumber, info, fps, url, highlightKey, gameId, highlights, ...range }) => clean ? range : {
        ...range, highlights, card: playCard(play, mode, matchup, images.get(P.primaryPlayer(play)?.id), sharePosition, appearance),
      }),
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
    highlightEditor?.refresh();
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
  commandPalette: openCommandPalette,
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
  highlightEditor?.pause();
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

function updateCutDetectionField() {
  const preset = $('set-cut-preset').value;
  $('set-cut').hidden = preset !== 'custom';
  $('set-cut-hint').textContent = preset === 'auto'
    ? 'Tries several sensitivities and keeps the one that best matches the game’s play-by-play.'
    : 'Uses one fixed sensitivity for every film. Lower values find subtler camera cuts.';
}

function renderSettings() {
  if (!draft) draft = JSON.parse(JSON.stringify(S.settings));
  $('set-jump').value = draft.jumpFrames;
  $('set-end').value = draft.endOfPlay;
  $('set-speeds').value = draft.speeds.join(', ');
  $('set-player-sort').value = draft.playerFilterSort;
  $('set-ui-theme').value = draft.uiTheme;
  $('set-text-scale').value = String(draft.textScale);
  $('set-sidebar-width').value = draft.sidebarWidth;
  fillSelect($('set-team'), Object.keys(A22.teams.TEAMS).filter((t) => !['OAK', 'SD', 'STL'].includes(t)).sort().map((t) => ({ value: t, label: `${t} – ${A22.teams.teamName(t)}` })), draft.defaultTeam);
  $('set-root').value = draft.filmRoot || '';
  $('set-participation-root').value = draft.participationRoot || '';
  $('set-auto').checked = draft.autoAnalyze;
  $('set-skipnofilm').checked = draft.skipNoFilm;
  $('set-cut').value = draft.cutThreshold;
  $('set-cut-preset').value = draft.cutMode === 'auto' ? 'auto' : [0.1, 0.06].includes(draft.cutThreshold) ? String(draft.cutThreshold) : 'custom';
  updateCutDetectionField();
  $('set-export-trim').value = draft.exportTrim;
  $('set-overlay-seconds').value = draft.overlaySeconds;
  $('set-report-format').value = draft.playReport.format;
  $('set-report-advanced').checked = draft.playReport.includeAdvanced;
  $('set-report-fields').innerHTML = REPORT.ADVANCED_FIELDS.map((f) =>
    `<label><input id="set-report-${f.key}" type="checkbox"${draft.playReport.fields.includes(f.key) ? ' checked' : ''} /> ${esc(f.label)}</label>`).join('');
  const savedFields = new Set(draft.playReport.fields);
  $('set-report-preset').value = Object.entries(REPORT_FIELD_PRESETS).find(([, fields]) =>
    fields.length === savedFields.size && fields.every((key) => savedFields.has(key)))?.[0] || 'custom';
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
  d.uiTheme = $('set-ui-theme').value;
  d.textScale = Number($('set-text-scale').value);
  d.sidebarWidth = Number($('set-sidebar-width').value);
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
  const preset = $('set-cut-preset').value;
  d.cutMode = preset === 'auto' ? 'auto' : 'manual';
  const cut = preset === 'custom' ? Number($('set-cut').value) : preset === 'auto' ? Number(d.cutThreshold) : Number(preset);
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
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCommandPalette();
    return;
  }
  if (!$('command-palette').hidden && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
    const options = [...$('command-results').querySelectorAll('[role=option]')];
    if (e.key === 'Enter') {
      e.preventDefault();
      $('command-results').querySelector('[aria-selected="true"]')?.click();
    } else {
      e.preventDefault();
      const current = options.findIndex(item => item.getAttribute('aria-selected') === 'true');
      const next = options[(current + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length];
      options.forEach(item => item.setAttribute('aria-selected', String(item === next)));
      next?.scrollIntoView({ block: 'nearest' });
    }
    return;
  }
  if (e.key === 'Escape') {
    if (S.exporting) return;
    const activeOverlay = [...document.querySelectorAll('.overlay')].find((overlay) => !overlay.hidden);
    if (activeOverlay) {
      if (!$('settings').hidden) applyComfortSettings(S.settings);
      document.querySelectorAll('.overlay').forEach((overlay) => { overlay.hidden = true; });
      if (!$('play-note-dialog').hidden) $('play-note-dialog').hidden = true;
      draft = null;
      return;
    }
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    return;
  }
  if (!$('settings').hidden || !$('share').hidden) return;
  if (e.target.classList.contains('play-check') && e.key === ' ') return;
  if (isTextTarget(e.target)) {
    if (e.target.id === 'search' && (e.key === 'Enter' || e.key === 'ArrowDown')) { e.preventDefault(); e.target.blur(); if (S.visible.length) selectPlay(S.visible[0]); }
    return;
  }
  if (S.mode === 'analysis') return;
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
  window.addEventListener('resize', () => highlightEditor?.refresh());
  window.api.onMenuAction((action) => {
    if (action === 'open-film') $('btn-film').click();
    else if (action === 'game-library') openGameLibrary();
    else if (action === 'export-clip') $('btn-share').click();
    else if (action === 'command-palette') openCommandPalette();
    else if (action === 'settings') $('btn-settings').click();
    else if (action === 'help') $('btn-help').click();
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (S.settings?.uiTheme === 'system') applyComfortSettings(S.settings);
  });
  const resizer = $('sidebar-resizer');
  let resizePointer = null;
  const setSidebarWidth = (width) => {
    const value = Math.max(300, Math.min(560, Math.round(width)));
    document.documentElement.style.setProperty('--sidebar-width', `${value}px`);
    resizer.setAttribute('aria-valuenow', String(value));
  };
  resizer.addEventListener('pointerdown', (event) => {
    resizePointer = event.pointerId;
    resizer.setPointerCapture(event.pointerId);
  });
  resizer.addEventListener('pointermove', (event) => {
    if (resizePointer === event.pointerId) setSidebarWidth(event.clientX - $('sidebar').getBoundingClientRect().left);
  });
  resizer.addEventListener('pointerup', async (event) => {
    if (resizePointer !== event.pointerId) return;
    resizePointer = null;
    try {
      const width = Number(resizer.getAttribute('aria-valuenow'));
      applySettings(await window.api.saveSettings({ ...S.settings, sidebarWidth: width }));
    } catch (error) { setStatus(`Sidebar width could not be saved: ${error.message}`, true); }
  });
  resizer.addEventListener('keydown', async (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -20 : 20;
    const width = Math.max(300, Math.min(560, Number(resizer.getAttribute('aria-valuenow')) + delta));
    setSidebarWidth(width);
    try { applySettings(await window.api.saveSettings({ ...S.settings, sidebarWidth: width })); }
    catch (error) { setStatus(`Sidebar width could not be saved: ${error.message}`, true); }
  });
  highlightEditor = A22.createHighlightEditor({
    defaults: () => S.settings?.highlightDefaults,
    appearance: currentOverlayAppearance,
    mode: () => $('share-angle').value,
    renderPreview: drawCutupPreview,
    openPlayer: () => { $('highlight-section').open = true; },
    themes: () => [
      ...Object.keys(A22.teams.TEAMS).map(id => ({ value: `team-${id}`, label: A22.teams.teamName(id), theme: A22.overlay.teamTheme(id) })),
      ...S.settings.overlayThemes.map((item, i) => ({ value: `saved-${i}`, label: item.name, theme: A22.overlay.theme(item) })),
    ],
    saveTheme: async ({ name, theme, remove }) => {
      if (positionSaving || S.exporting) throw new Error('Wait for the current save or export to finish.');
      const themes = S.settings.overlayThemes.slice();
      if (remove !== null) themes.splice(remove, 1);
      else {
        const index = themes.findIndex(item => item.name === name);
        themes[index < 0 ? themes.length : index] = { name, ...theme };
      }
      positionSaving = true;
      updatePositionControls(); updateExportOptions();
      try {
        applySettings(await window.api.saveSettings({ ...S.settings, overlayThemes: themes }));
        renderThemeOptions(shareTheme ? 'custom' : 'auto');
      } finally {
        positionSaving = false;
        updatePositionControls(); updateExportOptions();
      }
    },
    isClean: () => $('share-clean').checked || S.exporting,
    preparePhoto: trimHeadshot,
    players: clip => {
      const players = [...(clip.play.onField?.offense || []), ...(clip.play.onField?.defense || []), P.primaryPlayer(clip.play)].filter(p => p?.id);
      return [...new Map(players.map(p => [p.id, p])).values()];
    },
    onBusy: () => updateExportOptions(),
    save: async (clip, value) => {
      const saved = await window.api.getGame(clip.gameId);
      const data = await window.api.saveGame(clip.gameId, { playerHighlights: { ...saved.playerHighlights, [clip.highlightKey]: value } });
      if (S.sel.gameId === clip.gameId) S.gameData = data;
    },
    saveDefaults: async value => {
      applySettings(await window.api.saveSettings({ ...S.settings, highlightDefaults: value }));
    },
  });
  window.createCloudAISettings();
  analysisLab = window.createAnalysisLab({
    getContext: () => ({ games: S.games, sel: S.sel, game: S.game, plays: S.plays, warning: S.participationWarning }),
    preparePlays: derivePlays,
    matchesFilter: passesFilter,
    filterDescription: analysisFilterDescription,
    onCohortChange: (plays, selectionMatches) => {
      analysisFilterSource = plays;
      analysisSelectionMatches = selectionMatches || null;
      if (plays === null) return;
      const teams = [...new Set(plays.map((p) => p.posteam).filter(Boolean))].sort();
      renderOffenseOptions(teams);
      renderAdvancedFilters();
      renderQuarters();
      renderList({ refreshAnalysis: false });
    },
    onSelectionChange: (keys) => {
      const selected = new Set(keys);
      S.selected = new Set(S.plays.flatMap((play, index) =>
        selected.has(A22.analysis.playKey(play)) ? [index] : []));
      if (S.selected.size) S.multiSelect = true;
      updateSelection();
    },
    openPlay: async (play) => {
      if (!play) return;
      if (S.sel.gameId !== play.gameId) {
        S.sel.gameId = play.gameId;
        renderSelectors();
        await loadGame();
      }
      const index = S.plays.findIndex((p) => p.playId === play.playId);
      if (index >= 0) selectPlay(index, { autoplay: false });
    },
  });
  $('mode-film').addEventListener('click', () => { if (S.mode !== 'film') setWorkspaceMode('film'); });
  $('mode-analysis').addEventListener('click', () => { if (S.mode !== 'analysis') setWorkspaceMode('analysis'); });
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
  $('film-coverage-dismiss').addEventListener('click', () => toggleOverlay('film-coverage-dialog', false));
  $('film-coverage-review').addEventListener('click', reviewUnmatchedPlays);
  $('film-coverage-reanalyze').addEventListener('click', () => {
    toggleOverlay('film-coverage-dialog', false);
    analyze(true, { auto: true, films: S.coverageRetune });
  });
  $('btn-cancel').addEventListener('click', () => S.progressFile && window.api.cancelAnalysis(S.progressFile));
  $('btn-refresh').addEventListener('click', async () => { await loadSchedule(true); await loadGame(true); });
  $('btn-settings').addEventListener('click', () => { draft = null; toggleOverlay('settings', true); });
  $('btn-help').addEventListener('click', () => toggleOverlay('help'));
  $('btn-command').addEventListener('click', openCommandPalette);
  $('btn-library').addEventListener('click', openGameLibrary);
  $('library-analyze-new').addEventListener('click', analyzeNewLibraryFilms);
  $('library-close').addEventListener('click', () => toggleOverlay('game-library', false));
  $('library-games').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-library-game]');
    if (!button) return;
    const game = S.games.find(item => item.gameId === button.dataset.libraryGame);
    if (!game) return;
    S.sel = { season: game.season, team: S.sel.team, week: game.week, gameId: game.gameId };
    persistLastSelection();
    renderSelectors();
    toggleOverlay('game-library', false);
    await loadGame();
  });
  $('command-search').addEventListener('input', (event) => renderCommandResults(event.target.value));
  $('command-results').addEventListener('click', (event) => {
    const item = event.target.closest('[data-command-kind]');
    if (!item) return;
    if (item.dataset.commandKind === 'game') {
      const game = S.games.find(candidate => candidate.gameId === item.dataset.commandValue);
      if (!game) return;
      S.sel = { season: game.season, team: S.sel.team, week: game.week, gameId: game.gameId };
      persistLastSelection();
      renderSelectors();
      toggleOverlay('command-palette', false);
      loadGame();
    } else runCommand(item.dataset.commandValue);
  });
  $('settings-nav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-settings-target]');
    if (!button) return;
    const target = $(button.dataset.settingsTarget);
    const parentDetails = target.closest('details');
    if (parentDetails) parentDetails.open = true;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  $('first-run-dismiss').addEventListener('click', () => {
    try { localStorage.setItem('amp22.onboarding.dismissed', 'true'); }
    catch (error) { setStatus(`Welcome checklist preference could not be saved: ${error.message}`, true); }
    $('first-run').hidden = true;
  });
  $('first-run-skip').addEventListener('click', () => $('first-run-dismiss').click());
  $('play-bookmark').addEventListener('click', async () => {
    const play = S.plays[S.curPlay];
    if (play) await savePlayAnnotation(play.playId, { bookmarked: !playAnnotation(play).bookmarked });
  });
  $('play-note').addEventListener('click', () => {
    const annotation = playAnnotation();
    if (!annotation) return;
    $('play-note-text').value = annotation.note || '';
    $('play-note-tags').value = (annotation.tags || []).join(', ');
    $('play-note-dialog').hidden = false;
    $('play-note-text').focus();
  });
  $('play-note-cancel').addEventListener('click', () => { $('play-note-dialog').hidden = true; });
  $('play-note-save').addEventListener('click', async () => {
    const play = S.plays[S.curPlay];
    if (!play) return;
    $('play-note-save').disabled = true;
    try {
      const tags = [...new Set($('play-note-tags').value.split(',').map(tag => tag.trim()).filter(Boolean))].slice(0, 20);
      await savePlayAnnotation(play.playId, { note: $('play-note-text').value.trim(), tags });
      $('play-note-dialog').hidden = true;
    } catch (error) {
      $('play-note-status').textContent = `Note could not be saved: ${error.message}`;
    } finally { $('play-note-save').disabled = false; }
  });
  $('play-playlist').addEventListener('change', (event) => setPlayPlaylist(event.target.value).catch(error => setStatus(`Playlist could not be saved: ${error.message}`, true)));
  $('play-playlist-manage').addEventListener('click', async () => {
    const name = prompt('Name this playlist:');
    if (!name?.trim()) return;
    const normalized = name.trim().slice(0, 60);
    if ((S.gameData.playlists || []).some(list => list.name.toLowerCase() === normalized.toLowerCase())) {
      setStatus('A playlist with that name already exists.', true);
      return;
    }
    await saveGame({ playlists: [...(S.gameData.playlists || []), { name: normalized, playIds: [] }] });
    renderPlayActions();
    $('play-playlist').value = normalized;
    await setPlayPlaylist(normalized);
  });
  $('play-export-playlist').addEventListener('click', () => {
    const lists = S.gameData.playlists || [];
    const name = prompt(`Export which playlist?\n${lists.map(list => list.name).join('\n')}`);
    const list = lists.find(item => item.name === name);
    if (!list) return;
    S.selected = new Set(S.plays.flatMap((play, index) => list.playIds.includes(String(play.playId)) && S.mapping[index] != null ? [index] : []));
    S.multiSelect = true;
    updateSelection();
    if (!S.selected.size) setStatus('No plays in that playlist have linked film in this game.', false);
    else openShare();
  });
  $('play-list').addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    const currentItem = event.target.closest('li[data-i]');
    if (!currentItem && !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const currentIndex = currentItem ? Number(currentItem.dataset.i) : S.curPlay;
    const position = S.visible.indexOf(currentIndex);
    const nextPosition = event.key === 'Home' ? 0 : event.key === 'End' ? S.visible.length - 1 :
      event.key === 'ArrowDown' ? Math.min(S.visible.length - 1, position + 1) : Math.max(0, position - 1);
    const index = ['Enter', ' '].includes(event.key) ? currentIndex : S.visible[nextPosition];
    if (index == null || index < 0) return;
    event.preventDefault();
    selectPlay(index, { autoplay: false });
    $('play-list').querySelector(`li[data-i="${index}"]`)?.focus();
  });
  $('active-filter-chips').addEventListener('click', (event) => {
    const button = event.target.closest('[data-clear-filter]');
    if (button) clearOneFilter(button.dataset.clearFilter, button.dataset.filterValue);
  });
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
        packages: analysisLab?.getPackages(),
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
  $('film-folder-choose').addEventListener('click', async () => {
    const filmRoot = await window.api.chooseFolder();
    if (!filmRoot) return;
    try {
      applySettings(await window.api.saveSettings({ ...S.settings, filmRoot }));
      await loadGame();
    } catch (error) { setStatus(`Film folder could not be saved: ${error.message}`, true); }
  });
  $('film-folder-clear').addEventListener('click', async () => {
    try {
      applySettings(await window.api.saveSettings({ ...S.settings, filmRoot: '' }));
      S.suggestedFilms = [];
      renderSuggestedFilms();
    } catch (error) { setStatus(`Film folder could not be cleared: ${error.message}`, true); }
  });
  $('film-suggestions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-film-suggestion]');
    if (button) chooseSuggestedFilm(Number(button.dataset.filmSuggestion));
  });
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      document.body.classList.add('file-dragging');
    }
  });
  window.addEventListener('dragleave', (event) => {
    if (event.relatedTarget == null) document.body.classList.remove('file-dragging');
  });
  window.addEventListener('drop', async (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    document.body.classList.remove('file-dragging');
    if (isSplitFilm()) {
      setStatus('Switch to Single file mode before dropping a film file; split files are assigned by game unit.', true);
      return;
    }
    if (event.dataTransfer.files.length !== 1) {
      setStatus('Drop one video file at a time.', true);
      return;
    }
    const file = event.dataTransfer.files[0];
    let filePath;
    try { filePath = window.api.getPathForFile(file); }
    catch (error) {
      setStatus(`The dropped file path is unavailable: ${error.message}`, true);
      return;
    }
    if (!filePath || !/\.(mp4|m4v|mov|mkv)$/i.test(file.name)) {
      setStatus('Drop an MP4, M4V, MOV, or MKV film file.', true);
      return;
    }
    try {
      await saveGame({ filmPath: filePath });
      closeFilm();
      await openFilm(filePath);
      selectFirstLinked({ playId: lastPlayId() });
    } catch (error) { setStatus(`Dropped film could not be opened: ${error.message}`, true); }
  });
  $('share-angle').addEventListener('change', () => {
    const mode = $('share-angle').value;
    try { localStorage.setItem('amp22.export.angle', mode); }
    catch (error) { setStatus(`Export angle preference could not be saved: ${error.message}`, true); }
    if (mode.endsWith('-first')) $('highlight-angle').value = mode === 'endzone-first' ? 'endzone' : 'sideline';
    queueTrimPreview();
  });
  $('export-quick-mode').addEventListener('click', () => setExportMode('quick'));
  $('export-customize-mode').addEventListener('click', () => setExportMode('customize'));
  $('export-preset').addEventListener('change', (event) => {
    if (event.target.value === 'custom') {
      try { localStorage.removeItem('amp22.export.preset'); }
      catch (error) { setStatus(`Export preset could not be reset: ${error.message}`, true); }
      return;
    }
    applyExportPreset(event.target.value);
  });
  $('share-clean').addEventListener('change', () => {
    $('share-overlay-description').hidden = $('share-clean').checked;
    $('share-clean-description').hidden = !$('share-clean').checked;
    $('share-overlay-seconds').disabled = $('share-clean').checked;
    updatePositionControls();
    loadPositionHeadshots();
    updateExportOptions();
    highlightEditor?.refresh();
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
  $('highlight-canvas').addEventListener('pointerdown', startPositionDrag);
  $('highlight-canvas').addEventListener('pointermove', movePositionDrag);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    $('highlight-canvas').addEventListener(event, () => { positionDrag = null; });
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
  $('share-trim-current').addEventListener('click', () => {
    const clip = S.exportDraft?.clips[Number($('share-preview-play').value)];
    if (!clip || S.exporting) return;
    if (!highlightEditor.ready()) {
      $('share-preview-status').textContent = 'Wait for the selected video frame to finish loading before trimming here.';
      return;
    }
    const trim = clip.trim + highlightEditor.relativeTime();
    try {
      A22.clipExport.trimRange(clip, trim);
      $('share-trim').value = trim.toFixed(6);
      $('share-trim').dispatchEvent(new Event('input'));
    } catch (e) {
      $('share-preview-status').textContent = `Cannot trim here: ${e.message}`;
    }
  });
  $('share-overlay-seconds').addEventListener('input', () => {
    updateExportOptions();
    updatePositionControls();
    loadPositionHeadshots();
  });
  $('share-report-format').addEventListener('change', updateReportOptions);
  $('share-report-advanced').addEventListener('change', updateReportOptions);
  $('share-output').addEventListener('toggle', e => {
    if (!e.currentTarget.open) return;
    const tools = e.currentTarget.closest('.cutup-tools');
    const scroller = getComputedStyle(tools).overflowY === 'visible' ? tools.closest('.panel') : tools;
    scroller.scrollTop = scroller.scrollHeight;
  });
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
    notifyAnalysisSelection();
  });
  $('btn-multi-select').addEventListener('click', () => {
    if (S.mode === 'analysis') {
      S.multiSelect = !S.multiSelect;
      updateSelection();
      return;
    }
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

  window.api.onProgress((p) => {
    if (p.file !== S.progressFile) return;
    const phases = { probe: [0, 0.02], scan: [0.02, 0.8], classify: [0.8, 1], done: [1, 1] };
    const [a, b] = phases[p.phase] || [0, 1];
    const total = a + (b - a) * p.fraction;
    $('progress').querySelector('.fill').style.width = `${Math.round(total * 100)}%`;
    const role = isSplitFilm() ? Object.keys(S.splitFilms).find((key) => S.splitFilms[key].path === p.file) : null;
    $('progress').querySelector('.label').textContent = `${role ? `${role === 'special' ? 'Special teams' : role}: ` : ''}${p.message} ${Math.round(total * 100)}%`;
  });

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
      if (S.mode === 'analysis') S.multiSelect = true;
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
    notifyAnalysisSelection();
  });

  $('search').addEventListener('input', (e) => { S.filter.text = e.target.value; renderList(); });
  $('clear-filters').addEventListener('click', clearAllFilters);
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
  $('sel-result').addEventListener('change', (e) => { e.target.blur(); setResultFilter(e.target.value); });
  $('adv-result-filter').addEventListener('change', (e) => { e.target.blur(); setResultFilter(e.target.value); });
  $('filter-preset').addEventListener('change', (e) => chooseFilterPreset(e.target.value));
  $('filter-preset-save').addEventListener('click', () => saveFilterPreset());
  $('filter-preset-delete').addEventListener('click', () => saveFilterPreset(true));
  $('filter-preset-without-players').addEventListener('click', () => chooseFilterPreset(S.pendingPreset, true));
  $('filter-preset-cancel').addEventListener('click', () => {
    S.pendingPreset = null;
    $('filter-preset-team').hidden = true;
    renderPresetOptions();
  });
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
  $('set-cut-preset').addEventListener('change', () => {
    const preset = $('set-cut-preset').value;
    if (!['auto', 'custom'].includes(preset)) $('set-cut').value = preset;
    updateCutDetectionField();
  });
  $('set-cut').addEventListener('input', () => {
    if (!$('set-cut').hidden) $('set-cut-preset').value = 'custom';
  });
  $('set-report-preset').addEventListener('change', (event) => {
    const fields = REPORT_FIELD_PRESETS[event.target.value];
    if (!fields) return;
    const selected = new Set(fields);
    for (const field of REPORT.ADVANCED_FIELDS) $(`set-report-${field.key}`).checked = selected.has(field.key);
  });
  $('set-report-fields').addEventListener('change', () => { $('set-report-preset').value = 'custom'; });
  $('set-ui-theme').addEventListener('change', () => {
    const settings = { ...S.settings, uiTheme: $('set-ui-theme').value };
    applyComfortSettings(settings);
  });
  $('set-text-scale').addEventListener('change', () => {
    document.documentElement.style.setProperty('--ui-scale', $('set-text-scale').value);
  });
  $('set-sidebar-width').addEventListener('input', () => {
    setSidebarWidth(Number($('set-sidebar-width').value));
  });
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
      filterPresets: S.settings.filterPresets,
    })));
    capture = null;
    renderSettings();
  });
  $('set-cancel').addEventListener('click', () => {
    draft = null; capture = null; applyComfortSettings(S.settings); toggleOverlay('settings', false);
  });
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
    if ((prev.cutMode !== S.settings.cutMode || (S.settings.cutMode === 'manual' && prev.cutThreshold !== S.settings.cutThreshold))
      && S.film && confirm('Cut detection changed. Re-analyze this film now?')) analyze(true);
  });
}

let participationRevision = 0;
async function refreshParticipation(automatic = false) {
  if (!S.game) return;
  const gameId = S.game.gameId;
  const revision = ++participationRevision;
  const filmRevision = S.filmRevision;
  const before = JSON.stringify(S.plays.map((p) => [p.playId, p.participation, p.onField, p.charting, p.nflProCharting]));
  S.participationNotice = automatic ? 'Checking imports automatically…' : 'Checking imports…';
  renderParticipationStatus();
  try {
    const r = await window.api.getPlays({ season: S.game.season, gameId });
    if (revision !== participationRevision || S.game?.gameId !== gameId || filmRevision !== S.filmRevision) return;
    const current = S.plays[S.curPlay]?.playId;
    const selected = new Set([...S.selected].map((i) => S.plays[i]?.playId));
    S.plays = r.plays;
    const changed = before !== JSON.stringify(S.plays.map((p) => [p.playId, p.participation, p.onField, p.charting, p.nflProCharting]));
    S.participationWarning = r.warning || '';
    S.participationNotice = `${automatic && changed ? 'Updated automatically' : automatic ? 'Checked automatically' : 'Imports checked'} at ${new Date().toLocaleTimeString()}.`;
    S.curPlay = S.plays.findIndex((p) => p.playId === current);
    S.selected = new Set(S.plays.map((_p, i) => i).filter((i) => selected.has(S.plays[i].playId)));
    derivePlays();
    realign();
    renderAdvancedFilters();
    analysisLab?.invalidate();
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
  try {
    await setWorkspaceMode(localStorage.getItem('amp22.workspace') === 'analysis' ? 'analysis' : 'film', false);
  } catch (error) { setStatus(`Workspace preference could not be loaded: ${error.message}`, true); }
  const init = await window.api.init();
  $('app-version').textContent = `AMP22 ${init.version}`;
  $('share-reveal').textContent = init.platform === 'darwin' ? 'Show in Finder' : init.platform === 'win32' ? 'Show in File Explorer' : 'Show in folder';
  applySettings(init.settings);
  window.api.onParticipationChanged(() => refreshParticipation(true));
  checkUpdates(true);
  if (await loadSchedule(false)) {
    await loadGame(false);
    try {
      if (localStorage.getItem('amp22.onboarding.dismissed') !== 'true') {
        $('first-run').hidden = false;
        $('first-run-dismiss').focus();
      }
    } catch (error) { setStatus(`Welcome checklist preference could not be loaded: ${error.message}`, true); }
  }
})();
