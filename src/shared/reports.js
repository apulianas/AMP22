(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const mod = factory(node ? require('./plays') : root.A22.plays, node ? require('./teams') : root.A22.teams,
    node ? require('./advanced') : root.A22.advanced, node ? require('./analysis') : root.A22.analysis);
  if (node) module.exports = mod;
  else (root.A22 = root.A22 || {}).reports = mod;
})(typeof self !== 'undefined' ? self : this, function (P, teams, advanced, analysis) {
  'use strict';

  const FORMATS = ['none', 'csv', 'txt', 'pdf'];
  const ADVANCED_FIELDS = [
    { key: 'airYards', label: 'Air yards', get: (p) => p.airYards },
    { key: 'epa', label: 'EPA', get: (p) => p.epa },
    { key: 'personnel', label: 'Offensive personnel', get: (p) => advanced.formatOffensePackage(p.personnel?.offense, p) },
    { key: 'defense', label: 'Defensive package', get: (p) => packageLabel(p) },
    { key: 'formation', label: 'Formation', get: (p) => p.charting?.formation },
    { key: 'qbLocation', label: 'QB alignment', get: (p) => p.charting?.qbLocation },
    { key: 'backfield', label: 'Backfield count', get: (p) => p.charting?.backfield },
    { key: 'box', label: 'Box count', get: (p) => p.charting?.box },
    { key: 'motion', label: 'Motion', get: (p) => p.charting?.motion },
    { key: 'playAction', label: 'Play action', get: (p) => p.charting?.playAction },
    { key: 'rpo', label: 'RPO', get: (p) => p.charting?.rpo },
    { key: 'screen', label: 'Screen', get: (p) => p.charting?.screen },
    { key: 'noHuddle', label: 'No-huddle', get: (p) => p.charting?.noHuddle },
    { key: 'qbSneak', label: 'QB sneak (FTN)', get: (p) => p.charting?.qbSneak },
    { key: 'rushers', label: 'Pass rushers', get: (p) => p.charting?.rushers },
    { key: 'blitzers', label: 'Blitzers', get: (p) => p.charting?.blitzers },
    { key: 'coverage', label: 'Coverage', get: (p) => p.charting?.coverage },
    { key: 'manZone', label: 'Man / zone', get: (p) => p.charting?.manZone },
    { key: 'blitz', label: 'NGS blitz', get: (p) => p.charting?.blitz },
    { key: 'pressure', label: 'NGS pressure', get: (p) => p.charting?.pressure },
    { key: 'boxCategory', label: 'NGS box category', get: (p) => p.charting?.boxCategory },
    { key: 'defPersonnelGroup', label: 'NGS defensive personnel group', get: (p) => p.charting?.defPersonnelGroup },
    { key: 'chartingSources', label: 'Charting sources', get: (p) => p.chartingSources ? JSON.stringify(p.chartingSources) : '' },
    { key: 'nflProCharting', label: 'NFL Pro charting and provenance', get: (p) => p.nflProCharting ? JSON.stringify(p.nflProCharting) : '' },
    { key: 'chartingConflicts', label: 'Charting disagreements (existing value retained)', get: (p) => p.chartingConflicts ? JSON.stringify(p.chartingConflicts) : '' },
    ...['offense', 'defense'].flatMap((side) => [
      { key: `${side}PlayerIds`, label: `${side === 'offense' ? 'Offense' : 'Defense'} player IDs`, get: (p) => p.onField?.[side]?.map((x) => x.id || (x.sourceId ? `nflpro:${x.sourceId}` : '')).join(';') },
      { key: `${side}PlayerNames`, label: `${side === 'offense' ? 'Offense' : 'Defense'} player names`, get: (p) => p.onField?.[side]?.map((x) => x.name).join(';') },
      { key: `${side}PlayerPositions`, label: `${side === 'offense' ? 'Offense' : 'Defense'} player positions`, get: (p) => p.onField?.[side]?.map((x) => x.position).join(';') },
      ...(side === 'offense' ? [
        { key: 'offenseInferredPlayerPositions', label: 'Offense inferred player positions', get: (p) => p.onField?.offense?.map((x) => x.positionInference?.position || '').join(';') },
        { key: 'offensePositionInferenceSources', label: 'Offense position inference sources', get: (p) => p.onField?.offense?.map((x) => x.positionInference?.source || '').join(';') },
        { key: 'offensePositionInferenceDates', label: 'Offense position inference as of', get: (p) => p.onField?.offense?.map((x) => x.positionInference?.asOf || '').join(';') },
        { key: 'offenseEligiblePlayerIds', label: 'Offense reported eligible player IDs', get: (p) => p.onField?.offense?.filter(x => x.eligibleReceiver).map(x => x.id || (x.sourceId ? `nflpro:${x.sourceId}` : '')).join(';') },
      ] : []),
      { key: `${side}PlayerNumbers`, label: `${side === 'offense' ? 'Offense' : 'Defense'} jersey numbers`, get: (p) => p.onField?.[side]?.map((x) => x.number).join(';') },
    ]),
    { key: 'participationSource', label: 'Participation source', get: (p) => p.participation?.source || (p.onField ? 'nflverse' : '') },
    { key: 'participationStatus', label: 'Participation status', get: (p) => p.participation?.status || (p.onField ? 'historical' : '') },
    { key: 'sourceGameId', label: 'Participation source game ID', get: (p) => p.participation?.sourceGameId },
    { key: 'sourcePlayId', label: 'Participation source play ID', get: (p) => p.participation?.sourcePlayId },
    { key: 'capturedAt', label: 'Participation captured at', get: (p) => p.participation?.capturedAt },
    { key: 'offenseParticipationSource', label: 'Offense participation source', get: (p) => p.participation?.offenseSource || (p.onField?.offense?.length ? 'nflverse' : '') },
    { key: 'defenseParticipationSource', label: 'Defense participation source', get: (p) => p.participation?.defenseSource || (p.onField?.defense?.length ? 'nflverse' : '') },
    { key: 'inferredOffense', label: 'Inferred offensive personnel', get: (p) =>
      p.inferredPersonnel?.offense ? advanced.formatOffensePackage(p.inferredPersonnel.offense, p) : '' },
    { key: 'inferredDefense', label: 'Inferred defensive package', get: (p) => inferredPackageLabel(p) },
    { key: 'personnelInferred', label: 'Personnel inferred from positions', get: (p) => personnelInferred(p) },
  ];
  const DEFAULT_OPTIONS = { format: 'csv', includeAdvanced: false, fields: ADVANCED_FIELDS.map((f) => f.key) };

  function mergeOptions(saved) {
    const s = saved || {};
    return {
      format: FORMATS.includes(s.format) ? s.format : DEFAULT_OPTIONS.format,
      includeAdvanced: typeof s.includeAdvanced === 'boolean' ? s.includeAdvanced : DEFAULT_OPTIONS.includeAdvanced,
      fields: Array.isArray(s.fields)
        ? ADVANCED_FIELDS.filter((f) => s.fields.includes(f.key)).map((f) => f.key)
        : DEFAULT_OPTIONS.fields.slice(),
    };
  }

  function validateReport(report, clipCount) {
    if (!report || !FORMATS.includes(report.format) || typeof report.includeAdvanced !== 'boolean' ||
        !Array.isArray(report.fields) || report.fields.some((key) => !ADVANCED_FIELDS.some((f) => f.key === key))) {
      throw new Error('Invalid play breakdown options.');
    }
    validateHeadshots(report.headshots);
    if (report.packages !== undefined) analysis.validatePackages(report.packages);
    if (report.format === 'none') return;
    if (!Array.isArray(report.plays) || report.plays.length !== clipCount ||
        report.plays.some((p) => !p || typeof p.desc !== 'string' || typeof p.posteam !== 'string' ||
          typeof p.playType !== 'string' || !p.flags || !p.names) ||
        typeof report.matchup !== 'string' || typeof report.team !== 'string') {
      throw new Error('The play breakdown must describe every exported play in video order.');
    }
  }

  function validateHeadshots(headshots) {
    if (headshots === undefined) return;
    if (!headshots || typeof headshots !== 'object' || Array.isArray(headshots) ||
        Object.entries(headshots).some(([id, image]) => !/^[a-zA-Z0-9-]{1,32}$/.test(id) ||
          typeof image !== 'string' || image.length > 8 * 1024 * 1024 ||
          !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(image))) {
      throw new Error('Invalid play breakdown headshot image.');
    }
  }

  function display(value) {
    if (value == null || value === '') return '';
    return typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
  }

  function packageLabel(play, packages = analysis.DEFAULT_PACKAGES) {
    if (!advanced.isScrimmage(play)) return advanced.formatDefensePackage(play.personnel?.defense, play.personnel?.front);
    const label = analysis.defensivePackage(play, packages);
    return label === 'Unknown' ? '' : label;
  }

  function inferredPackageLabel(play, packages = analysis.DEFAULT_PACKAGES) {
    if (advanced.isScrimmage(play) && analysis.composition(play)) {
      const label = packageLabel(play, packages);
      if (label.endsWith('*')) return label;
    }
    return advanced.formatDefensePackage(play.inferredPersonnel?.defense, play.inferredPersonnel?.front);
  }

  function personnelInferred(play, packages = analysis.DEFAULT_PACKAGES) {
    return inferredPackageLabel(play, packages).endsWith('*') ? true : play.personnel ? !!play.personnel.inferred : null;
  }

  function advancedFields(report) {
    if (report.packages !== undefined) analysis.validatePackages(report.packages);
    return report.includeAdvanced ? ADVANCED_FIELDS.filter((f) => report.fields.includes(f.key)).map(f => {
      if (f.key === 'defense') return { ...f, get: p => packageLabel(p, report.packages) };
      if (f.key === 'inferredDefense') return { ...f, get: p => inferredPackageLabel(p, report.packages) };
      if (f.key === 'personnelInferred') return { ...f, get: p => personnelInferred(p, report.packages) };
      return f;
    }) : [];
  }

  function columns(report) {
    return [
      { key: 'order', label: 'Clip number', get: (_p, i) => i + 1 },
      { key: 'game', label: 'Game', get: () => report.matchup },
      { key: 'gameId', label: 'nflverse game ID', get: (p) => p.gameId },
      { key: 'playId', label: 'Game play ID', get: (p) => p.playId },
      { key: 'quarter', label: 'Quarter', get: (p) => p.qtr },
      { key: 'clock', label: 'Game clock', get: (p) => p.time },
      { key: 'offense', label: 'Offense', get: (p) => p.posteam },
      { key: 'defteam', label: 'Defense', get: (p) => p.defteam },
      { key: 'type', label: 'Play type', get: (p) => p.playType },
      { key: 'down', label: 'Down', get: (p) => p.down },
      { key: 'distance', label: 'Yards to go', get: (p) => p.ydstogo },
      { key: 'field', label: 'Field position', get: (p) => p.yrdln },
      { key: 'yards', label: 'Yards gained', get: (p) => p.yards },
      { key: 'result', label: 'Result', get: (p) => P.overlaySummary(p) },
      { key: 'description', label: 'Description', get: (p) => p.desc },
      ...advancedFields(report),
    ];
  }

  function csvCell(value) {
    if (value == null) return '';
    let text = display(value);
    if (typeof value === 'string' && /^\s*[=+\-@]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function csv(report) {
    const fields = columns(report);
    return '\ufeff' + [
      fields.map((f) => csvCell(f.label)).join(','),
      ...report.plays.map((p, i) => fields.map((f) => csvCell(f.get(p, i))).join(',')),
    ].join('\r\n') + '\r\n';
  }

  function analysisCsv(report, layout = 'plays') {
    if (!['plays', 'players'].includes(layout)) throw new Error('Invalid analysis CSV layout.');
    const all = { ...report, includeAdvanced: true, fields: ADVANCED_FIELDS.map((f) => f.key) };
    if (layout === 'plays') {
      return csv(all).replace('"Clip number"', '"Play number"');
    }
    const fields = columns(all).map((f) => f.key === 'order' ? { ...f, label: 'Play number' } : f);
    const playerFields = [
      ['side', 'Player side'], ['team', 'Player team'], ['id', 'GSIS player ID'], ['sourceId', 'Source player ID'],
      ['name', 'Player name'], ['position', 'Player position'], ['number', 'Jersey number'],
      ['inferredPosition', 'Inferred player position'], ['positionSource', 'Position inference source'],
      ['positionAsOf', 'Position inference as of'], ['reportedEligible', 'Reported eligible'],
    ];
    const lines = [fields.map((f) => csvCell(f.label)).concat(playerFields.map(([, label]) => csvCell(label))).join(',')];
    report.plays.forEach((p, i) => {
      const players = ['offense', 'defense'].flatMap((side) => (p.onField?.[side] || [])
        .map((x) => ({ ...x, side, team: side === 'offense' ? p.posteam : p.defteam,
          inferredPosition: x.positionInference?.position, positionSource: x.positionInference?.source,
          positionAsOf: x.positionInference?.asOf, reportedEligible: x.eligibleReceiver ? true : '' })));
      // Keep a blank-player row so plays without participation remain analyzable.
      for (const player of players.length ? players : [{}]) {
        lines.push(fields.map((f) => csvCell(f.get(p, i))).concat(playerFields.map(([key]) => csvCell(player[key]))).join(','));
      }
    });
    return '\ufeff' + lines.join('\r\n') + '\r\n';
  }

  function text(report) {
    const fields = columns(report);
    return `AMP22 PLAY BREAKDOWN\n${report.matchup}\n${report.plays.length} plays in video order\n\n` +
      report.plays.map((p, i) => fields.map((f) => `${f.label}: ${display(f.get(p, i)) || 'Not available'}`).join('\n')).join('\n\n') + '\n';
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function html(report) {
    validateHeadshots(report.headshots);
    const plays = report.plays;
    const [primary, accent] = teams.COLORS[report.team] || ['#241773', '#9e7c0c'];
    const fields = advancedFields(report);
    const counts = ['run', 'pass', 'special'].map((cat) => plays.filter((p) => P.category(p) === cat).length);
    const cards = plays.map((p, i) => {
      const player = P.primaryPlayer(p);
      const image = player?.id && report.headshots && Object.hasOwn(report.headshots, player.id) ? report.headshots[player.id] : null;
      const headshot = image ? `<img class="headshot" src="${image}" alt="${esc(`Headshot of ${player.name || player.id}`)}" width="72" height="72">` : '';
      const color = (teams.COLORS[p.posteam] || [primary])[0];
      const badges = [...new Set([...(p.key || []), ...(p.neg || [])])];
      const statistics = fields.length ? `<dl class="statistics">${fields.map((f) =>
        `<div><dt>${esc(f.label)}</dt><dd>${esc(display(f.get(p))) || '<span class="missing">Not available</span>'}</dd></div>`).join('')}</dl>` : '';
      return `<article style="border-left-color:${color}">
        <div class="play-heading"><span class="number">${String(i + 1).padStart(2, '0')}</span>
          <div><h2>${esc(P.clockLabel(p))}</h2><p>${esc(p.posteam)} offense <span>/</span> ${esc(p.defteam)} defense</p></div>
          <div class="situation"><strong>${esc(P.downDistance(p)) || esc(p.playType.replace(/_/g, ' '))}</strong><span>${esc(p.yrdln)}</span></div>${headshot}</div>
        <h3>${esc(P.overlaySummary(p))}</h3>
        ${badges.length ? `<div class="badges">${badges.map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}
        <p class="description">${esc(p.desc)}</p>${statistics}
        <div class="play-id">GAME PLAY ${esc(p.playId)} <span>${esc(p.playType.replace(/_/g, ' ').toUpperCase())}</span></div>
      </article>`;
    }).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
      <title>AMP22 play breakdown</title><style>
      * { box-sizing: border-box; } body { margin: 0; color: #17212b; font: 11px/1.5 Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .hero { background: ${primary}; color: white; border-bottom: 7px solid ${accent}; padding: 28px 30px 24px; }
      .eyebrow { font-size: 10px; letter-spacing: 3px; font-weight: bold; opacity: .8; }
      h1 { margin: 8px 0 3px; font-size: 29px; line-height: 1.15; } .hero p { margin: 6px 0 0; }
      .summary { display: flex; padding: 18px 0; margin-bottom: 14px; border-bottom: 1px solid #dfe4ea; }
      .summary div { flex: 1; text-align: center; border-right: 1px solid #dfe4ea; } .summary div:last-child { border: 0; }
      .summary strong { display: block; color: ${primary}; font-size: 24px; } .summary span { color: #526170; font-size: 9px; letter-spacing: 1px; }
      article { break-inside: avoid; border: 1px solid #dfe4ea; border-left: 5px solid; border-radius: 6px; margin: 0 0 16px; padding: 18px 20px 10px; }
      .play-heading { display: flex; gap: 14px; align-items: center; } .number { font-size: 27px; font-weight: bold; color: ${primary}; min-width: 40px; }
      h2 { margin: 0; font-size: 16px; } .play-heading p { margin: 1px 0 0; color: #526170; } .play-heading p span { padding: 0 5px; color: #a0a9b3; }
      .situation { margin-left: auto; text-align: right; } .situation strong, .situation span { display: block; } .situation span { color: #526170; }
      .headshot { width: 72px; height: 72px; object-fit: contain; object-position: center bottom; flex: none; }
      h3 { font-size: 16px; line-height: 1.4; margin: 14px 0 5px; } .description { margin: 7px 0 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .badges { display: flex; gap: 5px; } .badges span { background: #edf0f5; color: ${primary}; font-size: 9px; font-weight: bold; padding: 2px 6px; border-radius: 3px; }
      .statistics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px 14px; background: #f3f5f8; padding: 12px; margin: 10px 0; }
      .statistics div { break-inside: avoid; } dt { font-size: 9px; color: #526170; } dd { margin: 1px 0 0; font-weight: bold; } .missing { color: #6b7785; font-weight: normal; }
      .play-id { border-top: 1px solid #e6eaf0; padding-top: 8px; color: #6b7785; font-size: 8px; letter-spacing: .7px; } .play-id span { float: right; }
      .note { color: #526170; font-size: 9px; margin: 0 0 16px; }
      </style></head><body><header class="hero"><div class="eyebrow">AMP22 / FILM STUDY</div>
      <h1>${esc(teams.teamName(report.team))}</h1><p>${esc(report.matchup)}</p></header>
      <div class="summary">${[plays.length, ...counts].map((n, i) => `<div><strong>${n}</strong><span>${['EXPORTED PLAYS', 'RUNS', 'PASSES', 'SPECIAL TEAMS'][i]}</span></div>`).join('')}</div>
      <p class="note">Plays are listed in exported video order. Player headshots are included when available.${fields.length ? ' Unavailable advanced statistics are marked, never filled with zero.' : ''}</p>
      ${cards}</body></html>`;
  }

  return { FORMATS, ADVANCED_FIELDS, DEFAULT_OPTIONS, mergeOptions, validateReport, columns, csv, analysisCsv, text, html };
});
