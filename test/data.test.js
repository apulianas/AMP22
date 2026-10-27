'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { DataService } = require('../src/main/data');
const { PBP_COLUMNS } = require('../src/shared/plays');

test('old parsed caches rebuild air yards from downloaded play-by-play without a network request', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a22-pbp-test-'));
  const gameId = '2025_01_BAL_BUF';
  const csv = `game_id,play_id,play_type,air_yards\n${gameId},1,pass,39\n${gameId},2,pass,0\n${gameId},3,run,\n`;
  try {
    const source = path.join(dir, 'play_by_play_2025.csv.gz');
    await fs.writeFile(source, zlib.gzipSync(csv));
    const { mtimeMs } = await fs.stat(source);
    await fs.writeFile(path.join(dir, 'pbp_2025.json'), JSON.stringify({
      mtimeMs,
      columns: PBP_COLUMNS.filter((c) => c !== 'air_yards').join(','),
      games: { [gameId]: [] },
    }));
    const offline = () => { throw new Error('Unexpected network request'); };
    const service = new DataService(dir, offline);
    const result = await service.loadGamePlays(2025, gameId, { current: false });
    assert.deepEqual(result.plays.map((p) => p.airYards), [39, 0, null]);
    assert.equal(result.warning, undefined);
    const cached = JSON.parse(await fs.readFile(path.join(dir, 'pbp_2025.json'), 'utf8'));
    assert.equal(cached.columns, PBP_COLUMNS.join(','));
    const reloaded = await new DataService(dir, offline).loadGamePlays(2025, gameId, { current: false });
    assert.deepEqual(reloaded.plays, result.plays);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
