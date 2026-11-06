(() => {
  'use strict';
  const api = typeof browser === 'undefined' ? chrome : browser;
  let active = null;
  let pending = Promise.resolve();
  const latest = new Map();
  const key = (game, tabId) => `capture:${tabId}:${game}`;
  async function status(job, phase, message) {
    job.phase = phase;
    job.status = { jobId: job.id, phase, message, completed: job.completed, total: job.total,
      ...(job.diagnostics ? { diagnostics: job.diagnostics } : {}) };
    latest.set(job.key, job.status);
    await api.storage.local.set({ [job.key]: job.status });
  }
  function fallbackDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'amp22-participation-v1') return;
    const packet = event.data;
    const job = active;
    if (!job || packet.jobId !== job.id) return;
    pending = pending.then(async () => {
      if (job.cancelled || active !== job) return;
      if (packet.diagnostics) {
        job.diagnostics = AMP22NFLCollector.diagnostics({
          ...packet.diagnostics, extension_version: api.runtime.getManifest().version,
        }, AMP22Participation);
        if (job.diagnostics.game_id !== job.game) throw new Error('Diagnostics game does not match this capture.');
      }
      if (packet.kind === 'error') {
        await status(job, 'error', String(packet.message).slice(0, 500));
        active = null;
      } else if (packet.kind === 'progress') {
        if (!Number.isSafeInteger(packet.total) || packet.total < 0 || packet.total > 600 ||
            !Number.isSafeInteger(packet.completed) || packet.completed < job.completed || packet.completed > packet.total ||
            (job.total && packet.total !== job.total)) throw new Error('Invalid capture progress.');
        job.total = packet.total;
        job.completed = packet.completed;
        await status(job, 'capturing', packet.message ? String(packet.message).slice(0, 300) :
          `Capturing ${job.completed}/${job.total} game plays automatically…`);
      } else if (packet.kind === 'complete') {
        if (new URL(location.href).searchParams.get('gameId') !== job.game) throw new Error('Game changed before export.');
        if (!Array.isArray(packet.rows) || packet.rows.length > 13200 || !Array.isArray(packet.playIds) ||
            packet.playIds.length !== job.total || job.completed !== job.total ||
            new Set(packet.playIds).size !== job.total) throw new Error('Game capture is incomplete. No CSV will be downloaded.');
        const rows = packet.rows.map((row) => Object.fromEntries(AMP22Participation.COLUMNS.map((column) => [column, row[column]])));
        const groups = AMP22Participation.validate(rows);
        if (groups.length !== job.total || groups.some((group) =>
          group[0].source_game_id !== job.game || !packet.playIds.includes(group[0].source_play_id))) {
          throw new Error('CSV does not contain participation for every game play.');
        }
        const filename = `nflpro-${rows[0].season}-${job.game}.csv`;
        const blob = new Blob([AMP22Participation.csv(rows)], { type: 'text/csv;charset=utf-8' });
        if (blob.size > 8 * 1024 * 1024) throw new Error('CSV exceeds AMP22’s 8 MB import limit.');
        await status(job, 'saving', `Captured all ${job.total} game plays. Starting CSV download…`);
        const result = await api.runtime.sendMessage({ action: 'download-game', rows });
        if (result?.error) throw new Error(result.error);
        if (result?.supported === false) {
          fallbackDownload(blob, filename);
        } else if (!Number.isSafeInteger(result?.downloadId)) {
          throw new Error('The browser did not accept the CSV download.');
        }
        await status(job, 'complete', `Captured all ${job.total} game plays. CSV download ${result.supported === false ? 'requested' : 'started'}: ${filename}. Check your browser’s Downloads; approve its save prompt if shown.`);
        active = null;
      }
    }).catch(async (error) => {
      if (active !== job || job.cancelled) return;
      active = null;
      window.postMessage({ channel: 'amp22-participation-cancel-v1', jobId: job.id }, location.origin);
      job.diagnostics = AMP22NFLCollector.diagnostics({
        ...job.diagnostics, game_id: job.game, extension_version: api.runtime.getManifest().version,
        completed: job.completed, total: job.total, failure: {
          ...error.detail, stage: 'export', error_code: error.code || 'EXPORT_FAILED',
        },
      }, AMP22Participation);
      try {
        await status(job, 'error', `Capture/export failed: ${error.message}`);
      } catch (storageError) {
        job.status.message += ` Status storage also failed: ${storageError.message}`;
        console.error('AMP22 capture status:', storageError.message);
      }
    });
  });
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['prepare-game', 'cancel-game', 'capture-status', 'abort-game', 'download-diagnostics'].includes(message?.action)) return;
    if (sender.id !== api.runtime.id || !/^[a-zA-Z0-9-]{1,80}$/.test(message.game) ||
        !Number.isSafeInteger(message.tabId) || message.tabId < 0) {
      respond({ error: 'Invalid extension capture request.' });
      return;
    }
    if (message.action === 'prepare-game') {
      if (active) { respond({ error: 'A capture is already running in this tab.' }); return; }
      if (new URL(location.href).searchParams.get('gameId') !== message.game) {
        respond({ error: 'The tab changed games. Try again.' }); return;
      }
      const job = { id: crypto.randomUUID(), game: message.game, key: key(message.game, message.tabId),
        completed: 0, total: 0, cancelled: false };
      active = job;
      const started = pending.then(() => status(job, 'capturing', 'Loading the complete game playlist…'));
      pending = started.catch((error) => {
        if (active === job) active = null;
        job.status.phase = 'error';
        job.status.message = error.message;
        console.error('AMP22 capture status:', error.message);
      });
      started.then(() => respond({ jobId: job.id }), (error) => respond({ error: error.message }));
    } else if (message.action === 'cancel-game' || message.action === 'abort-game') {
      const job = active;
      if (!job || job.game !== message.game) { respond({ cancelled: false }); return; }
      if (job.phase === 'saving') { respond({ error: 'CSV saving has already started. Use your browser to cancel the download.' }); return; }
      job.cancelled = true;
      active = null;
      const cancelled = pending.then(() => status(job, message.action === 'abort-game' ? 'error' : 'cancelled',
        message.action === 'abort-game' ? String(message.error).slice(0, 500) : 'Capture cancelled. No CSV was downloaded.'));
      pending = cancelled.catch((error) => console.error('AMP22 capture status:', error.message));
      cancelled.then(() => respond({ jobId: job.id }), (error) => respond({ error: error.message }));
    } else if (message.action === 'download-diagnostics') {
      const downloaded = pending.then(async () => {
        const statusKey = key(message.game, message.tabId);
        const stored = latest.get(statusKey) || (await api.storage.local.get(statusKey))[statusKey];
        if (!stored?.diagnostics) throw new Error('No diagnostics are available for this game yet.');
        const report = AMP22NFLCollector.diagnostics(stored.diagnostics, AMP22Participation);
        if (report.game_id !== message.game) throw new Error('Diagnostics game does not match this tab.');
        const filename = `AMP22-NFL-Pro-diagnostics-${report.game_id}.json`;
        const result = await api.runtime.sendMessage({ action: 'download-diagnostics', diagnostics: report });
        if (result?.error) throw new Error(result.error);
        if (result?.supported === false) {
          fallbackDownload(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }), filename);
        } else if (!Number.isSafeInteger(result?.downloadId)) throw new Error('The browser did not accept the diagnostics download.');
        return { filename };
      });
      pending = downloaded.catch((error) => console.error('AMP22 diagnostic download:', error.message));
      downloaded.then(respond, (error) => respond({ error: error.message }));
    } else {
      const checked = pending.then(async () => {
        const statusKey = key(message.game, message.tabId);
        const stored = latest.get(statusKey) || (await api.storage.local.get(statusKey))[statusKey];
        if (stored && ['capturing', 'saving'].includes(stored.phase) && stored.jobId !== active?.id) {
          stored.phase = 'error';
          stored.message = 'Capture was interrupted by a page reload. Click Capture game & save CSV to try again.';
          latest.set(statusKey, stored);
          await api.storage.local.set({ [statusKey]: stored });
        }
        return stored;
      });
      pending = checked.catch((error) => console.error('AMP22 capture status:', error.message));
      checked.then((result) => respond({ status: result }), (error) => respond({ error: error.message }));
    }
    return true;
  });
})();
