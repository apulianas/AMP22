/* Runs in NFL Pro's page world; its API client retains all authentication. */
(() => {
  'use strict';
  if (window.AMP22Capture?.version === 4) return;
  window.AMP22Capture?.stop();
  let current = null;
  const channel = 'amp22-participation-v1';
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const send = (job, kind, fields = {}) =>
    window.postMessage({ channel, jobId: job.id, kind, ...fields }, location.origin);
  function record(job, type, fields = {}) {
    job.events.push({ at: new Date().toISOString(), type, ...fields });
    if (job.events.length > 200) job.events.shift();
  }
  function diagnostics(job, failure = null) {
    return window.AMP22NFLCollector.diagnostics({
      game_id: job.params.gameId, started_at: job.startedAt, completed: job.completed,
      total: job.total, events: job.events, failure,
    }, window.AMP22Participation);
  }
  function check(job) {
    if (job.cancelled) throw new Error('Capture cancelled.');
    const query = new URL(location.href).searchParams;
    if (Object.entries(job.params).some(([key, value]) => query.get(key) !== value)) {
      throw new Error('Game changed during capture. No CSV was saved.');
    }
  }
  async function request(job, endpoint, params) {
    for (let attempt = 0; ; attempt++) {
      check(job);
      const context = { endpoint: job.stage === 'charting' ? 'charting' : endpoint.endsWith('/plays') ? 'playlist' : 'participation',
        source_play_id: params.playId, attempt: attempt + 1 };
      record(job, 'request', context);
      try {
        const result = await job.api.$get(endpoint, { params, timeout: 15000, signal: job.controller.signal });
        check(job);
        record(job, 'response', context);
        return result;
      } catch (error) {
        check(job);
        const status = error.response?.status;
        record(job, 'failed', { ...context, http_status: status, error_code: error.code });
        if (attempt === 2 || !([429, 500, 502, 503, 504].includes(status) ||
            ['ECONNABORTED', 'ERR_NETWORK'].includes(error.code))) throw error;
        const header = error.response?.headers?.['retry-after'];
        const seconds = header == null ? NaN : Number(header);
        const retry = Number.isFinite(seconds) ? seconds * 1000 :
          header && Number.isFinite(Date.parse(header)) ? Math.max(0, Date.parse(header) - Date.now()) : 2000 * (attempt + 1);
        if (retry > 60000) throw new Error('NFL Pro requested a longer pause. Wait before trying capture again.');
        record(job, 'retry', { ...context, http_status: status, retry_ms: Math.max(500, retry) });
        send(job, 'progress', { completed: job.completed, total: job.total,
          message: `NFL Pro is busy; retrying in ${Math.ceil(Math.max(500, retry) / 1000)} seconds.` });
        await delay(Math.max(500, retry));
      }
    }
  }
  async function capture(job) {
    check(job);
    if (typeof job.api?.$get !== 'function') throw new Error('NFL Pro’s API client is unavailable. Sign in and reload the game.');
    const response = await request(job, '/api/secured/videos/filmroom/plays', job.params);
    const plays = window.AMP22NFLCollector.gamePlays(response, job.url);
    job.total = plays.length;
    send(job, 'progress', { completed: 0, total: job.total });
    const charting = new Map(plays.map(play => [String(play.playId), {}]));
    job.stage = 'charting';
    for (const field of window.AMP22Participation.CHARTING_FIELDS) {
      send(job, 'progress', { completed: 0, total: job.total, message: `Capturing NFL Pro charting: ${field.query}…` });
      const responses = new Map();
      for (const [parameter] of field.options) {
        await delay(500);
        responses.set(parameter, await request(job, '/api/secured/videos/filmroom/plays', { ...job.params, [field.query]: parameter }));
      }
      const values = window.AMP22NFLCollector.chartingField(plays, responses, job.url, field);
      for (const [id, value] of values) charting.get(id)[field.column] = value;
    }
    const chartingTime = new Date().toISOString();
    const chartedPlays = [...charting.values()].filter(values => Object.keys(values).length).length;
    const rows = [];
    for (const play of plays) {
      if (job.completed) await delay(500);
      job.stage = 'participation';
      job.playId = String(play.playId);
      const expanded = await request(job, '/api/plays/summaryPlay',
        { gameId: String(play.fapiGameId), playId: String(play.playId) });
      if (expanded?.code) throw new Error(`NFL Pro did not return participation for play ${play.playId}.`);
      job.stage = 'validation';
      const captured = window.AMP22NFLCollector.participation(play, expanded, job.url, new Date().toISOString(),
        { ...charting.get(String(play.playId)), charting_method: 'filtered-playlists', charting_captured_at: chartingTime });
      if (window.AMP22Participation.validate(captured).length !== 1) throw new Error('Expected participation for one play.');
      rows.push(...captured);
      job.completed++;
      record(job, 'validated', { source_play_id: job.playId });
      send(job, 'progress', { completed: job.completed, total: job.total });
    }
    check(job);
    window.AMP22Participation.validate(rows);
    record(job, 'finished');
    send(job, 'complete', { rows, playIds: plays.map((play) => String(play.playId)), chartedPlays, diagnostics: diagnostics(job) });
  }
  window.AMP22Capture = {
    version: 4,
    start(id) {
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('Invalid capture request.');
      if (current && !current.cancelled) throw new Error('This tab is already capturing a game.');
      const url = location.href;
      const query = new URL(url).searchParams;
      const params = Object.fromEntries(['season', 'seasonType', 'weekSlug', 'gameId'].map((key) => [key, query.get(key)]));
      if (Object.values(params).some((value) => !value)) throw new Error('Open a single game with its season and week selected.');
      const job = { id, url, params, api: window.$nuxt?.$api, completed: 0, total: 0,
        stage: 'playlist', playId: '', startedAt: new Date().toISOString(), events: [],
        controller: new AbortController(), cancelled: false };
      current = job;
      return capture(job).catch((error) => {
        if (!job.cancelled) {
          record(job, 'failed', { source_play_id: job.playId, error_code: error.code, http_status: error.response?.status });
          send(job, 'error', {
            message: `Capture stopped after ${job.completed}/${job.total || '?'} plays: ${error.message} No CSV was downloaded.`,
            diagnostics: diagnostics(job, { ...error.detail, stage: job.stage,
              source_play_id: job.playId, error_code: error.code, http_status: error.response?.status }),
          });
        }
      }).finally(() => { if (current === job) current = null; });
    },
    stop(id) {
      if (!current || (id && current.id !== id)) return;
      current.cancelled = true;
      current.controller.abort();
    },
  };
  window.addEventListener('message', (event) => {
    if (event.source === window && event.origin === location.origin &&
        event.data?.channel === 'amp22-participation-cancel-v1') {
      window.AMP22Capture.stop(event.data.jobId);
    }
  });
})();
