/* global A22 */
'use strict';

window.createAnalysisLab = function ({ getContext, preparePlays, matchesFilter, filterDescription, onCohortChange, onSelectionChange, openPlay }) {
  const A = A22.analysis;
  const root = document.getElementById('analysis-lab');
  const $ = (id) => document.getElementById(`lab-${id}`);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cache = new Map();
  let packages = A.DEFAULT_PACKAGES.map((r) => ({ name: r.name, counts: { ...r.counts } }));
  let result = null;
  let report = null;
  let evidence = [];
  let evidenceId = null;
  let revision = 0;
  let contextKey = '';
  let selectionContextKey = '';
  let loaded = [];
  let warnings = [];
  let loading = false;
  let ready = false;
  let storageWarning = '';
  const selected = new Set();
  let selectionPlays = [];
  let selectionAnchor = null;
  let selectionLimit = 200;
  const playKey = A.playKey;
  try {
    const saved = localStorage.getItem('amp22.analysis.packages');
    if (saved) packages = A.validatePackages(JSON.parse(saved));
  } catch (error) {
    storageWarning = `Saved packages could not be loaded: ${error.message}. Defaults are in use.`;
  }

  root.innerHTML = `
    <div class="lab-heading"><div><p class="lab-eyebrow">AMP22 / RESEARCH WORKSPACE</p>
      <h1>Analysis Lab</h1><p class="muted">Find the pattern. Inspect the plays. Build the argument. No film required.</p></div></div>
    <div class="lab-controls">
      <label>Scope<select id="lab-scope"><option value="game">Selected game</option><option value="range">Team week range</option></select></label>
      <label id="lab-from-label" hidden>From week<input id="lab-from" type="number" min="1" max="22" value="1"></label>
      <label id="lab-to-label" hidden>Through week<input id="lab-to" type="number" min="1" max="22" value="22"></label>
      <label>Group by<select id="lab-group">${Object.entries(A.GROUPS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label>Split by<select id="lab-split">${Object.entries(A.SPLITS).map(([v, l]) => `<option value="${v}"${v === 'type' ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <button id="lab-reload">Reload data</button>
    </div>
    <div class="lab-controls lab-selection-controls">
      <label>Analyze<select id="lab-selection-mode">
        <option value="all">All filtered plays</option>
        <option value="include">Only selected plays</option>
        <option value="exclude">Exclude selected plays</option>
      </select></label>
      <span id="lab-selection-count" class="muted small"></span>
      <button id="lab-clear-selection" disabled>Clear play selection</button>
    </div>
    <details id="lab-play-selection" class="lab-methods">
      <summary>Select plays for analysis</summary>
      <p>Use checkboxes or Shift-click to select a range, here or in the sidebar. Selections use game and play IDs, across the full analysis scope. Sidebar filters still apply. Excluded plays stay in this picker so you can restore them.</p>
      <div class="lab-controls">
        <label>Show<select id="lab-selection-show"><option value="filtered">Filtered plays</option><option value="selected">Selected plays (including hidden by filters)</option></select></label>
        <button id="lab-select-filtered">Select all filtered plays</button>
      </div>
      <p id="lab-selection-note" class="muted small"></p>
      <ol id="lab-selection-plays"></ol>
      <button id="lab-selection-more" hidden>Show more plays</button>
    </details>
    <p id="lab-scope-note" class="muted small"></p>
    <p id="lab-status" role="status" aria-live="polite"></p>
    <div id="lab-content" hidden>
      <div id="lab-summary" class="lab-summary"></div>
      <details class="lab-methods"><summary>Definitions, data coverage &amp; package rules</summary>
        <p>${A.EXCLUSIONS}</p><p>${A.DEFINITIONS}</p>
        <p>All sidebar filters and the Analyze play-selection mode also apply to this cohort, across every game in a range. Only selected plays intersects selections with those filters; Exclude selected plays removes them. An empty selection produces no snaps in Only selected plays, and excludes nothing in Exclude selected plays. Run/pass splits use official play type: sacks are passes and scrambles are runs. Usage is share of the entire filtered cohort, not within a split. Unknown data stays visible; missing values are never zero.</p>
        <p>Packages marked * are estimates from listed positions, not charted alignment. Generic LB/DB positions are not guessed as ILB/CB/S. Complete, uniquely identified eleven-player defenses are required for composition rules. Otherwise the supplied broad package is retained, or Unknown. A player's presence does not establish coverage responsibility or causal impact.</p>
        <p>Jumbo* identifies a complete eleven-player defense with at least four listed DL (DE/DT/NT), at least two OLB, and no more than four DBs. It is a heavy-front composition estimate, not confirmed goal-line alignment. Custom exact-composition rules take precedence.</p>
        <p>32 dime* identifies three listed DL/OLB combined, two explicit ILB (including MLB), and six DBs. Two inside linebackers distinguish it from standard and rush dime; generic LB positions do not establish that role. This also requires a complete, uniquely identified eleven-player defense for on-field estimates.</p>
        <p>Jumbo nickel* identifies three DL, one OLB, two explicit ILB (including MLB), and five DBs: a nickel composition with one OLB replaced by a DL. Both standard (three CB/two S) and big (two CB/three S) DB combinations qualify. Generic LB positions are not guessed as inside or outside linebackers; exact custom rules take precedence.</p>
        <p id="lab-coverage"></p>
        <div id="lab-packages"></div>
        <form id="lab-package-form" class="lab-package-form">
          <label>Package name<input id="lab-package-name" maxlength="60" required placeholder="My package"></label>
          ${A.POSITIONS.map((p) => `<label>${p}<input id="lab-count-${p}" type="number" min="0" max="11" step="1" value="0" required></label>`).join('')}
          <button type="submit">Add package</button>
        </form>
        <p class="muted small">Counts must total 11. DL includes DE/DT/NT; ILB includes MLB; S includes FS/SS. LB and DB remain generic. Definitions are saved locally and do not change Film Room filters.</p>
        <button id="lab-package-reset">Restore default package rules</button>
        <p id="lab-package-status" role="status"></p>
      </details>
      <div class="lab-chart-toolbar">
        <label>Graphic<select id="lab-chart"><option value="bars">Efficiency bars</option><option value="heatmap">Matchup heatmap</option><option value="halves">Half comparison</option></select></label>
        <label>Metric<select id="lab-metric">${Object.entries(A.METRICS).map(([v, m]) => `<option value="${v}">${m.label}</option>`).join('')}</select></label>
        <span class="spacer"></span><button id="lab-svg">Save SVG</button><button id="lab-png">Save PNG</button><button id="lab-csv">Summary CSV</button>
      </div>
      <p class="muted small">Click a bar, heatmap cell or table row to inspect contributing plays. Comparisons are descriptive, not causal.</p>
      <div id="lab-chart-preview"></div>
      <p id="lab-chart-note" class="muted small"></p>
      <div class="lab-table-wrap"><table class="lab-table"><thead><tr>
        <th>Group / split</th><th>Snaps</th><th>Usage</th><th id="lab-yards-heading">Yards allowed</th><th>YPP</th><th>Off. EPA/play</th><th>Off. success</th><th>Explosives</th><th>3rd/4th conv.</th>
      </tr></thead><tbody id="lab-rows"></tbody></table></div>
      <section id="lab-evidence" hidden aria-labelledby="lab-evidence-title">
        <div class="row"><h2 id="lab-evidence-title">Play evidence</h2><span class="spacer"></span><button id="lab-evidence-csv">Export these plays</button><button id="lab-evidence-close">Close</button></div>
        <p id="lab-evidence-label" class="muted"></p><ol id="lab-evidence-plays"></ol>
      </section>
    </div>`;

  function renderPackages() {
    $('packages').innerHTML = packages.map((r, i) => `<div class="lab-package"><span><strong>${esc(r.name)}</strong>:
      ${Object.entries(r.counts).filter(([, n]) => n).map(([p, n]) => `${n} ${p}`).join(', ')}</span>
      <button type="button" data-remove="${i}" aria-label="Remove ${esc(r.name)}">Remove</button></div>`).join('') || '<p>No custom composition rules. Supplied broad packages only.</p>';
  }

  function savePackages(next) {
    try {
      A.validatePackages(next);
      localStorage.setItem('amp22.analysis.packages', JSON.stringify(next));
      packages = next;
      $('package-status').textContent = 'Package rules saved.';
      renderPackages();
      render();
    } catch (error) { $('package-status').textContent = `Package rules not saved: ${error.message}`; }
  }

  function scopeGames(ctx) {
    if ($('scope').value === 'game') return ctx.game ? [ctx.game] : [];
    const from = $('from').valueAsNumber, to = $('to').valueAsNumber;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 22 || from > to) {
      throw new Error('Choose a valid inclusive week range from 1 through 22.');
    }
    return ctx.games.filter((g) => g.season === ctx.sel.season && (g.homeTeam === ctx.sel.team || g.awayTeam === ctx.sel.team) &&
      g.week >= from && g.week <= to && g.homeScore != null && g.awayScore != null)
      .sort((a, b) => a.week - b.week || a.gameId.localeCompare(b.gameId));
  }

  function scopeLabel(ctx, games) {
    return $('scope').value === 'game' && ctx.game
      ? `${ctx.game.season} Week ${ctx.game.week}: ${ctx.game.awayTeam} at ${ctx.game.homeTeam}`
      : `${ctx.sel.season} ${ctx.sel.team}, weeks ${$('from').value}-${$('to').value}, ${games.length} completed games (REG/postseason as scheduled)`;
  }

  function selectionMatches(play) {
    const mode = $('selection-mode').value;
    return mode === 'all' || selected.has(playKey(play)) === (mode === 'include');
  }

  function syncSelection() {
    onSelectionChange([...selected]);
  }

  function resetSelection() {
    selected.clear();
    selectionAnchor = null;
    selectionLimit = 200;
    $('selection-mode').value = 'all';
    $('selection-show').value = 'filtered';
    syncSelection();
  }

  async function load(force = false) {
    const token = ++revision;
    const ctx = getContext();
    loading = true;
    ready = false;
    result = null;
    report = null;
    $('content').hidden = true;
    $('selection-plays').innerHTML = '';
    $('selection-note').textContent = 'Loading play selection...';
    $('selection-more').hidden = true;
    $('select-filtered').disabled = true;
    $('status').classList.remove('error');
    try {
      const games = scopeGames(ctx);
      if (!games.length) throw new Error('No completed games in this scope.');
      const next = [];
      const notes = [];
      for (let i = 0; i < games.length; i++) {
        const game = games[i];
        $('status').textContent = `Loading play data ${i + 1} of ${games.length} (no film)...`;
        let entry;
        if (game.gameId === ctx.sel.gameId && !force && !cache.has(game.gameId)) {
          if (!ctx.plays.length) throw new Error(`No play-by-play loaded for ${game.gameId}. Use Reload data to retry.`);
          entry = { plays: ctx.plays, warning: ctx.warning };
        } else {
          entry = !force && cache.get(game.gameId);
          if (!entry) {
            // All games share season-level sources; force their download only once.
            entry = await window.api.getPlays({ season: game.season, gameId: game.gameId, force: force && i === 0 });
            if (token !== revision) return;
            if (!entry.plays.length) throw new Error(`No play-by-play available for ${game.gameId}. No partial aggregate is shown.`);
            cache.set(game.gameId, entry);
          }
        }
        if (entry.warning) notes.push(`${game.gameId}: ${entry.warning}`);
        preparePlays(entry.plays);
        next.push(...entry.plays);
      }
      if (token !== revision) return;
      loaded = next;
      const available = new Set(loaded.map(playKey));
      for (const key of selected) if (!available.has(key)) selected.delete(key);
      syncSelection();
      warnings = notes;
      $('scope-note').textContent = scopeLabel(ctx, games);
      loading = false;
      ready = true;
      render();
    } catch (error) {
      if (token !== revision) return;
      loading = false;
      ready = false;
      loaded = [];
      $('selection-note').textContent = 'Play selection unavailable until the scope loads successfully.';
      $('status').textContent = `Analysis unavailable: ${error.message}`;
      $('status').classList.add('error');
    }
  }

  function renderEvidence() {
    const row = result?.rows.find((r) => r.id === evidenceId);
    $('evidence').hidden = !row;
    evidence = row?.plays || [];
    if (!row) return;
    $('evidence-label').textContent = `${row.label} / ${row.series}: ${evidence.length} plays. Showing first ${Math.min(200, evidence.length)}; CSV includes all.`;
    $('evidence-plays').innerHTML = evidence.slice(0, 200).map((p, i) => `<li>
      <button data-play="${i}" title="Locate this play in the selected-game sidebar without loading film">${esc(p.gameId)} / ${esc(A22.plays.clockLabel(p))} / ${esc(A22.plays.downDistance(p))}</button>
      <span>${esc(p.yards == null ? 'Yards N/A' : `${p.yards} yards`)} / EPA ${esc(A.format(p.epa, 'epa'))}</span>
      <p>${esc(p.desc)}</p></li>`).join('');
  }

  function renderSelection(scope) {
    const filtered = scope.filter(matchesFilter);
    selectionPlays = $('selection-show').value === 'selected'
      ? loaded.filter(play => selected.has(playKey(play))) : filtered;
    const matching = filtered.filter(play => selected.has(playKey(play))).length;
    $('selection-count').textContent = `${selected.size} selected / ${matching} match current perspective and filters`;
    $('clear-selection').disabled = !selected.size;
    $('select-filtered').disabled = !filtered.length;
    const shown = selectionPlays.slice(0, selectionLimit);
    $('selection-note').textContent = `${selectionPlays.length} plays in this list; showing ${shown.length}. Selection applies to analysis, not film links.`;
    $('selection-plays').innerHTML = shown.map((play, index) => `<li>
      <label><input type="checkbox" data-selection="${index}"${selected.has(playKey(play)) ? ' checked' : ''}>
        <span>${esc(play.gameId)} / ${esc(A22.plays.clockLabel(play))} / ${esc(A22.plays.downDistance(play))}<br>
        ${esc(play.desc)}<small>${esc(play.yards == null ? 'Yards N/A' : `${play.yards} yards`)} / EPA ${esc(A.format(play.epa, 'epa'))}</small></span>
      </label></li>`).join('') || '<li class="muted">No plays in this list. Check filters, perspective, or selection.</li>';
    $('selection-more').hidden = selectionPlays.length <= selectionLimit;
    return filtered;
  }

  function render() {
    if (loading || !ready || !loaded.length) return;
    const ctx = getContext();
    preparePlays(loaded);
    const chart = $('chart').value;
    const group = chart === 'heatmap' ? 'defense' : $('group').value;
    const split = chart === 'heatmap' ? 'offense' : chart === 'halves' ? 'half' : $('split').value;
    const side = $('side').value;
    for (const option of $('side').options) {
      option.textContent = `${A22.teams.teamName(ctx.sel.team)} ${option.value}`;
    }
    const scope = loaded.filter((p) => A.scoredSnap(p) && (side === 'defense' ? p.defteam : p.posteam) === ctx.sel.team);
    onCohortChange(scope, selectionMatches);
    const filtered = renderSelection(scope);
    result = A.summarize(filtered.filter(selectionMatches), { team: ctx.sel.team, side, group, split, packages });
    const mode = $('selection-mode');
    const selectionNote = mode.value === 'all' ? 'All filtered plays' :
      `${mode.selectedOptions[0].textContent}; ${selected.size} selected`;
    const shared = `${filterDescription()}. Play selection: ${selectionNote}`;
    $('status').textContent = [storageWarning, ...warnings].filter(Boolean).join(' | ') || 'Play data ready. No film loaded by Analysis Lab.';
    $('status').classList.toggle('error', !!(storageWarning || warnings.length));
    $('content').hidden = false;
    $('summary').innerHTML = [
      [result.n, `${ctx.sel.team} ${side} scored snaps`],
      [`${result.knownDefense}/${result.n}`, 'known defensive package'],
      [`${result.knownOffense}/${result.n}`, 'known offensive personnel'],
      [`${result.knownEpa}/${result.n}`, 'known EPA'],
    ].map(([n, l]) => `<div><strong>${esc(n)}</strong><span>${esc(l)}</span></div>`).join('');
    const sourceText = Object.entries(result.sources).map(([s, n]) => `${s}: ${n} snaps`).join('; ') || 'No eligible snaps';
    const chartingSources = new Map();
    for (const play of result.plays) {
      for (const source of new Set(Object.values(play.chartingSources || {}))) {
        chartingSources.set(source, (chartingSources.get(source) || 0) + 1);
      }
    }
    const chartingText = [...chartingSources].map(([source, n]) => `${source}: ${n} snaps`).join('; ') || 'No source-labelled charting';
    const disagreements = result.plays.filter((play) => Object.keys(play.chartingConflicts || {}).length).length;
    const coverage = `${sourceText}. Known yards: ${result.knownYards}/${result.n}; complete defensive position lists: ${result.completeDefense}/${result.n}. PBP/EPA: nflverse/nflfastR. Charting sources (may overlap): ${chartingText}. Source disagreements: ${disagreements} snaps; retained source values are used.`;
    $('coverage').textContent = `${coverage} Shared filters: ${shared}.`;
    $('yards-heading').textContent = side === 'defense' ? 'Yards allowed' : 'Yards gained';
    $('group').disabled = chart === 'heatmap';
    $('split').disabled = chart !== 'bars';
    $('rows').innerHTML = result.rows.map((r, i) => {
      const type = split === 'type' ? r.plays[0].playType : '';
      const classes = [type ? `lab-row-${type}` : '', r.id === evidenceId ? 'selected' : ''].filter(Boolean).join(' ');
      const series = type ? esc(r.series).replace(/^(Run|Pass)/, '<span class="lab-split-badge">$1</span>') : esc(r.series);
      return `<tr class="${classes}">
      <td><button data-row="${i}" title="${esc(r.label)}">${esc(r.label)}</button><small${type ? ' class="lab-split"' : ''}>${series}</small></td>
      <td>${r.n}</td>
      <td>${(r.share * 100).toFixed(1)}%</td><td>${r.yardsN ? r.totalYards : 'N/A'}<small>n=${r.yardsN}</small></td>
      ${Object.keys(A.METRICS).map((m) => `<td>${A.format(r[m], m)}<small>n=${m === 'epa' || m === 'success' ? r.epaN : m === 'conversion' ? r.conversionN : r.yardsN}</small></td>`).join('')}</tr>`;
    }).join('') ||
      '<tr><td colspan="9">No scored snaps match. Check perspective, shared sidebar filters, and play selection.</td></tr>';
    let chartRows = result.rows.slice(0, 30);
    if (chart === 'heatmap') {
      const labels = [...new Set(result.rows.map((r) => r.label))].slice(0, 12);
      const series = [...new Set(result.rows.map((r) => r.series))].slice(0, 8);
      chartRows = result.rows.filter((r) => labels.includes(r.label) && series.includes(r.series));
    }
    const limit = chartRows.length !== result.rows.length ? `Graphic shows ${chartRows.length} of ${result.rows.length} groups, ordered by combined group snaps with splits together. Table and Summary CSV include all groups.` : 'Graphic includes all groups.';
    report = {
      title: `${ctx.sel.team} ${side === 'defense' ? 'defense: efficiency allowed' : 'offense: efficiency gained'}`,
      subtitle: `${$('scope-note').textContent} / ${A.GROUPS[group]} by ${A.SPLITS[split]}`,
      notes: `${coverage} Shared filters: ${shared}. Cohort: ${result.n} scored snaps. ${limit}${warnings.length ? ' DATA WARNINGS: ' + warnings.join(' | ') : ''}`,
      rows: chartRows.map(({ plays, ...r }) => r), metric: $('metric').value, chart,
      ...(mode.value === 'all' ? {} : {
        selection: { mode: mode.value, playIds: loaded.filter(play => selected.has(playKey(play))).map(play => `${play.gameId}/${play.playId}`) },
      }),
    };
    $('chart-preview').innerHTML = result.n ? A.svg(report) : '';
    $('chart-note').textContent = `${limit} ${chart !== 'bars' ? `This graphic uses ${A.GROUPS[group]} by ${A.SPLITS[split]}.` : ''}`;
    for (const id of ['svg', 'png', 'csv']) $(id).disabled = !result.n;
    renderEvidence();
  }

  async function exportReport(format) {
    if (!report || !result?.n || loading) return;
    const snapshot = { ...report, rows: format === 'csv' ? result.rows.map(({ plays, ...r }) => r) : report.rows };
    for (const id of ['svg', 'png', 'csv']) $(id).disabled = true;
    try {
      let dataUrl;
      if (format === 'png') {
        const svg = A.svg(snapshot);
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error('Could not render the chart image.'));
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        });
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image export is not supported on this device.');
        context.drawImage(image, 0, 0);
        dataUrl = canvas.toDataURL('image/png');
      }
      const saved = await window.api.exportAnalysis({ format, report: snapshot, dataUrl });
      $('status').textContent = saved.cancelled ? 'Export cancelled.' : `Saved ${format.toUpperCase()} to ${saved.path}`;
    } catch (error) {
      $('status').textContent = `Export failed: ${error.message}`;
      $('status').classList.add('error');
    } finally {
      for (const id of ['svg', 'png', 'csv']) $(id).disabled = loading || !result?.n;
    }
  }

  $('scope').addEventListener('change', () => {
    $('from-label').hidden = $('to-label').hidden = $('scope').value !== 'range';
    resetSelection();
    load();
  });
  for (const id of ['from', 'to']) $(id).addEventListener('change', () => { resetSelection(); load(); });
  for (const id of ['side', 'group', 'split', 'chart', 'metric']) $(id).addEventListener('change', render);
  $('reload').addEventListener('click', () => { cache.clear(); load(true); });
  $('selection-mode').addEventListener('change', render);
  $('selection-show').addEventListener('change', () => { selectionLimit = 200; render(); });
  $('clear-selection').addEventListener('click', () => {
    selected.clear();
    selectionAnchor = null;
    syncSelection();
    render();
  });
  $('select-filtered').addEventListener('click', () => {
    const ctx = getContext();
    for (const play of loaded) {
      if (A.scoredSnap(play) && ($('side').value === 'defense' ? play.defteam : play.posteam) === ctx.sel.team && matchesFilter(play)) {
        selected.add(playKey(play));
      }
    }
    syncSelection();
    render();
  });
  $('selection-more').addEventListener('click', () => { selectionLimit += 200; render(); });
  $('selection-plays').addEventListener('click', (event) => {
    const input = event.target.closest('[data-selection]');
    if (!input) return;
    const index = Number(input.dataset.selection);
    const play = selectionPlays[index];
    const anchorIndex = selectionPlays.findIndex(play => playKey(play) === selectionAnchor);
    const targets = event.shiftKey && anchorIndex >= 0
      ? selectionPlays.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1) : [play];
    for (const target of targets) {
      if (input.checked) selected.add(playKey(target));
      else selected.delete(playKey(target));
    }
    selectionAnchor = playKey(play);
    syncSelection();
    render();
    const nextIndex = selectionPlays.findIndex(candidate => playKey(candidate) === selectionAnchor);
    $('selection-plays').querySelector(`[data-selection="${nextIndex}"]`)?.focus();
  });
  for (const format of ['svg', 'png', 'csv']) $(format).addEventListener('click', () => exportReport(format));
  function showEvidence(id) {
    if (!result?.rows.some((r) => r.id === id)) return;
    evidenceId = id;
    render();
    $('evidence').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('chart-preview').addEventListener('click', (event) => {
    const bucket = event.target.closest('[data-bucket]');
    if (bucket) showEvidence(bucket.dataset.bucket);
  });
  $('chart-preview').addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const bucket = event.target.closest('[data-bucket]');
    if (bucket) { event.preventDefault(); showEvidence(bucket.dataset.bucket); }
  });
  $('rows').addEventListener('click', (event) => {
    const button = event.target.closest('[data-row]');
    if (!button) return;
    showEvidence(result.rows[Number(button.dataset.row)].id);
  });
  $('evidence-close').addEventListener('click', () => { evidenceId = null; renderEvidence(); });
  $('evidence-plays').addEventListener('click', (event) => {
    const button = event.target.closest('[data-play]');
    if (button) openPlay(evidence[Number(button.dataset.play)]);
  });
  $('evidence-csv').addEventListener('click', async () => {
    if (!evidence.length) return;
    $('evidence-csv').disabled = true;
    try {
      const saved = await window.api.exportData({
        ...A22.reports.mergeOptions(), format: 'csv', layout: 'plays', plays: evidence, packages,
        team: getContext().sel.team, matchup: $('scope-note').textContent,
      });
      $('status').textContent = saved.cancelled ? 'Export cancelled.' : `Saved ${evidence.length} evidence plays to ${saved.path}`;
    } catch (error) { $('status').textContent = `Evidence export failed: ${error.message}`; $('status').classList.add('error'); }
    finally { $('evidence-csv').disabled = false; }
  });
  $('packages').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove]');
    if (button) savePackages(packages.filter((_r, i) => i !== Number(button.dataset.remove)));
  });
  $('package-reset').addEventListener('click', () => savePackages(A.DEFAULT_PACKAGES.map((r) => ({ name: r.name, counts: { ...r.counts } }))));
  $('package-form').addEventListener('submit', (event) => {
    event.preventDefault();
    savePackages([...packages, { name: $('package-name').value.trim(), counts: Object.fromEntries(A.POSITIONS.map((p) => [p, $(`count-${p}`).valueAsNumber])) }]);
  });
  renderPackages();

  return {
    getPackages: () => packages.map(rule => ({ name: rule.name, counts: { ...rule.counts } })),
    refresh() {
      if (root.hidden) return;
      const ctx = getContext();
      const key = JSON.stringify([ctx.sel.season, ctx.sel.team, ctx.sel.gameId]);
      if (key !== selectionContextKey) { selectionContextKey = key; resetSelection(); }
      if (key !== contextKey) { contextKey = key; evidenceId = null; load(); }
      else if (!loading && ready) {
        if ($('scope').value === 'game') loaded = cache.get(ctx.sel.gameId)?.plays || ctx.plays;
        render();
      }
    },
    invalidate() {
      cache.clear();
      contextKey = '';
      ++revision;
      loading = ready = false;
      loaded = [];
      result = report = null;
      onCohortChange(null);
      $('content').hidden = true;
    },
    selectionChanged(plays) {
      const ctx = getContext();
      for (const key of selected) if (JSON.parse(key)[0] === ctx.sel.gameId) selected.delete(key);
      for (const play of plays) selected.add(playKey(play));
      render();
    },
    hasSelectionFilter: () => $('selection-mode').value !== 'all',
    clearSelectionFilter() { $('selection-mode').value = 'all'; },
  };
};
