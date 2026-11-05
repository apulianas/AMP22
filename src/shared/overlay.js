(function (root, factory) {
  const mod = factory(typeof module === 'object' && module.exports ? require('./teams') : root.A22.teams);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.A22 = root.A22 || {}).overlay = mod;
})(typeof self !== 'undefined' ? self : this, function (teams) {
  'use strict';

  const DEFAULT_OPACITY = 0.9;

  function theme(value) {
    if (!value || ![value.background, value.accent].every((color) => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color))) {
      throw new Error('Overlay themes require background and accent colors in #RRGGBB format.');
    }
    return { background: value.background.toLowerCase(), accent: value.accent.toLowerCase() };
  }

  function opacity(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Overlay opacity must be between 0 and 100%.');
    return value;
  }

  function teamTheme(team) {
    const [primary, accent] = teams.COLORS[team] || ['#202b3b', '#a5acaf'];
    const background = '#' + primary.slice(1).match(/../g).map((part) =>
      Math.round(parseInt(part, 16) * 0.4).toString(16).padStart(2, '0')).join('');
    return { background, accent };
  }

  function luminance(color) {
    const channels = color.slice(1).match(/../g).map((part) => {
      const channel = parseInt(part, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }

  function appearance(value, alpha = DEFAULT_OPACITY, team) {
    const colors = value == null ? teamTheme(team) : theme(value);
    const light = luminance(colors.background);
    const text = (light + 0.05) / 0.05 > 1.05 / (light + 0.05) ? '#000000' : '#ffffff';
    return { ...colors, opacity: opacity(alpha), text, outline: text === '#ffffff' ? '#000000' : '#ffffff' };
  }

  return { DEFAULT_OPACITY, theme, opacity, teamTheme, luminance, appearance };
});
