'use strict';

importScripts('participation.js', 'collector.js');
const api = typeof browser === 'undefined' ? chrome : browser;
api.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['download-game', 'download-diagnostics'].includes(message?.action)) return;
  (async () => {
    if (sender.id !== api.runtime.id || !/^https:\/\/pro\.nfl\.com\/film\/plays(?:\?|$)/.test(sender.tab?.url || '')) {
      throw new Error('Downloads must originate from the NFL Pro capture tab.');
    }
    const game = new URL(sender.tab.url).searchParams.get('gameId');
    if (message.action === 'download-diagnostics') {
      const report = AMP22NFLCollector.diagnostics(message.diagnostics, AMP22Participation);
      if (report.game_id !== game) throw new Error('Diagnostics game does not match the capture tab.');
      if (typeof api.downloads?.download !== 'function') return { supported: false };
      const downloadId = await api.downloads.download({
        url: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report, null, 2) + '\n')}`,
        filename: `AMP22-NFL-Pro-diagnostics-${game}.json`, saveAs: false,
      });
      return { supported: true, downloadId };
    }
    if (!Array.isArray(message.rows) || message.rows.length > 13200) throw new Error('Invalid game export.');
    AMP22Participation.validate(message.rows);
    if (message.rows.some((row) => row.source_game_id !== game)) throw new Error('Export game does not match the capture tab.');
    if (typeof api.downloads?.download !== 'function') return { supported: false };
    const csv = AMP22Participation.csv(message.rows);
    if (new TextEncoder().encode(csv).length > 8 * 1024 * 1024) throw new Error('CSV exceeds AMP22’s 8 MB import limit.');
    const downloadId = await api.downloads.download({
      url: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`,
      filename: `nflpro-${message.rows[0].season}-${game}.csv`, saveAs: false,
    });
    return { supported: true, downloadId };
  })().then(respond, (error) => respond({ error: error.message }));
  return true;
});
