(function (root, factory) {
  const mod = factory(typeof module === 'object' && module.exports ? require('./advanced') : root.A22.advanced);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.A22 = root.A22 || {}).analysis = mod;
})(typeof self !== 'undefined' ? self : this, function (advanced) {
  'use strict';

  const UNKNOWN = 'Unknown';
  const EXCLUSIONS = 'Scored snaps: runs and passes including sacks and scrambles; excludes no-plays, kneels, spikes, special teams and two-point attempts.';
  const DEFINITIONS = 'YPP uses snaps with known yards. EPA and success use snaps with known EPA; success = offensive EPA > 0. Explosives = runs 10+ or passes 20+ yards. Conversions = first down or TD on 3rd/4th down. Sack losses count in passing yards.';
  const GROUPS = {
    defense: 'Defensive package', offense: 'Offensive personnel', matchup: 'Personnel matchup',
    half: 'Half', rushers: 'Pass rushers', lineup: 'Defensive lineup',
  };
  const SPLITS = { none: 'No split', type: 'Run / pass', half: 'Half', offense: 'Offensive personnel', motion: 'Motion', playAction: 'Play action' };
  const METRICS = {
    ypp: { label: 'Yards per play', digits: 2 },
    epa: { label: 'Offensive EPA / play', digits: 2 },
    success: { label: 'Offensive success rate', percent: true },
    explosive: { label: 'Explosive rate', percent: true },
    conversion: { label: '3rd/4th conversion rate', percent: true },
  };
  const DEFAULT_PACKAGES = [
    { name: 'Big nickel', counts: { DL: 2, OLB: 2, ILB: 2, CB: 2, S: 3 } },
    { name: 'Standard nickel', counts: { DL: 2, OLB: 2, ILB: 2, CB: 3, S: 2 } },
    { name: 'Standard dime', counts: { DL: 2, OLB: 2, ILB: 1, CB: 3, S: 3 } },
    { name: 'Rush dime', counts: { DL: 1, OLB: 3, ILB: 1, CB: 3, S: 3 } },
  ];
  const POSITIONS = ['DL', 'OLB', 'ILB', 'LB', 'CB', 'S', 'DB'];
  const POSITION_GROUPS = {
    DL: 'DL', DE: 'DL', DT: 'DL', NT: 'DL', LDE: 'DL', RDE: 'DL', LDT: 'DL', RDT: 'DL',
    OLB: 'OLB', LOLB: 'OLB', ROLB: 'OLB', ILB: 'ILB', MLB: 'ILB', LB: 'LB',
    CB: 'CB', S: 'S', FS: 'S', SS: 'S', SAF: 'S', DB: 'DB',
  };
  const known = (v) => typeof v === 'number' && Number.isFinite(v);
  const keyOf = (p) => p.id || (p.sourceId ? `nflpro:${p.sourceId}` : '');
  const playKey = (p) => JSON.stringify([p.gameId, p.playId]);
  const average = (sum, n) => n ? sum / n : null;

  function scoredSnap(p) {
    const f = p.flags || {};
    return ['run', 'pass'].includes(p.playType) && !f.qb_kneel && !f.qb_spike &&
      !f.special_teams_play && !f.two_point_attempt;
  }

  function validatePackages(packages) {
    if (!Array.isArray(packages) || packages.length > 30) throw new Error('Use at most 30 package definitions.');
    const names = new Set();
    const patterns = new Set();
    for (const rule of packages) {
      if (!rule || typeof rule.name !== 'string' || !rule.name.trim() || rule.name.length > 60 || !rule.counts ||
          Object.keys(rule.counts).some((k) => !POSITIONS.includes(k)) ||
          Object.values(rule.counts).some((n) => !Number.isInteger(n) || n < 0 || n > 11) ||
          Object.values(rule.counts).reduce((a, b) => a + b, 0) !== 11) {
        throw new Error('Package definitions need a name and position counts totaling 11.');
      }
      const name = rule.name.trim().toLowerCase();
      const pattern = JSON.stringify(POSITIONS.map((k) => rule.counts[k] || 0));
      if (names.has(name) || patterns.has(pattern)) throw new Error('Package names and compositions must be unique.');
      names.add(name);
      patterns.add(pattern);
    }
    return packages;
  }

  function composition(p) {
    const players = p.onField?.defense;
    if (!players || players.length !== 11 || players.some((x) => !keyOf(x) || !POSITION_GROUPS[x.position]) ||
        new Set(players.map(keyOf)).size !== 11) return null;
    const counts = {};
    for (const player of players) {
      const position = POSITION_GROUPS[player.position];
      counts[position] = (counts[position] || 0) + 1;
    }
    return counts;
  }

  function defensivePackage(p, packages) {
    const counts = composition(p);
    if (counts) {
      const rule = packages.find((r) => POSITIONS.every((k) => (r.counts[k] || 0) === (counts[k] || 0)));
      if (rule) return `${rule.name}*`;
      const named = advanced.compositionPackage(counts);
      if (named) return `${named}*`;
    }
    const supplied = p.personnel?.defense;
    return supplied ? `${advanced.formatDefensePackage(supplied, p.personnel?.front)}${p.personnel.defenseInferred ? '*' : ''}` : UNKNOWN;
  }

  function half(p) {
    return p.qtr >= 1 && p.qtr <= 2 ? 'First half' : p.qtr >= 3 && p.qtr <= 4 ? 'Second half' : p.qtr >= 5 ? 'Overtime' : UNKNOWN;
  }

  function groupValue(p, dimension, packages) {
    switch (dimension) {
      case 'defense': return defensivePackage(p, packages);
      case 'offense': return p.personnel?.offense ? `${p.personnel.offense}${p.personnel.offenseInferred ? '*' : ''}` : UNKNOWN;
      case 'matchup': return `${groupValue(p, 'offense', packages)} vs ${defensivePackage(p, packages)}`;
      case 'half': return half(p);
      case 'rushers': return known(p.charting?.rushers) ? `${p.charting.rushers} rushers` : UNKNOWN;
      case 'type': return p.playType === 'pass' ? 'Pass (incl. sacks)' : 'Run (incl. scrambles)';
      case 'motion': case 'playAction': {
        const v = p.charting?.[dimension];
        const label = dimension === 'motion' ? 'Motion' : 'Play action';
        return v === true ? `${label}: Yes` : v === false ? `${label}: No` : UNKNOWN;
      }
      case 'lineup': {
        const players = p.onField?.defense;
        if (!players || players.length !== 11 || players.some((x) => !keyOf(x)) || new Set(players.map(keyOf)).size !== 11) return UNKNOWN;
        return players.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
          .map((x) => `${x.name || keyOf(x)} [${keyOf(x)}]`).join(', ');
      }
      default: return 'All';
    }
  }

  function summarize(plays, options = {}) {
    const { team, side = 'defense', group = 'defense', split = 'type', packages = DEFAULT_PACKAGES } = options;
    if (!['offense', 'defense'].includes(side) || !GROUPS[group] || !SPLITS[split]) throw new Error('Invalid analysis dimensions.');
    validatePackages(packages);
    const seen = new Set();
    const eligible = plays.filter((p) => {
      if (!scoredSnap(p) || (team && (side === 'defense' ? p.defteam : p.posteam) !== team)) return false;
      const key = playKey(p);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const buckets = new Map();
    const groups = new Map();
    for (const p of eligible) {
      const label = groupValue(p, group, packages);
      const series = groupValue(p, split, packages);
      const identity = group === 'lineup' && label !== UNKNOWN ? p.onField.defense.map(keyOf).sort().join(';') : label;
      const id = JSON.stringify([identity, series]);
      if (!groups.has(identity)) groups.set(identity, { label, n: 0 });
      groups.get(identity).n++;
      if (!buckets.has(id)) buckets.set(id, { id, groupKey: identity, label, series, plays: [] });
      buckets.get(id).plays.push(p);
    }
    const seriesOrder = split === 'type' ? ['Run (incl. scrambles)', 'Pass (incl. sacks)'] :
      split === 'half' ? ['First half', 'Second half', 'Overtime', UNKNOWN] : [];
    const seriesRank = (series) => {
      const rank = seriesOrder.indexOf(series);
      return rank < 0 ? seriesOrder.length : rank;
    };
    const rows = [...buckets.values()].sort((a, b) => {
      const first = groups.get(a.groupKey);
      const second = groups.get(b.groupKey);
      return second.n - first.n || first.label.localeCompare(second.label) || a.groupKey.localeCompare(b.groupKey) ||
        seriesRank(a.series) - seriesRank(b.series) || a.series.localeCompare(b.series, undefined, { numeric: true });
    }).map(({ groupKey, ...bucket }) => {
      const list = bucket.plays;
      const yards = list.filter((p) => known(p.yards));
      const epas = list.filter((p) => known(p.epa));
      const late = list.filter((p) => [3, 4].includes(p.down) && known(p.ydstogo) && known(p.yards));
      const totalYards = yards.reduce((n, p) => n + p.yards, 0);
      const totalEpa = epas.reduce((n, p) => n + p.epa, 0);
      return {
        ...bucket, n: list.length, share: average(list.length, eligible.length),
        totalYards: yards.length ? totalYards : null, yardsN: yards.length, epaN: epas.length, conversionN: late.length,
        ypp: average(totalYards, yards.length), epa: average(totalEpa, epas.length),
        success: average(epas.filter((p) => p.epa > 0).length, epas.length),
        explosive: average(yards.filter((p) => p.yards >= (p.playType === 'run' ? 10 : 20)).length, yards.length),
        conversion: average(late.filter((p) => p.flags?.first_down || p.flags?.touchdown || p.yards >= p.ydstogo).length, late.length),
      };
    });
    const sources = {};
    for (const p of eligible) {
      const source = p.participation?.defenseSource || p.participation?.source || (p.onField?.defense?.length ? 'nflverse' : 'Unknown participation');
      sources[source] = (sources[source] || 0) + 1;
    }
    return {
      rows, plays: eligible, n: eligible.length, sources,
      knownOffense: eligible.filter((p) => !!p.personnel?.offense).length,
      knownDefense: eligible.filter((p) => defensivePackage(p, packages) !== UNKNOWN).length,
      completeDefense: eligible.filter((p) => composition(p) !== null).length,
      knownEpa: eligible.filter((p) => known(p.epa)).length,
      knownYards: eligible.filter((p) => known(p.yards)).length,
    };
  }

  function format(value, metric) {
    if (!known(value)) return 'N/A';
    const spec = METRICS[metric];
    return spec.percent ? `${(value * 100).toFixed(1)}%` : value.toFixed(spec.digits);
  }

  const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const short = (s, n) => s.length > n ? `${s.slice(0, n - 3)}...` : s;
  function csvCell(value) {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^\s*[=+@-]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function validateReport(report) {
    if (!report || !Array.isArray(report.rows) || report.rows.length > 5000 ||
        !METRICS[report.metric] || !['bars', 'heatmap', 'halves'].includes(report.chart) ||
        ['title', 'subtitle', 'notes'].some((k) => typeof report[k] !== 'string' || report[k].length > 16000) ||
        report.rows.some((r) => !r || ['id', 'label', 'series'].some((k) => typeof r[k] !== 'string' || r[k].length > 4000) ||
          !Number.isSafeInteger(r.n) || r.n < 1 ||
          ['share', 'totalYards', 'yardsN', 'epaN', 'conversionN', ...Object.keys(METRICS)].some((k) => r[k] !== null && !known(r[k])))) {
      throw new Error('Invalid Analysis Lab report.');
    }
    if (report.selection && (!['include', 'exclude'].includes(report.selection.mode) ||
        !Array.isArray(report.selection.playIds) || report.selection.playIds.length > 20000 ||
        report.selection.playIds.some(id => typeof id !== 'string' || !id || id.length > 100))) {
      throw new Error('Invalid Analysis Lab play selection.');
    }
    return report;
  }

  function csv(report) {
    validateReport(report);
    const columns = ['label', 'series', 'n', 'share', 'totalYards', 'yardsN', 'ypp', 'epaN', 'epa', 'success', 'explosive', 'conversionN', 'conversion'];
    const header = ['Group', 'Split', 'Snaps', 'Share of cohort', 'Yards', 'Yards sample', 'YPP', 'EPA sample', 'Offensive EPA/play', 'Offensive success rate', 'Explosive rate', '3rd/4th sample', '3rd/4th conversion rate'];
    return '\ufeff' + [
      ['AMP22 Analysis Lab', report.title], ['Scope', report.subtitle],
      ['Definitions and sources', `${report.notes} ${EXCLUSIONS} ${DEFINITIONS} Rates are fractions (0-1). * = listed-position estimate, not alignment.`],
      header, ...report.rows.map((r) => columns.map((k) => r[k])),
      ...(report.selection ? [
        ['Play selection mode', report.selection.mode],
        ...report.selection.playIds.map(id => ['Selected game/play ID', id]),
      ] : []),
    ].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function svg(report) {
    validateReport(report);
    const { rows, metric } = report;
    const heatmap = report.chart === 'heatmap';
    const labels = [...new Set(rows.map((r) => r.label))];
    const series = [...new Set(rows.map((r) => r.series))];
    const width = heatmap ? Math.max(1000, 330 + series.length * 150) : 1200;
    const lineHeight = heatmap ? 64 : 48;
    const plotHeight = Math.max(100, (heatmap ? labels.length : rows.length) * lineHeight);
    const words = `${report.notes} ${EXCLUSIONS} ${DEFINITIONS} * = composition/listed-position estimate, not alignment. n < 10 = small sample; descriptive, not causal.`;
    const footer = words.match(/[\s\S]{1,140}/g) || [words];
    const height = 190 + plotHeight + footer.length * 20 + 30;
    const values = rows.map((r) => r[metric]).filter(known);
    const min = Math.min(0, ...values);
    const max = Math.max(1, ...values);
    const sample = (r) => metric === 'epa' || metric === 'success' ? r.epaN : metric === 'conversion' ? r.conversionN : r.yardsN;
    const color = (r) => r.series.includes('Run') ? '#56d364' : r.series === 'Second half' ? '#d2a8ff' : '#79c0ff';
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">`,
      `<title id="title">${xml(report.title)}</title><desc id="description">${xml(report.subtitle)}. ${xml(words)}</desc>`,
      `<rect width="${width}" height="${height}" fill="#0d1117"/>`,
      '<g font-family="Arial, sans-serif" fill="#e6edf3">',
      `<text x="32" y="34" fill="#d2a8ff" font-size="13" font-weight="bold">AMP22 / ANALYSIS LAB</text>`,
      `<text x="32" y="70" font-size="26" font-weight="bold">${xml(short(report.title, 85))}</text>`,
      `<text x="32" y="97" font-size="14" fill="#aeb8c4">${xml(short(report.subtitle, 145))}</text>`,
      `<text x="32" y="125" font-size="14">${xml(METRICS[metric].label)} | ${report.rows.reduce((n, r) => n + r.n, 0)} snaps | lower is better for defense</text>`,
    ];
    if (heatmap) {
      series.forEach((s, j) => parts.push(`<text x="${345 + j * 150}" y="161" font-size="12">${xml(short(s, 20))}</text>`));
      labels.forEach((label, i) => {
        const y = 177 + i * lineHeight;
        parts.push(`<text x="32" y="${y + 27}" font-size="13">${xml(short(label, 37))}</text>`);
        series.forEach((s, j) => {
          const r = rows.find((row) => row.label === label && row.series === s);
          const x = 330 + j * 150;
          const v = r?.[metric];
          const opacity = known(v) ? .15 + .7 * (v - min) / (max - min) : .06;
          if (r) parts.push(`<g data-bucket="${xml(r.id)}" role="button" tabindex="0" aria-label="${xml(`Inspect ${r.label}, ${r.series}: ${r.n} plays`)}">`);
          parts.push(`<rect x="${x}" y="${y}" width="140" height="55" rx="6" fill="#a371f7" fill-opacity="${opacity.toFixed(3)}"/>`);
          parts.push(`<text x="${x + 12}" y="${y + 23}" font-size="17">${xml(format(v, metric))}</text>`);
          parts.push(`<text x="${x + 12}" y="${y + 43}" font-size="11">${r ? `n=${r.n}${r.n < 10 ? ' (small)' : ''}; metric n=${sample(r)}` : 'No snaps'}</text>`);
          if (r) parts.push('</g>');
        });
      });
    } else {
      const left = 400, right = 960;
      const scale = (v) => left + (v - min) / (max - min) * (right - left);
      const zero = scale(0);
      parts.push(`<line x1="${zero}" y1="157" x2="${zero}" y2="${177 + plotHeight}" stroke="#8b949e"/>`);
      rows.forEach((r, i) => {
        const y = 177 + i * lineHeight;
        const v = r[metric];
        parts.push(`<g data-bucket="${xml(r.id)}" role="button" tabindex="0" aria-label="${xml(`Inspect ${r.label}, ${r.series}: ${r.n} plays`)}">`);
        parts.push(`<text x="32" y="${y + 12}" font-size="13"><title>${xml(r.label)}</title>${xml(short(r.label, 45))}</text>`);
        parts.push(`<text x="32" y="${y + 29}" font-size="11" fill="#aeb8c4">${xml(short(r.series, 45))}</text>`);
        if (known(v)) parts.push(`<rect x="${Math.min(zero, scale(v))}" y="${y}" width="${Math.max(1, Math.abs(scale(v) - zero))}" height="27" rx="3" fill="${color(r)}"/>`);
        parts.push(`<text x="980" y="${y + 14}" font-size="16">${xml(format(v, metric))}</text>`);
        parts.push(`<text x="980" y="${y + 31}" font-size="11" fill="#aeb8c4">n=${r.n}${r.n < 10 ? ' (small)' : ''}; metric n=${sample(r)}</text>`);
        parts.push('</g>');
      });
    }
    footer.forEach((line, i) => parts.push(`<text x="32" y="${195 + plotHeight + i * 20}" font-size="12" fill="#aeb8c4">${xml(line.trim())}</text>`));
    parts.push('</g></svg>');
    return parts.join('');
  }

  return { UNKNOWN, EXCLUSIONS, DEFINITIONS, GROUPS, SPLITS, METRICS, DEFAULT_PACKAGES, POSITIONS,
    scoredSnap, composition, defensivePackage, validatePackages, summarize, format, svg, csv, validateReport, playKey };
});
