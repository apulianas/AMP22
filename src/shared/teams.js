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
  return { TEAMS, teamName, nickname, aliases };
});
