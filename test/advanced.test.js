'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const advanced = require('../src/shared/advanced');
const plays = require('../src/shared/plays');

test('offensive personnel codes count RBs then TEs in both participation formats', () => {
  assert.equal(advanced.offenseCode('1 RB, 1 TE, 3 WR'), '11');
  assert.equal(advanced.offenseCode('1 C, 2 G, 1 QB, 1 RB, 2 T, 2 TE, 2 WR'), '12');
  assert.equal(advanced.offenseCode('6 OL, 2 RB, 2 TE, 0 WR'), '22');
  assert.equal(advanced.offenseCode('1 C, 2 G, 1 QB, 2 T, 5 WR'), '00');
  assert.equal(advanced.offenseCode('1 FB, 1 RB, 1 TE, 2 WR'), '21');
  assert.equal(advanced.offenseCode('2 DE, 1 FS, 2 MLB, 2 RB, 2 TE, 2 WR, 1 K'), '');
  assert.equal(advanced.offenseCode(''), '');
});

test('defensive packages use fronts for base personnel and DB counts for sub-packages', () => {
  assert.deepEqual(advanced.defensePackage('4 DL, 3 LB, 4 DB'), { label: '4-3', front: '4-3-4' });
  assert.deepEqual(advanced.defensePackage('3 DL, 4 LB, 4 DB'), { label: '3-4', front: '3-4-4' });
  assert.deepEqual(advanced.defensePackage('4 DL, 2 LB, 5 DB'), { label: 'Nickel', front: '4-2-5' });
  assert.deepEqual(advanced.defensePackage('3 CB, 2 DE, 2 DT, 1 FS, 1 MLB, 1 OLB, 1 SS'), { label: 'Nickel', front: '4-2-5' });
  assert.deepEqual(advanced.defensePackage('3 CB, 1 DE, 1 FS, 2 ILB, 1 NT, 2 OLB, 1 SS'), { label: 'Nickel', front: '2-4-5' });
  assert.deepEqual(advanced.defensePackage('4 CB, 2 DE, 1 DT, 1 MLB, 2 FS'), { label: 'Dime', front: '3-1-6' });
  assert.deepEqual(advanced.defensePackage('5 CB, 3 DL, 2 S, 1 LB'), { label: 'Quarter', front: '3-1-7' });
  assert.deepEqual(advanced.defensePackage('5 DL, 3 LB, 3 DB'), { label: 'Goal line', front: '5-3-3' });
  assert.equal(advanced.defensePackage('1 CB, 2 FS, 4 ILB, 1 K, 1 OLB, 2 SS'), null);
  assert.equal(advanced.defensePackage(''), null);
});

test('attach ignores special teams and keeps 2023+ on-field names, positions, and numbers', () => {
  const play = plays.normalizePlay({ play_id: '5', play_type: 'run', rush: '1', desc: 'run' });
  advanced.attach(play, {
    offense_personnel: '1 C, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 3 WR', defense_personnel: '2 CB, 2 DE, 2 DT, 1 FS, 2 MLB, 1 OLB, 1 SS',
    offense_formation: 'UNDER CENTER', offense_players: '00-1;00-2', offense_names: 'Lamar Jackson;Derrick Henry',
    offense_positions: 'QB;RB', offense_numbers: '8;22', defense_players: '', number_of_pass_rushers: '4',
  }, { qb_location: 'U', n_offense_backfield: '1', n_defense_box: '7', is_motion: 'TRUE', n_pass_rushers: '0' });
  assert.equal(play.personnel.defense, '4-3');
  assert.deepEqual(play.charting, { qbLocation: 'Under center', backfield: 1, box: 7, motion: true });
  assert.deepEqual(play.onField.offense[1], { id: '00-2', name: 'Derrick Henry', position: 'RB', number: '22' });
  assert.deepEqual(advanced.tags(play), ['11 personnel', '4-3 base', 'Under center', '1 in backfield', 'Motion', '7 in box']);

  const kick = plays.normalizePlay({ play_id: '6', play_type: 'kickoff', desc: 'kick' });
  advanced.attach(kick, { offense_personnel: '1 K' }, { is_motion: 'FALSE' });
  assert.equal(kick.personnel, undefined);
  assert.equal(kick.charting, undefined);
});
