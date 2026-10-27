/* global A22 */
'use strict';

const { ACTIONS, mergeSettings, comboFromEvent, keyLabel, buildKeymap, DEFAULT_SETTINGS } = A22.settings;
const P = A22.plays;
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
  gameData: {}, // persisted: filmPath, anchors {playId: pairKey|null}, offsets {pairKey: frames}
  plays: [], // normalized plays + derived fields
  mapping: [], // play index -> pair index | null
  film: null, // {path, url, info, analysis}
  fps: 59.94,
  pairs: [],
  curPlay: -1,
  curPair: -1,
  range: null, // {aStart, bStart, len}
  playing: false,
  speedIdx: 0,
  filter: { type: 'all', text: '', offense: '', qtr: '', result: '' },
  visible: [], // play indices in list order
  progressFile: null,
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
}
function pairKey(pair) {
  return pair.sideline.start.toFixed(2);
}
function pairIndexForKey(key) {
  const t = Number(key);
  let best = -1, bd = 0.5;
  S.pairs.forEach((p, i) => {
    const d = Math.abs(p.sideline.start - t);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
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
  pause();
  S.game = S.games.find((g) => g.gameId === gameId) || null;
  S.plays = [];
  S.mapping = [];
  S.curPlay = -1;
  S.selected.clear();
  S.selectionAnchor = -1;
  S.multiSelect = false;
  updateSelection();
  S.gameData = gameId ? await window.api.getGame(gameId) : {};
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
      if (S.sel.gameId !== gameId) return;
      S.plays = r.plays;
      setStatus(r.warning || '', !!r.warning);
    } catch (e) {
      setStatus(e.message, true);
    }
  }
  derivePlays();
  renderQuarters();

  let filmPath = S.gameData.filmPath;
  if (!filmPath && S.game) {
    const s = await window.api.suggestFilm({ week: S.game.week, opponent: opp, season: S.game.season, team: S.sel.team });
    if (s.auto) {
      filmPath = s.auto;
      await saveGame({ filmPath });
    }
  }
  if (filmPath) await openFilm(filmPath);
  else {
    closeFilm();
    showMessage(`Choose the A22 film for <b>${S.game ? esc(gameLabel(S.game, S.sel.team)) : 'this game'}</b> with <b>Choose film…</b><br><span class="muted">Tip: set a film folder in Settings ⚙ to find files automatically.</span>`);
  }
  realign();
  renderList();
  const first = S.visible.find((i) => S.mapping[i] != null);
  if (first != null) selectPlay(first, { autoplay: false });
  else renderInfo();
}

async function saveGame(patch) {
  if (!S.sel.gameId) return;
  S.gameData = await window.api.saveGame(S.sel.gameId, patch);
}

function derivePlays() {
  for (const p of S.plays) {
    p.cat = P.category(p);
    p.filmWeight = P.filmWeight(p);
    p.key = P.keyReasons(p, S.settings.keyPlays);
    p.neg = P.negativeReasons(p, S.settings.keyPlays);
    p.box = P.boxScore(p);
    p.searchText = `${p.desc} ${p.posteam} ${P.downDistance(p)} ${p.key.join(' ')} ${p.neg.join(' ')} ${p.cat}`.toLowerCase();
  }
}

function realign() {
  if (!S.pairs.length || !S.plays.length) {
    S.mapping = S.plays.map(() => null);
    return;
  }
  const anchors = new Map();
  const a = S.gameData.anchors || {};
  S.plays.forEach((p, i) => {
    if (!(String(p.playId) in a)) return;
    const v = a[p.playId];
    if (v === null) anchors.set(i, null);
    else {
      const k = pairIndexForKey(v);
      if (k >= 0) anchors.set(i, k);
    }
  });
  S.mapping = A22.align.alignPlays(S.plays, S.pairs.length, anchors);
}

/* ---------------- film ---------------- */

function closeFilm() {
  S.film = null;
  S.pairs = [];
  S.range = null;
  $('vidA').removeAttribute('src');
  $('vidB').removeAttribute('src');
  $('vidA').load();
  $('vidB').load();
  $('film-name').textContent = '';
  $('btn-analyze').hidden = true;
}

