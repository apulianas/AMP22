(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.A22 = root.A22 || {}).teams = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TEAMS = {
    ARI: ['Arizona', 'Cardinals', ['cards']],
    ATL: ['Atlanta', 'Falcons'],
    BAL: ['Baltimore', 'Ravens'],
    BUF: ['Buffalo', 'Bills'],
    CAR: ['Carolina', 'Panthers'],
    CHI: ['Chicago', 'Bears'],
    CIN: ['Cincinnati', 'Bengals'],
    CLE: ['Cleveland', 'Browns'],
    DAL: ['Dallas', 'Cowboys'],
    DEN: ['Denver', 'Broncos'],
    DET: ['Detroit', 'Lions'],
    GB: ['Green Bay', 'Packers'],
    HOU: ['Houston', 'Texans'],
    IND: ['Indianapolis', 'Colts'],
    JAX: ['Jacksonville', 'Jaguars', ['jags']],
    KC: ['Kansas City', 'Chiefs'],
    LV: ['Las Vegas', 'Raiders'],
    LAC: ['Los Angeles', 'Chargers'],
    LA: ['Los Angeles', 'Rams'],
    MIA: ['Miami', 'Dolphins'],
    MIN: ['Minnesota', 'Vikings'],
    NE: ['New England', 'Patriots', ['pats']],
    NO: ['New Orleans', 'Saints'],
    NYG: ['New York', 'Giants'],
    NYJ: ['New York', 'Jets'],
    PHI: ['Philadelphia', 'Eagles'],
    PIT: ['Pittsburgh', 'Steelers'],
    SF: ['San Francisco', '49ers', ['niners']],
    SEA: ['Seattle', 'Seahawks'],
    TB: ['Tampa Bay', 'Buccaneers', ['bucs']],
    TEN: ['Tennessee', 'Titans'],
    WAS: ['Washington', 'Commanders'],
    OAK: ['Oakland', 'Raiders'],
    SD: ['San Diego', 'Chargers'],
    STL: ['St. Louis', 'Rams'],
  };

  const COLORS = {
    ARI: ['#97233f', '#ffb612'], ATL: ['#a71930', '#a5acaf'], BAL: ['#241773', '#9e7c0c'],
    BUF: ['#00338d', '#c60c30'], CAR: ['#0085ca', '#101820'], CHI: ['#0b162a', '#c83803'],
    CIN: ['#fb4f14', '#000000'], CLE: ['#311d00', '#ff3c00'], DAL: ['#003594', '#869397'],
    DEN: ['#002244', '#fb4f14'], DET: ['#0076b6', '#b0b7bc'], GB: ['#203731', '#ffb612'],
    HOU: ['#03202f', '#a71930'], IND: ['#002c5f', '#a2aaad'], JAX: ['#006778', '#d7a22a'],
    KC: ['#e31837', '#ffb81c'], LV: ['#000000', '#a5acaf'], LAC: ['#0080c6', '#ffc20e'],
    LA: ['#003594', '#ffd100'], MIA: ['#008e97', '#fc4c02'], MIN: ['#4f2683', '#ffc62f'],
    NE: ['#002244', '#c60c30'], NO: ['#101820', '#d3bc8d'], NYG: ['#0b2265', '#a71930'],
    NYJ: ['#125740', '#000000'], PHI: ['#004c54', '#a5acaf'], PIT: ['#101820', '#ffb612'],
    SF: ['#aa0000', '#b3995d'], SEA: ['#002244', '#69be28'], TB: ['#d50a0a', '#34302b'],
    TEN: ['#0c2340', '#4b92db'], WAS: ['#5a1414', '#ffb612'],
  };
  COLORS.OAK = COLORS.LV;
  COLORS.SD = COLORS.LAC;
  COLORS.STL = COLORS.LA;

  function teamName(abbr) {
    const t = TEAMS[abbr];
    return t ? `${t[0]} ${t[1]}` : abbr;
  }
  function nickname(abbr) {
    const t = TEAMS[abbr];
    return t ? t[1] : abbr;
  }
  function aliases(abbr) {
    const t = TEAMS[abbr];
    return t ? [t[1], ...(t[2] || [])] : [abbr];
  }
  return { TEAMS, COLORS, teamName, nickname, aliases };
});
