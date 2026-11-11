'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const advanced = require('../src/shared/advanced');
const plays = require('../src/shared/plays');

test('offensive personnel codes count RBs then TEs in both participation formats', () => {
  assert.equal(advanced.offenseCode('1 RB, 1 TE, 3 WR'), '11');
  assert.equal(advanced.offenseCode('1 C, 2 G, 1 QB, 1 RB, 2 T, 2 TE, 2 WR'), '12');
  assert.equal(advanced.offenseCode('6 OL, 2 RB, 2 TE, 0 WR'), '23 (6)');
  assert.equal(advanced.offenseCode('1 QB, 1 RB, 1 TE, 2 WR, 1 C, 2 G, 3 T'), '12 (6)');
  assert.equal(advanced.offenseCode('1 QB, 1 RB, 1 TE, 1 WR, 7 OL'), '13 (7)');
  assert.equal(advanced.offenseCode('1 QB, 1 RB, 1 WR, 8 OL'), '13 (8)');
  assert.equal(advanced.offenseCode('1 QB, 4 WR, 1 C, 1 LG, 1 RG, 1 LT, 2 RT'), '01 (6)');
  assert.equal(advanced.offenseCode('1 C, 2 G, 1 QB, 2 T, 5 WR'), '00');
  assert.equal(advanced.offenseCode('1 FB, 1 RB, 1 TE, 2 WR'), '21');
  assert.equal(advanced.offenseCode('2 DE, 1 FS, 2 MLB, 2 RB, 2 TE, 2 WR, 1 K'), '');
  assert.equal(advanced.offenseCode(''), '');
});