async function openFilm(file) {
  try {
    const f = await window.api.openFilm(file);
    S.film = f;
    S.fps = f.info.fps || 59.94;
    $('film-name').textContent = file.split(/[\\/]/).pop();
    $('film-name').title = file;
    const a = $('vidA'), b = $('vidB');
    if (a.src !== f.url) { a.src = f.url; b.src = f.url; }
    setAnalysis(f.analysis);
    if (!f.analysis) {
      $('btn-analyze').hidden = false;
      showMessage('This film has not been analyzed yet. Analysis finds each play\'s sideline and end zone clips (about 3–5 minutes per game, done once).');
      if (S.settings.autoAnalyze) analyze(false);
    }
  } catch (e) {
    closeFilm();
    showMessage(`Couldn't open film: ${esc(e.message)}`);
  }
}

function setAnalysis(analysis) {
  S.pairs = analysis ? analysis.pairs : [];
  $('videos').classList.toggle('single', !S.pairs.length);
  $('btn-analyze').hidden = !!analysis;
  if (analysis) showMessage('');
}

async function analyze(force) {
  if (!S.film) return;
  const file = S.film.path;
  S.progressFile = file;
  $('progress').hidden = false;
  $('btn-analyze').hidden = true;
  try {
    const a = await window.api.analyzeFilm(file, force);
    if (!S.film || S.film.path !== file) return;
    setAnalysis(a);
    realign();
    renderList();
    const first = S.visible.find((i) => S.mapping[i] != null);
    if (first != null) selectPlay(first, { autoplay: false });
    else if (S.pairs.length) loadPair(0, { autoplay: false });
    setStatus(`Found ${a.pairs.length} plays on film (${a.clips.length} clips)`);
  } catch (e) {
    if (S.film && S.film.path === file) {
      $('btn-analyze').hidden = false;
      setStatus(/Cancelled/.test(e.message) ? 'Analysis cancelled' : `Analysis failed: ${e.message}`, !/Cancelled/.test(e.message));
    }
  } finally {
    $('progress').hidden = true;
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

function passesFilter(p) {
  const f = S.filter;
  if (['run', 'pass', 'special'].includes(f.type) && p.cat !== f.type) return false;
  if (f.offense && p.posteam !== f.offense) return false;
  if (f.qtr && String(p.qtr) !== f.qtr) return false;
  if (f.result && RESULT_FILTERS[f.result] && !RESULT_FILTERS[f.result](p)) return false;
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

function renderList() {
  S.visible = [];
  const html = [];
  const anchors = S.gameData.anchors || {};
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
        `<span class="dd">${esc(P.downDistance(p))}</span><span class="team">${esc(p.yrdln)}</span>` +
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
}

function boxHtml(p) {
  const b = p.box;
  return `<div class="box"><span class="who">${esc(b.who)}</span>` +
    (b.yards ? `<span class="yds ${b.tone}">${esc(b.yards)}</span>` : '') +
    (b.result ? `<span class="res ${b.tone}">${esc(b.result)}</span>` : '') +
    (b.penalty ? `<span class="pen" title="${esc(b.penalty)}">PEN</span>` : '') + '</div>';
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
  } else {
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

const vidA = () => $('vidA');
const vidB = () => $('vidB');

function setVideoTime(v, t) {
  v._target = t;
  if (v.seeking) { v._pending = t; return; }
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
  return (S.gameData.offsets || {})[pairKey(pair)] || 0;
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
  S.curPair = pairIdx;
  S.range = computeRange(pairIdx);
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
  const pi = S.mapping[i];
  if (pi != null && S.pairs[pi]) {
    loadPair(pi, { autoplay });
  } else {
    pause();
    renderInfo();
    if (S.film && S.pairs.length) showMessage('No film linked to this play.<br><span class="muted">Browse clips with Shift+↑/↓ and press Shift+L to link one.</span>');
  }
}

/* ---------------- clip export ---------------- */

function updateSelection() {
  const multi = S.multiSelect || S.selected.size > 1;
  $('selection-count').textContent = `${S.selected.size} selected`;
  $('selection-count').hidden = !multi;
  $('btn-clear-selection').hidden = !multi;
  $('btn-clear-selection').disabled = !S.selected.size;
  $('btn-multi-select').setAttribute('aria-pressed', String(multi));
  $('btn-share').disabled = S.exporting || !S.selected.size || !S.film || !S.pairs.length;
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

function playCard(play, mode, matchup, headshot = null) {
  const { width, height } = A22.clipExport.dimensions(mode);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const both = mode === 'both';
  const color = { run: '#2ea043', pass: '#388bfd', special: '#a371f7' }[play.cat] || '#6e7681';
  const context = [P.clockLabel(play), P.downDistance(play), play.yrdln, play.posteam && `${play.posteam} ball`].filter(Boolean).join('  ·  ');
  const box = play.box;
  const summary = P.overlaySummary(play);
  const notes = [box.penalty, ...play.key, ...play.neg].filter(Boolean).join('  ·  ');
  ctx.textBaseline = 'top';
  if (!both) {
    const padding = 24;
    const photoSpace = headshot ? 148 : 0;
    const maxWidth = Math.floor(width * 0.72) - padding * 2 - photoSpace;
    const rows = [
      { text: context, font: '24px sans-serif', color: '#c9d1d9', height: 28 },
      { text: summary, font: 'bold 32px sans-serif', color: '#e6edf3', height: 38 },
      { text: notes, font: '22px sans-serif', color: '#f2cc60', height: 26 },
    ].filter((row) => row.text);
    const contentWidth = Math.ceil(Math.min(maxWidth, Math.max(0, ...rows.map((row) => {
      ctx.font = row.font;
      return ctx.measureText(row.text).width;
    }))));
    const cardWidth = contentWidth + padding * 2 + photoSpace;
    const contentHeight = Math.max(headshot ? 128 : 0, rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * 10);
    const cardHeight = padding * 2 + contentHeight;
    const left = 48;
    const top = height - 48 - cardHeight;
    ctx.fillStyle = 'rgba(13,17,23,0.88)';
    ctx.fillRect(left, top, cardWidth, cardHeight);
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
    return canvas.toDataURL('image/png');
  }
  const top = 1216;
  const left = 48;
  const available = width - left * 2;
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, top, width, height - top);
  ctx.fillStyle = color;
  ctx.fillRect(0, top, width, 8);
  ctx.fillStyle = '#8b949e';
  ctx.font = '28px sans-serif';
  drawWrapped(ctx, matchup, left, top + 32, available, 34, 1);
  ctx.fillStyle = '#e6edf3';
  ctx.font = '32px sans-serif';
  drawWrapped(ctx, context, left, top + 80, available, 40, 1);
  ctx.font = 'bold 42px sans-serif';
  const photoSpace = headshot ? 232 : 0;
  if (headshot) drawHeadshot(ctx, headshot, left, top + 130, 208);
  drawWrapped(ctx, summary, left + photoSpace, top + 138, available - photoSpace, 52, 2);
  ctx.font = '30px sans-serif';
  ctx.fillStyle = '#f2cc60';
  drawWrapped(ctx, notes, left + photoSpace, top + 252, available - photoSpace, 38, 2);
  ctx.fillStyle = '#c9d1d9';
  ctx.font = '32px sans-serif';
  drawWrapped(ctx, play.desc, left, top + 350, available, 42, 7);
  return canvas.toDataURL('image/png');
}

async function prepareHeadshots(clips) {
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
  const indices = A22.clipExport.selectedIndices(S.selected);
  $('share-summary').textContent = `${indices.length} play${indices.length === 1 ? '' : 's'} in game order, joined into one video.`;
  try {
    if (!S.film || !indices.length) throw new Error('Select at least one play with film.');
    const clips = indices.map((i) => {
      const pairIdx = S.mapping[i];
      if (pairIdx == null || !S.pairs[pairIdx]) throw new Error(`${P.clockLabel(S.plays[i])} has no linked film. Deselect it or link its film before exporting.`);
      return { ...A22.clipExport.clipRange(S.pairs[pairIdx], S.fps, offsetFrames(pairIdx)), play: S.plays[i] };
    });
    const matchup = S.game ? `${S.game.awayTeam} at ${S.game.homeTeam} · ${S.game.season} · Week ${S.game.week}` : 'A22 Film Tool';
    S.exportDraft = { file: S.film.path, clips, matchup };
  } catch (e) {
    $('share-status').textContent = e.message;
    $('share-status').classList.add('error');
  }
  $('share-export').disabled = !S.exportDraft;
  $('share-angle').focus();
}

async function exportSelection() {
  if (!S.exportDraft || S.exporting) return;
  S.exporting = true;
  S.exportCancelRequested = false;
  updateSelection();
  $('share-angle').disabled = true;
  $('share-clean').disabled = true;
  $('share-export').disabled = true;
  $('share-close').hidden = true;
  $('share-cancel').hidden = false;
  $('share-cancel').disabled = false;
  $('share-progress').hidden = false;
  $('share-progress').value = 0;
  $('share-status').classList.remove('error');
  $('share-status').textContent = 'Choose where to save the MP4…';
  $('share-reveal').hidden = true;
  try {
    const mode = $('share-angle').value;
    const clean = $('share-clean').checked;
    const { file, clips, matchup } = S.exportDraft;
    let images = new Map();
    let warnings = new Set();
    if (!clean) {
      $('share-status').textContent = 'Preparing player headshots…';
      ({ images, warnings } = await prepareHeadshots(clips));
    }
    if (S.exportCancelRequested) {
      $('share-status').textContent = 'Export cancelled.';
      return;
    }
    $('share-status').textContent = 'Choose where to save the MP4…';
    const result = await window.api.exportClips({
      file, mode, clean,
      suggestedName: A22.clipExport.exportFilename(clips.map((clip) => clip.play)),
      clips: clips.map(({ play, ...range }) => clean ? range : { ...range, card: playCard(play, mode, matchup, images.get(P.primaryPlayer(play)?.id)) }),
    });
    $('share-status').textContent = result.cancelled ? 'Export cancelled.' : `Saved to ${result.path}`;
    if (!result.cancelled) {
      $('share-progress').value = 1;
      $('share-reveal').hidden = false;
      if (warnings.size) $('share-status').textContent += ` · Headshot notices: ${[...warnings].join('; ')}`;
    }
  } catch (e) {
    $('share-status').textContent = S.exportCancelRequested ? 'Export cancelled.' : `Export failed: ${e.message}`;
    $('share-status').classList.toggle('error', !S.exportCancelRequested);
  } finally {
    S.exporting = false;
    $('share-angle').disabled = false;
    $('share-clean').disabled = false;
    $('share-export').disabled = false;
    $('share-close').hidden = false;
    $('share-cancel').hidden = true;
    updateSelection();
  }
}

function play() {
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
  requestAnimationFrame(tick);
}

function pause() {
  const a = vidA(), b = vidB();
  S.playing = false;
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
  requestAnimationFrame(tick);
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
  if (S.plays.length && S.pairs.length || S.plays.length && !S.film) {
    let pos = S.visible.indexOf(S.curPlay);
    if (pos < 0) {
      // Current play filtered out: find nearest visible in direction.
      pos = dir > 0 ? S.visible.findIndex((i) => i > S.curPlay) - 1 : S.visible.findIndex((i) => i >= S.curPlay);
      if (pos < -1) pos = dir > 0 ? -1 : S.visible.length;
      if (dir < 0 && pos < 0) pos = S.visible.length;
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
  const n = S.curPair + dir;
  if (n < 0 || n >= S.pairs.length) return false;
  loadPair(n, { autoplay: autoplay || S.playing });
  return true;
}

/* ---------------- corrections ---------------- */

async function setAnchor(play, value) {
  const anchors = Object.assign({}, S.gameData.anchors || {});
  if (value === undefined) delete anchors[play.playId];
  else anchors[play.playId] = value;
  await saveGame({ anchors });
  realign();
  renderList();
  renderInfo();
}

async function nudge(delta) {
  if (S.curPair < 0) return;
  const key = pairKey(S.pairs[S.curPair]);
  const offsets = Object.assign({}, S.gameData.offsets || {});
  const v = delta === 0 ? 0 : (offsets[key] || 0) + delta;
  if (v) offsets[key] = v;
  else delete offsets[key];
  await saveGame({ offsets });
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
  fillSelect($('set-team'), Object.keys(A22.teams.TEAMS).filter((t) => !['OAK', 'SD', 'STL'].includes(t)).sort().map((t) => ({ value: t, label: `${t} – ${A22.teams.teamName(t)}` })), draft.defaultTeam);
  $('set-root').value = draft.filmRoot || '';
  $('set-auto').checked = draft.autoAnalyze;
  $('set-skipnofilm').checked = draft.skipNoFilm;
  $('set-cut').value = draft.cutThreshold;
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
  d.filmRoot = $('set-root').value;
  d.autoAnalyze = $('set-auto').checked;
  d.skipNoFilm = $('set-skipnofilm').checked;
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

window.addEventListener('keydown', (e) => {
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
}, true);

/* ---------------- wiring ---------------- */

function wire() {
  $('sel-season').addEventListener('change', () => onSelectorChange('season'));
  $('sel-team').addEventListener('change', () => onSelectorChange('team'));
  $('sel-week').addEventListener('change', () => onSelectorChange('week'));

  $('btn-film').addEventListener('click', async () => {
    const f = await window.api.chooseFilm({ defaultPath: S.gameData.filmPath });
    if (!f) return;
    await saveGame({ filmPath: f });
    await openFilm(f);
    realign();
    renderList();
    const first = S.visible.find((i) => S.mapping[i] != null);
    if (first != null) selectPlay(first, { autoplay: false });
  });
  $('btn-analyze').addEventListener('click', () => analyze(false));
  $('btn-cancel').addEventListener('click', () => S.progressFile && window.api.cancelAnalysis(S.progressFile));
  $('btn-refresh').addEventListener('click', async () => { await loadSchedule(true); await loadGame(true); });
  $('btn-settings').addEventListener('click', () => { draft = null; toggleOverlay('settings', true); });
  $('btn-help').addEventListener('click', () => toggleOverlay('help'));
  $('btn-share').addEventListener('click', openShare);
  $('share-clean').addEventListener('change', () => {
    $('share-overlay-description').hidden = $('share-clean').checked;
    $('share-clean-description').hidden = !$('share-clean').checked;
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
    await saveGame({ anchors: {}, offsets: {} });
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
    $('progress').querySelector('.label').textContent = `${p.message} ${Math.round(total * 100)}%`;
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

  const scrub = $('scrub');
  scrub.addEventListener('input', () => {
    S.scrubbing = true;
    if (S.playing) pause();
    const len = S.range ? S.range.len : vidA().duration || 0;
    seekRel((Number(scrub.value) / 1000) * len);
  });
  scrub.addEventListener('change', () => { S.scrubbing = false; scrub.blur(); });

  for (const v of [vidA(), vidB()]) v.addEventListener('seeked', onSeeked);
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
  vidA().addEventListener('loadedmetadata', () => { if (!S.range) updateTimeUI(0); });
  vidA().addEventListener('error', () => {
    if (vidA().src) showMessage('This video could not be played. A22 film should be H.264 MP4.');
  });

  // Settings panel
  $('set-root-btn').addEventListener('click', async () => {
    const f = await window.api.chooseFolder();
    if (f) $('set-root').value = f;
  });
  $('set-root-clear').addEventListener('click', () => { $('set-root').value = ''; });
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
    draft = JSON.parse(JSON.stringify(Object.assign({}, DEFAULT_SETTINGS, { filmRoot: $('set-root').value })));
    capture = null;
    renderSettings();
  });
  $('set-cancel').addEventListener('click', () => { draft = null; capture = null; toggleOverlay('settings', false); });
  $('set-save').addEventListener('click', async () => {
    const prev = S.settings;
    const next = readSettingsForm();
    applySettings(await window.api.saveSettings(next));
    draft = null;
    capture = null;
    toggleOverlay('settings', false);
    if (prev.filmRoot !== S.settings.filmRoot && S.game && !S.gameData.filmPath) loadGame();
    if (prev.cutThreshold !== S.settings.cutThreshold && S.film && confirm('Cut sensitivity changed. Re-analyze this film now?')) analyze(true);
  });
}

/* ---------------- boot ---------------- */

(async function boot() {
  wire();
  const init = await window.api.init();
  $('share-reveal').textContent = init.platform === 'darwin' ? 'Show in Finder' : init.platform === 'win32' ? 'Show in File Explorer' : 'Show in folder';
  applySettings(init.settings);
  if (await loadSchedule(false)) await loadGame(false);
})();
