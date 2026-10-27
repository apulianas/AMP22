'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/shared/schedule');

const games = s.parseGames([
  { game_id: '2025_22_X_Y', season: '2025', game_type: 'SB', week: '22', gameday: '2026-02-08', away_team: 'X', home_team: 'Y', away_score: '20', home_score: '17' },
  { game_id: '2026_01_BAL_IND', season: '2026', game_type: 'REG', week: '1', gameday: '2026-09-13', away_team: 'BAL', home_team: 'IND', away_score: '41', home_score: '23' },
  { game_id: '2026_02_NO_BAL', season: '2026', game_type: 'REG', week: '2', gameday: '2026-09-20', away_team: 'NO', home_team: 'BAL', away_score: '10', home_score: '24' },
  { game_id: '2026_03_BAL_DAL', season: '2026', game_type: 'REG', week: '3', gameday: '2026-09-27', away_team: 'BAL', home_team: 'DAL', away_score: 'NA', home_score: 'NA' },
  { game_id: '2027_01_BAL_KC', season: '2027', game_type: 'REG', week: '1', gameday: '2027-09-12', away_team: 'BAL', home_team: 'KC', away_score: '', home_score: '' },
]);

test('default = current season, team, most recent completed week', () => {
  assert.deepEqual(s.defaultSelection(games, { team: 'BAL', today: new Date(2026, 8, 24) }), { season: 2026, team: 'BAL', week: 2, gameId: '2026_02_NO_BAL' });
  // After the week 3 date passes the game counts as played even before scores arrive.
  assert.equal(s.defaultSelection(games, { team: 'BAL', today: new Date(2026, 8, 28) }).week, 3);
});

test('before a season starts the previous season is current', () => {
  assert.equal(s.defaultSelection(games, { team: 'BAL', today: new Date(2026, 5, 1) }).season, 2025);
});

test('season and team lists', () => {
  assert.deepEqual(s.seasons(games), [2027, 2026, 2025]);
  assert.deepEqual(s.teamsInSeason(games, 2026), ['BAL', 'DAL', 'IND', 'NO']);
  assert.deepEqual(s.teamGames(games, 2026, 'BAL').map((g) => g.week), [1, 2, 3]);
});