test('complete extra-OL lineups refine supplied packages without changing positions or QB alignment', () => {
  for (const [positions, label] of [
    [['QB', 'RB', 'TE', 'WR', 'WR', 'C', 'G', 'G', 'T', 'T', 'T'], '12 (6)'],
    [['QB', 'RB', 'TE', 'WR', 'C', 'LG', 'RG', 'LT', 'RT', 'OL', 'OT'], '13 (7)'],
  ]) {
    const part = {
      offense_personnel: '1 RB, 1 TE, 3 WR', offense_formation: 'SHOTGUN',
      offense_players: positions.map((_p, i) => `id-${i}`).join(';'),
      offense_names: positions.map((_p, i) => `Player ${i}`).join(';'),
      offense_positions: positions.join(';'),
    };
    const p = plays.normalizePlay({ play_id: '1', play_type: 'run', rush: '1' });
    advanced.attach(p, part);
    assert.equal(p.personnel.offense, label);
    assert.equal(p.inferredPersonnel.offense, label);
    assert.equal(p.personnel.offenseInferred, true);
    assert.equal(p.charting.qbLocation, 'Shotgun');
    assert.deepEqual(p.onField.offense.map(x => x.position), positions);
    assert.ok(advanced.tags(p).includes(`${label} personnel`));
    const duplicate = plays.normalizePlay({ play_id: '2', play_type: 'run', rush: '1' });
    advanced.attach(duplicate, { ...part, offense_players: positions.map(() => 'duplicate').join(';') });
    assert.equal(duplicate.personnel.offense, '11');
  }
  const p = plays.normalizePlay({ play_id: '3', play_type: 'run', rush: '1' });
  advanced.attach(p, { offense_personnel: '1 RB, 1 TE, 2 WR, 6 OL' });
  assert.equal(p.personnel.offense, '12 (6)', 'supplied counts work without individual participation');
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

test('jumbo requires a complete heavy front with distinct OLB evidence, not field position', () => {
  const fronts = [
    '2 NT, 1 CB, 1 ILB, 1 DT, 2 FS, 1 DE, 1 SS, 2 OLB',
    '2 DT, 2 NT, 2 CB, 1 ILB, 1 SS, 1 FS, 2 OLB',
    '5 DL, 2 OLB, 1 ILB, 3 DB',
  ];
  for (const defense_personnel of fronts) {
    const expected = { label: 'Jumbo', front: defense_personnel.startsWith('5 DL') ? '5-3-3' : '4-3-4' };
    assert.deepEqual(advanced.defensePackage(defense_personnel), expected);
    const p = plays.normalizePlay({ play_id: '171', play_type: 'pass', pass: '1' });
    advanced.attach(p, { defense_personnel });
    assert.equal(p.personnel.defenseInferred, true);
    assert.deepEqual(advanced.tags(p), ['Jumbo*']);
  }
  for (const [personnel, label] of [
    ['4 DL, 3 LB, 4 DB', '4-3'],
    ['4 DL, 1 OLB, 2 ILB, 4 DB', '4-3'],
    ['3 DL, 2 OLB, 2 ILB, 4 DB', '3-4'],
    ['4 DL, 2 OLB, 5 DB', 'Nickel'],
    ['4 DL, 2 OLB, 3 DB', 'Goal line'],
    ['5 DL, 3 LB, 3 DB', 'Goal line'],
  ]) assert.equal(advanced.defensePackage(personnel).label, label);
});

test('complete Jumbo participation refines supplied base packages consistently across sources', () => {
  const positions = ['NT', 'NT', 'DT', 'DE', 'OLB', 'OLB', 'ILB', 'CB', 'CB', 'FS', 'SS'];
  const part = {
    defense_personnel: '4 DL, 3 LB, 4 DB',
    defense_players: positions.map((_p, i) => `id-${i}`).join(';'),
    defense_names: positions.map((_p, i) => `Defender ${i}`).join(';'),
    defense_positions: positions.join(';'),
  };
  const p = plays.normalizePlay({ play_id: '171', play_type: 'pass', pass: '1' });
  advanced.attach(p, part);
  assert.equal(p.personnel.defense, 'Jumbo');
  assert.equal(p.personnel.defenseInferred, true);
  assert.equal(p.inferredPersonnel.defense, 'Jumbo');
  assert.deepEqual(advanced.tags(p), ['Jumbo*']);
  p.personnel = { defense: '4-3', front: '4-3-4' };
  advanced.inferPersonnel(p);
  assert.equal(p.personnel.defense, 'Jumbo', 'imports refine the same supplied base classification');
  part.defense_players = positions.map(() => 'duplicate').join(';');
  const duplicate = plays.normalizePlay({ play_id: '218', play_type: 'run', rush: '1' });
  advanced.attach(duplicate, part);
  assert.equal(duplicate.personnel.defense, '4-3', 'ambiguous lineups retain the supplied package');
});

test('32 dime requires two explicit inside linebackers, three front players and six DBs', () => {
  for (const detail of [
    '1 DT, 3 CB, 2 OLB, 2 ILB, 2 FS, 1 SS',
    '2 DL, 1 OLB, 1 ILB, 1 MLB, 6 DB',
    '3 DL, 2 MLB, 6 DB',
  ]) {
    assert.equal(advanced.defensePackage(detail).label, '32 dime');
    const p = plays.normalizePlay({ play_id: '734', play_type: 'pass', pass: '1' });
    advanced.attach(p, { defense_personnel: detail });
    assert.equal(p.personnel.defenseInferred, true);
    assert.deepEqual(advanced.tags(p), ['32 dime*']);
  }
  for (const detail of [
    '1 DL, 4 LB, 6 DB',
    '1 DL, 3 OLB, 1 ILB, 6 DB',
    '2 DL, 2 OLB, 1 ILB, 6 DB',
    '1 DL, 2 OLB, 1 ILB, 6 DB',
  ]) assert.equal(advanced.defensePackage(detail).label, 'Dime');
  assert.equal(advanced.defensePackage('1 DL, 2 OLB, 2 ILB, 5 DB').label, 'Nickel');
  const positions = ['DT', 'CB', 'CB', 'OLB', 'ILB', 'FS', 'SS', 'ILB', 'FS', 'OLB', 'CB'];
  const p = plays.normalizePlay({ play_id: '734', play_type: 'pass', pass: '1' });
  advanced.attach(p, {
    defense_personnel: '1 DL, 4 LB, 6 DB',
    defense_players: positions.map((_p, i) => `id-${i}`).join(';'),
    defense_names: positions.map((_p, i) => `Defender ${i}`).join(';'),
    defense_positions: positions.join(';'),
  });

  assert.equal(p.personnel.defense, '32 dime');
  assert.equal(p.personnel.front, '1-4-6');
  p.personnel = { defense: 'Dime', front: '1-4-6' };
  advanced.inferPersonnel(p);
  assert.equal(p.personnel.defense, '32 dime', 'complete imports refine the supplied broad Dime package');
});

test('jumbo nickel replaces one OLB with a DL in both standard and big DB combinations', () => {
  for (const db of ['3 CB, 2 S', '2 CB, 3 S', '5 DB']) {
    const detail = `3 DL, 1 OLB, 1 ILB, 1 MLB, ${db}`;
    assert.deepEqual(advanced.defensePackage(detail), { label: 'Jumbo nickel', front: '3-3-5' });
    const p = plays.normalizePlay({ play_id: '1', play_type: 'run', rush: '1' });
    advanced.attach(p, { defense_personnel: detail });
    assert.deepEqual(advanced.tags(p), ['Jumbo nickel*']);
    assert.equal(p.personnel.defenseInferred, true);
  }
  for (const detail of [
    '3 DL, 3 LB, 5 DB', '3 DL, 1 OLB, 1 ILB, 1 LB, 5 DB',
    '2 DL, 2 OLB, 2 ILB, 5 DB', '3 DL, 2 OLB, 1 ILB, 5 DB',
    '3 DL, 1 OLB, 1 ILB, 5 DB',
  ]) assert.equal(advanced.defensePackage(detail).label, 'Nickel');
  const p = plays.normalizePlay({ play_id: '1', play_type: 'run', rush: '1' });
  const positions = ['DT', 'DT', 'DE', 'OLB', 'ILB', 'MLB', 'CB', 'CB', 'CB', 'FS', 'SS'];
  p.onField = { defense: positions.map((position, i) => ({ id: `id-${i}`, position })) };
  p.personnel = { defense: 'Nickel', front: '3-3-5' };
  advanced.inferPersonnel(p);
  assert.equal(p.personnel.defense, 'Jumbo nickel');
  assert.equal(p.inferredPersonnel.defense, 'Jumbo nickel');
});
