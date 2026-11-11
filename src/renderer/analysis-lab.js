/* global A22 */
'use strict';

window.createAnalysisLab = function ({ getContext, preparePlays, matchesFilter, filterDescription, onCohortChange, onSelectionChange, openPlay }) {
  const A = A22.analysis;
  const AI = A22.analysisAI;
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
  let aiRevision = 0;
  let aiBusy = false;
  let aiChecking = false;
  let aiCheckedAt = 0;
  let aiRows = [];
  let aiEvidence = [];
  let aiCloud = false;
  let aiDiscoveryPending = false;
  let handoffReport = null;
  let handoffRevision = 0;
  let handoffBusy = false;
  const handoffDialog = document.getElementById('analysis-context');
  const share = id => document.getElementById(`analysis-context-${id}`);
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
    <details id="lab-ai" class="lab-methods" hidden>
      <summary>Ask Analysis Lab</summary>
      <p><span id="lab-ai-privacy">Questions stay on this device.</span> The model interprets your question; AMP22 calculates the numbers.
        Uses the current scope, analysis side, sidebar filters and play selection without changing them.</p>
      <form id="lab-ai-form">
        <label id="lab-ai-model-label" hidden>Question provider<select id="lab-ai-model"></select></label>
        <label for="lab-ai-question">Question</label>
        <textarea id="lab-ai-question" rows="2" maxlength="1000" required
          placeholder="Compare defensive EPA with and without Kyle Hamilton on the field."></textarea>
        <div class="row"><button id="lab-ai-ask" type="submit" disabled>Ask</button>
          <button id="lab-ai-cancel" type="button" hidden>Cancel</button>
          <span id="lab-ai-provider" class="muted small"></span></div>
      </form>
      <p id="lab-ai-status" role="status" aria-live="polite"></p>
      <p id="lab-ai-usage" class="muted small"></p>
      <section id="lab-ai-answer" hidden aria-label="Computed answer">
        <p id="lab-ai-summary"></p><p id="lab-ai-query" class="muted small"></p>
        <p id="lab-ai-context" class="muted small"></p>
        <div class="lab-table-wrap"><table class="lab-table"><thead><tr>
          <th>Group / split</th><th>Snaps</th><th>Requested metric</th><th>Known observations</th>
        </tr></thead><tbody id="lab-ai-rows"></tbody></table></div>
        <details><summary>All computed metrics</summary>
          <div class="lab-table-wrap"><table class="lab-table"><thead><tr>
            <th>Group / split</th><th>Scored snaps</th><th>YPP (known yards)</th><th>Off. EPA/play (known EPA)</th>
            <th>Off. success (known EPA)</th><th>Explosives (known yards)</th><th>3rd/4th conversion (known observations)</th>
          </tr></thead><tbody id="lab-ai-statistics"></tbody></table></div>
          <p class="muted small">Each metric shows its own denominator. Ranking uses the interpreted query's primary metric.
            These are scored runs/passes, not all special-teams, nullified or other snaps.</p>
        </details>
        <p id="lab-ai-coverage" class="muted small"></p>
        <p class="muted small">* = listed-position estimate, not confirmed alignment.
          Missing values are not zero. Comparisons are descriptive, not causal.
          Check the interpreted query and contributing plays; models can misunderstand questions.</p>
        <section id="lab-ai-evidence" hidden aria-label="Question play evidence">
          <p id="lab-ai-evidence-label"></p><ol id="lab-ai-evidence-plays"></ol>
        </section>
      </section>
    </details>
    <div id="lab-content" hidden>
      <div id="lab-summary" class="lab-summary"></div>
      <details class="lab-methods"><summary>Definitions, data coverage &amp; package rules</summary>
        <p>${A.EXCLUSIONS}</p><p>${A.DEFINITIONS}</p>
        <p>All sidebar filters and the Analyze play-selection mode also apply to this cohort, across every game in a range. Only selected plays intersects selections with those filters; Exclude selected plays removes them. An empty selection produces no snaps in Only selected plays, and excludes nothing in Exclude selected plays. Run/pass splits use official play type: sacks are passes and scrambles are runs. Usage is share of the entire filtered cohort, not within a split. Unknown data stays visible; missing values are never zero.</p>
        <p>Packages marked * are estimates from listed positions, not charted alignment. Generic LB/DB positions are not guessed as ILB/CB/S. Complete, uniquely identified eleven-player defenses are required for composition rules. Otherwise the supplied broad package is retained, or Unknown. A player's presence does not establish coverage responsibility or causal impact.</p>
        <p>A WR listed on defense is assumed to be a CB for package identification, including custom rules. The recorded player position remains WR; this assumption does not verify the player's actual alignment.</p>
        <p>Jumbo* identifies a complete eleven-player defense with at least four listed DL (DE/DT/NT), at least two OLB, and no more than four DBs. It is a heavy-front composition estimate, not confirmed goal-line alignment. Custom exact-composition rules take precedence.</p>
        <p>32 dime* identifies three listed DL/OLB combined, two explicit ILB (including MLB), and six DBs. Two inside linebackers distinguish it from standard and rush dime; generic LB positions do not establish that role. This also requires a complete, uniquely identified eleven-player defense for on-field estimates.</p>
        <p>Jumbo nickel* identifies three DL, one OLB, two explicit ILB (including MLB), and five DBs: a nickel composition with one OLB replaced by a DL. Both standard (three CB/two S) and big (two CB/three S) DB combinations qualify. Generic LB positions are not guessed as inside or outside linebackers; exact custom rules take precedence.</p>
        <p>Offensive personnel counts every OL beyond five as a TE, with the total OL count in parentheses: one RB, one TE and six OL is 12 (6); seven OL is 13 (7). Complete, unique eleven-player lists with one QB are required for on-field estimates, marked *. Original positions and reported eligibility are unchanged.</p>
        <p>Explicit Direct snap to descriptions append Wildcat for a listed RB/HB/FB/WR recipient, or Tush push for a TE, even when a different player subsequently runs or passes. Positions come from participation or an unambiguous nflverse player-directory match. A positive FTN QB-sneak flag also appends Tush push; ordinary QB rushes and short yardage alone do not. Special-teams/punt or field-goal formations are excluded. Missing personnel counts stay Unknown alongside the modifier. Complete direct-snap lineups may omit a listed QB; RB and TE counts still use recorded positions.</p>
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
        <span class="spacer"></span><button id="lab-copy-context">Copy analysis…</button><button id="lab-svg">Save SVG</button><button id="lab-png">Save PNG</button><button id="lab-csv">Summary CSV</button>
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

  function clearAI() {
    ++aiRevision;
    if (aiBusy) window.api.cancelAnalysisQuestion().catch(error => console.warn('Analytics AI cancellation:', error.message));
    aiBusy = false;
    aiRows = aiEvidence = [];
    $('ai-rows').replaceChildren();
    $('ai-statistics').replaceChildren();
    $('ai-answer').hidden = true;
    $('ai-evidence').hidden = true;
    $('ai-status').textContent = '';
    $('ai-usage').textContent = '';
    $('ai-cancel').hidden = true;
    $('ai-question').disabled = $('ai-model').disabled = false;
    $('ai-ask').disabled = !ready || !result?.n;
  }

  async function discoverAI(force = false) {
    if (root.hidden || aiBusy || (!force && Date.now() - aiCheckedAt < 60000)) return;
    if (aiChecking) { aiDiscoveryPending ||= force; return; }
    aiChecking = true;
    aiCheckedAt = Date.now();
    try {
      const models = await window.api.discoverAnalysisAI();
      const previous = $('ai-model').value;
      $('ai-model').innerHTML = models.map(m => `<option value="${esc(m.id)}" data-cloud="${m.cloud === true}">${esc(m.label)}</option>`).join('');
      if (models.some(m => m.id === previous)) $('ai-model').value = previous;
      if (previous && $('ai-model').value !== previous) clearAI();
      $('ai').hidden = !models.length;
      $('ai-model-label').hidden = models.length < 2;
      updateProvider();
      $('ai-ask').disabled = !ready || !result?.n;
    } catch (error) {
      console.warn('Analytics AI discovery:', error.message);
      $('ai').hidden = true;
    } finally {
      aiChecking = false;
      if (aiDiscoveryPending) { aiDiscoveryPending = false; discoverAI(true); }
    }
  }

  function updateProvider() {
    const selected = $('ai-model').selectedOptions[0];
    aiCloud = selected?.dataset.cloud === 'true';
    $('ai-provider').textContent = selected?.textContent || '';
    $('ai-privacy').textContent = aiCloud ?
      'Cloud provider selected. After your confirmation, the question and analytical context leave this device. Provider API charges and retention policies apply.' :
      'Questions stay on this device.';
  }

  async function askAI(event) {
    event.preventDefault();
    if (aiBusy || !ready || !result?.n || $('ai').hidden) return;
    clearAI();
    const token = aiRevision;
    const ctx = getContext();
    const plays = result.plays.slice();
    const options = { team: ctx.sel.team, side: $('side').value, packages: packages.map(p => ({ name: p.name, counts: { ...p.counts } })) };
    const context = {
      team: ctx.sel.team, side: options.side, scope: $('scope-note').textContent, snaps: plays.length,
      filters: `${filterDescription()}. ${$('selection-mode').selectedOptions[0].textContent}; ${selected.size} selected`,
    };
    aiBusy = true;
    $('ai-ask').disabled = $('ai-question').disabled = $('ai-model').disabled = true;
    $('ai-cancel').hidden = false;
    $('ai-status').classList.remove('error');
    $('ai-status').textContent = aiCloud ? 'Waiting for cloud confirmation, then interpreting the question...' : 'Interpreting the question on this device...';
    try {
      const response = await window.api.planAnalysisQuestion({
        provider: $('ai-model').value, question: $('ai-question').value,
        context, catalog: AI.catalog(plays, options.packages),
      });
      if (token !== aiRevision) return;
      const plan = response.plan || response;
      if (aiCloud) $('ai-usage').textContent = response.usage ?
        `Provider-reported usage: ${response.usage.inputTokens} input / ${response.usage.outputTokens} output tokens. Billed by your API provider; no reliable cost estimate is available.` :
        'The provider did not report token usage. API charges may still apply.';
      const answer = AI.execute(plays, options, plan);
      aiRows = answer.rows;
      $('ai-summary').textContent = answer.summary;
      $('ai-query').textContent = `Interpreted query: ${answer.interpretation}`;
      $('ai-context').textContent = `${context.scope} / ${context.team} ${context.side}. ${context.filters}.`;
      $('ai-coverage').textContent = `${answer.n}/${plays.length} cohort snaps match. Known EPA: ${answer.knownEpa}/${answer.n}; ` +
        `known yards: ${answer.knownYards}/${answer.n}; known defense: ${answer.knownDefense}/${answer.n}; ` +
        `known offense: ${answer.knownOffense}/${answer.n}. ` +
        `${Object.entries(answer.sources).map(([s, n]) => `${s}: ${n} snaps`).join('; ')}. ` +
        `${answer.participation ? answer.participation + ' ' : ''}` +
        `Showing ${Math.min(50, aiRows.length)} of ${aiRows.length} rows, ranked by ${AI.METRICS[plan.metric].label}. ` +
        `${warnings.length ? 'Data warnings: ' + warnings.join(' | ') : ''}`;
      $('ai-rows').innerHTML = aiRows.slice(0, 50).map((r, i) => {
        const sample = plan.metric === 'snaps' ? r.n : plan.metric === 'conversion' ? r.conversionN :
          ['epa', 'success'].includes(plan.metric) ? r.epaN : r.yardsN;
        return `<tr><td><button data-ai-row="${i}">${esc(r.label)}</button><small>${esc(r.series)}</small></td>
          <td>${r.n}</td>
          <td>${esc(AI.format(r[plan.metric], plan.metric))}</td><td>${sample}</td></tr>`;
      }).join('');
      $('ai-statistics').innerHTML = aiRows.slice(0, 50).map(r => `<tr>
        <td>${esc(r.label)}<small>${esc(r.series)}</small></td><td>${r.n}</td>
        ${Object.keys(A.METRICS).map(metric => {
          const sample = metric === 'conversion' ? r.conversionN : ['epa', 'success'].includes(metric) ? r.epaN : r.yardsN;
          return `<td>${esc(A.format(r[metric], metric))}<small>n = ${sample}</small></td>`;
        }).join('')}</tr>`).join('');
      $('ai-answer').hidden = false;
      $('ai-status').textContent = 'Answer computed by AMP22. Click a result row to inspect its plays.';
    } catch (error) {
      if (token !== aiRevision) return;
      $('ai-status').textContent = `Question not answered: ${error.message}`;
      $('ai-status').classList.add('error');
    } finally {
      if (token === aiRevision) {
        aiBusy = false;
        $('ai-cancel').hidden = true;
        $('ai-question').disabled = $('ai-model').disabled = false;
        $('ai-ask').disabled = !ready || !result?.n;
      }
    }
  }

  async function load(force = false) {
    clearAI();
    clearHandoff();
    const token = ++revision;
    const ctx = getContext();
    loading = true;
    ready = false;
    $('ai-ask').disabled = true;
    $('copy-context').disabled = true;
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
    clearAI();
    clearHandoff();
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
    $('ai-ask').disabled = !result.n;
    $('copy-context').disabled = !result.n;
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

  function clearHandoff() {
    ++handoffRevision;
    handoffReport = null;
    if (handoffDialog.open) handoffDialog.close();
    share('preview').value = '';
    share('copy').disabled = share('save').disabled = true;
  }

  async function previewHandoff() {
    const token = ++handoffRevision;
    share('copy').disabled = share('save').disabled = true;
    share('preview').value = '';
    if (!handoffReport) return;
    try {
      const result = await window.api.shareAnalysisContext({
        action: 'preview', report: handoffReport, question: share('question').value,
      });
      if (token !== handoffRevision) return;
      share('preview').value = result.text;
      share('status').classList.remove('error');
      share('status').textContent = 'Nothing has been copied, saved or sent. Review this text before sharing it.';
      share('copy').disabled = share('save').disabled = false;
    } catch (error) {
      if (token !== handoffRevision) return;
      share('status').textContent = `Preview unavailable: ${error.message}`;
      share('status').classList.add('error');
    }
  }

  $('copy-context').addEventListener('click', () => {
    if (!ready || !report || !result?.n) return;
    handoffReport = { ...report, rows: result.rows.map(({ plays, ...row }) => row) };
    share('question').value = $('ai').hidden ? '' : $('ai-question').value;
    handoffDialog.showModal();
    previewHandoff();
  });
  share('question').addEventListener('input', previewHandoff);
  share('close').addEventListener('click', () => handoffDialog.close());
  handoffDialog.addEventListener('close', () => {
    ++handoffRevision;
    handoffReport = null;
    share('preview').value = '';
  });
  for (const action of ['copy', 'save']) share(action).addEventListener('click', async () => {
    if (!handoffReport || handoffBusy || share(action).disabled) return;
    const token = handoffRevision;
    handoffBusy = true;
    share('question').disabled = share('copy').disabled = share('save').disabled = true;
    try {
      const result = await window.api.shareAnalysisContext({ action, report: handoffReport, question: share('question').value });
      if (token !== handoffRevision) return;
      share('status').classList.remove('error');
      share('status').textContent = result.cancelled ? 'Save cancelled. Nothing was sent.' :
        action === 'copy' ? 'Text copied. Paste it into your chat app; AMP22 has not sent it anywhere.' : 'Analysis context saved as TXT. Nothing was sent.';
    } catch (error) {
      if (token !== handoffRevision) return;
      share('status').textContent = `Sharing failed: ${error.message}`;
      share('status').classList.add('error');
    } finally {
      handoffBusy = false;
      share('question').disabled = false;
      if (token === handoffRevision) share('copy').disabled = share('save').disabled = false;
    }
  });

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
  $('ai-form').addEventListener('submit', askAI);
  $('ai-model').addEventListener('change', () => {
    clearAI();
    updateProvider();
  });
  $('ai-cancel').addEventListener('click', () => {
    clearAI();
    $('ai-status').textContent = 'Question cancelled.';
  });
  $('ai-rows').addEventListener('click', event => {
    const button = event.target.closest('[data-ai-row]');
    if (!button) return;
    const row = aiRows[Number(button.dataset.aiRow)];
    if (!row) return;
    aiEvidence = row.plays;
    $('ai-evidence-label').textContent = `${row.label} / ${row.series}: ${aiEvidence.length} contributing plays; showing first ${Math.min(200, aiEvidence.length)}.`;
    $('ai-evidence-plays').innerHTML = aiEvidence.slice(0, 200).map((p, i) =>
      `<li><button data-ai-play="${i}">${esc(p.gameId)} / ${esc(A22.plays.clockLabel(p))} / ${esc(A22.plays.downDistance(p))}</button>
        <p>${esc(p.desc)}</p></li>`).join('');
    $('ai-evidence').hidden = false;
  });
  $('ai-evidence-plays').addEventListener('click', event => {
    const button = event.target.closest('[data-ai-play]');
    if (button) openPlay(aiEvidence[Number(button.dataset.aiPlay)]);
  });
  window.addEventListener('focus', () => discoverAI());
  window.addEventListener('amp22-ai-providers-changed', () => { clearAI(); aiCheckedAt = 0; discoverAI(true); });

  return {
    getPackages: () => packages.map(rule => ({ name: rule.name, counts: { ...rule.counts } })),
    refresh() {
      if (root.hidden) return;
      const ctx = getContext();
      const key = JSON.stringify([ctx.sel.season, ctx.sel.team, ctx.sel.gameId]);
      discoverAI(key !== contextKey);
      if (key !== selectionContextKey) { selectionContextKey = key; resetSelection(); }
      if (key !== contextKey) { contextKey = key; evidenceId = null; load(); }
      else if (!loading && ready) {
        if ($('scope').value === 'game') loaded = cache.get(ctx.sel.gameId)?.plays || ctx.plays;
        render();
      }
    },
    invalidate() {
      clearAI();
      clearHandoff();
      $('copy-context').disabled = true;
      $('ai-ask').disabled = true;
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
