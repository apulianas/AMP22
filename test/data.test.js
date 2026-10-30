'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { DataService, PBP_URL, PLAYERS_URL, PARTICIPATION_URL, CHARTING_URL } = require('../src/main/data');
const { PBP_COLUMNS } = require('../src/shared/plays');

test('old parsed caches rebuild air yards from downloaded play-by-play without a network request', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a22-pbp-test-'));
  const gameId = '2025_01_BAL_BUF';
  const csv = `game_id,play_id,play_type,air_yards\n${gameId},1,pass,39\n${gameId},2,pass,0\n${gameId},3,run,\n`;
  try {
    const source = path.join(dir, 'play_by_play_2025.csv.gz');
    await fs.writeFile(source, zlib.gzipSync(csv));
    // Cached advanced data so the reload needs no network either.
    await fs.writeFile(path.join(dir, 'participation_2025.csv'), 'nflverse_game_id,play_id\n');
    await fs.writeFile(path.join(dir, 'ftn_charting_2025.csv'), 'nflverse_game_id,nflverse_play_id\n');
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

test('advanced data merges participation and FTN charting by play and resolves older NGS player IDs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a22-adv-test-'));
  const gameId = '2022_01_BAL_NYJ';
  const pbp = `game_id,play_id,play_type,pass,rush,yards_gained\n${gameId},10,pass,1,0,7\n${gameId},11,run,0,1,3\n${gameId},12,kickoff,0,0,0\n`;
  const part = [
    'nflverse_game_id,play_id,offense_formation,offense_personnel,defense_personnel,defenders_in_box,number_of_pass_rushers,offense_players,defense_players,defense_man_zone_type,defense_coverage_type',
    `${gameId},10,SHOTGUN,"1 RB, 1 TE, 3 WR","4 DL, 2 LB, 5 DB",6,5,111;222,333,MAN_COVERAGE,COVER_1`,
    `${gameId},11,I_FORM,"2 RB, 1 TE, 2 WR","4 DL, 3 LB, 4 DB",8,,111,333,,`,
    `${gameId},12,,"1 K","1 K",,,,,,`,
  ].join('\n');
  const ftn = [
    'nflverse_game_id,nflverse_play_id,qb_location,n_offense_backfield,n_defense_box,is_no_huddle,is_motion,is_play_action,is_screen_pass,is_rpo,n_blitzers,n_pass_rushers',
    `${gameId},10,S,1,6,FALSE,TRUE,TRUE,FALSE,FALSE,1,5`,
    `${gameId},11,U,2,8,FALSE,FALSE,FALSE,FALSE,TRUE,0,0`,
  ].join('\n');
  const players = 'gsis_id,headshot,nfl_id,display_name,position\n00-1,,111,Lamar Jackson,QB\n00-3,,333,Maxx Crosby,DE\n';
  const urls = [];
  const service = new DataService(dir, async (url) => {
    urls.push(url);
    if (url === PBP_URL(2022)) return new Response(zlib.gzipSync(pbp));
    if (url === PARTICIPATION_URL(2022)) return new Response(part);
    if (url === CHARTING_URL(2022)) return new Response(ftn);
    if (url === PLAYERS_URL) return new Response(players);
    return new Response('', { status: 404 });
  });
  try {
    const { plays, warning } = await service.loadGamePlays(2022, gameId, { current: false });
    assert.equal(warning, undefined);
    const [pass, run, kick] = plays;
    assert.deepEqual(pass.personnel, { offense: '11', offenseDetail: '1 RB, 1 TE, 3 WR', defense: 'Nickel', front: '4-2-5', defenseDetail: '4 DL, 2 LB, 5 DB' });
    assert.deepEqual(pass.charting, { qbLocation: 'Shotgun', box: 6, rushers: 5, coverage: 'Cover 1', manZone: 'Man', backfield: 1, motion: true, playAction: true, rpo: false, screen: false, noHuddle: false, blitzers: 1 });
    assert.deepEqual(pass.onField.offense, [
      { id: '00-1', name: 'Lamar Jackson', position: 'QB', number: '' },
      { id: '', name: '', position: '', number: '' },
    ]);
    assert.equal(pass.onField.defense[0].name, 'Maxx Crosby');
    assert.equal(run.personnel.offense, '21');
    assert.equal(run.personnel.defense, '4-3');
    assert.equal(run.charting.formation, 'I-Form');
    assert.equal(run.charting.qbLocation, 'Under center');
    assert.equal(run.charting.rushers, undefined, 'pass rushers apply only to dropbacks');
    assert.equal(run.charting.blitzers, undefined);
    assert.equal(kick.personnel, undefined);
    assert.equal(kick.charting, undefined);

    // Missing files for a season in progress are expected and quiet, and not re-requested right away.
    const before = urls.length;
    const current = await service.loadGamePlays(2022, gameId, { current: true, force: false });
    assert.equal(current.warning, undefined);
    assert.equal(urls.length, before);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a missing advanced-data file for the current season leaves plays unchanged without a warning', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a22-adv-missing-'));
  const gameId = '2026_08_BAL_TB';
  const pbp = `game_id,play_id,play_type,pass\n${gameId},1,pass,1\n`;
  const service = new DataService(dir, async (url) => (url === PBP_URL(2026) ? new Response(zlib.gzipSync(pbp)) : new Response('', { status: 404 })));
  try {
    const { plays, warning } = await service.loadGamePlays(2026, gameId);
    assert.equal(warning, undefined);
    assert.equal(plays[0].personnel, undefined);
    assert.equal(plays[0].charting, undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
