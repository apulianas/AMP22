(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.AMP22NFLCollector = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function gamePlays(response, url) {
    const game = new URL(url).searchParams.get('gameId');
    const count = Number(response?.count);
    if (response?.code || !Number.isSafeInteger(count) || count < 1 || count > 600 ||
        !Array.isArray(response.plays) || response.plays.length !== count) {
      throw new Error('NFL Pro did not return a complete game playlist. No CSV will be saved.');
    }
    const ids = new Set();
    let fapiGame;
    for (const play of response.plays) {
      const id = String(play.playId ?? '');
      const fapi = String(play.fapiGameId ?? '');
      if (![String(play.gameId), fapi].includes(game) || !/^[a-zA-Z0-9-]{1,80}$/.test(id) ||
          !/^[a-zA-Z0-9-]{1,80}$/.test(fapi) || ids.has(id) || (fapiGame && fapi !== fapiGame)) {
        throw new Error('NFL Pro returned duplicate plays or inconsistent game identities.');
      }
      ids.add(id);
      fapiGame = fapi;
    }
    return response.plays;
  }

  function snapshot(state, url, now = new Date().toISOString()) {
    const selected = state?.film?.selectedPlay;
    const expanded = state?.film?.selectedPlayExpanded;
    if (!selected || !expanded || expanded.requestKey !== `${selected.fapiGameId}-${selected.playId}`) {
      throw new Error('Waiting for the selected play’s participation to finish loading.');
    }
    return participation(selected, expanded, url, now);
  }

  function participation(selected, expanded, url, now = new Date().toISOString()) {
    if (!Array.isArray(expanded?.home) || !Array.isArray(expanded?.away) || typeof expanded.homeIsOffense !== 'boolean') {
      throw new Error('NFL Pro did not expose the expected home/away participation fields.');
    }
    const query = new URL(url).searchParams;
    const sourceGame = query.get('gameId');
    if (!sourceGame) throw new Error('Open a single game in NFL Pro before capturing.');
    // These are the same Vuex fields used by NFL Pro's OnFieldPlayers component.
    const home = selected.homeTeamAbbr;
    const away = selected.visitorTeamAbbr;
    const down = String(selected.down ?? '');
    const base = {
      schema_version: '1', season: query.get('season'), season_type: query.get('seasonType'),
      week: String(/^WEEK_\d+$/.test(query.get('weekSlug') || '') ?
        query.get('weekSlug').replace(/^WEEK_/, '') : selected.week ?? ''),
      away_team: away, home_team: home, source_game_id: sourceGame,
      source_play_id: String(selected.playId), quarter: String(selected.quarter),
      clock: String(selected.gameClock), down: down === '--' || down === '0' ? '' :
        down.replace(/^([1-4])(?:st|nd|rd|th) & \d+$/, '$1'),
      yards_to_go: String(selected.yardsToGo ?? ''),
      description: String(selected.playDescriptionNoTime ?? selected.playDescription ?? '').replace(/^\([^)]*\)\s*/, ''),
      captured_at: now,
    };
    if (![String(selected.gameId), String(selected.fapiGameId)].includes(sourceGame)) {
      throw new Error('The loaded play is from a different game than the URL.');
    }
    return ['home', 'away'].flatMap((side) => expanded[side].map((p) => ({
      ...base,
      side: (side === 'home') === expanded.homeIsOffense ? 'offense' : 'defense',
      team: side === 'home' ? home : away,
      source_player_id: String(p.nflId ?? '').trim() || String(p.gsisId ?? '').trim(), gsis_id: String(p.gsisId ?? '').trim(),
      name: String(p.playerName ?? ''), jersey_number: String(p.uniformNumber ?? ''),
      position: String(p.position ?? '').toUpperCase(),
    })));
  }

  function diagnostics(report, schema) {
    const id = (value) => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value) ? value : '';
    const time = (value) => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : '';
    const count = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max ? value : 0;
    if (!report || !id(report.game_id)) throw new Error('Invalid capture diagnostics.');
    const failure = report.failure;
    const field = schema.COLUMNS.includes(failure?.field) ? failure.field : '';
    const code = (value) => typeof value === 'string' && /^[A-Z_]{1,40}$/.test(value) ? value : '';
    return {
      diagnostics_version: 1,
      extension_version: /^\d+\.\d+\.\d+$/.test(report.extension_version || '') ? report.extension_version : '',
      game_id: report.game_id,
      started_at: time(report.started_at),
      completed: count(report.completed, 600), total: count(report.total, 600),
      failure: failure ? {
        stage: ['playlist', 'participation', 'validation', 'export'].includes(failure.stage) ? failure.stage : '',
        source_play_id: id(failure.source_play_id),
        field, ...(field ? { value: schema.validationValue(field, failure.value) } : {}),
        row: count(failure.row, 13200),
        error_code: code(failure.error_code),
        http_status: count(failure.http_status, 599),
      } : null,
      events: (Array.isArray(report.events) ? report.events.slice(-200) : []).map((event) => ({
        at: time(event?.at),
        type: ['request', 'response', 'retry', 'validated', 'failed', 'finished'].includes(event?.type) ? event.type : '',
        endpoint: ['playlist', 'participation'].includes(event?.endpoint) ? event.endpoint : '',
        source_play_id: id(event?.source_play_id),
        attempt: count(event?.attempt, 3),
        http_status: count(event?.http_status, 599),
        retry_ms: count(event?.retry_ms, 60000),
        error_code: code(event?.error_code),
      })),
    };
  }

  return { snapshot, participation, gamePlays, diagnostics };
});
