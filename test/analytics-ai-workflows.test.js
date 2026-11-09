'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function exercise({ app, win }) {
  const { ipcMain, clipboard, dialog } = require('electron');
  const P = require('../src/shared/plays');
  const js = source => win.webContents.executeJavaScript(source, true);
  const wait = async source => {
    for (let i = 0; i < 300; i++) {
      if (await js(source)) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out: ${source}`);
  };
  const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler); };
  replace('schedule:get', () => { throw new Error('AI workflow offline boot'); });
  let models = [];
  let request;
  let failure = false;
  let delayed = false;
  let resolvePlan;
  let cancellations = 0;
  const plan = {
    status: 'ok', reason: '', group: 'all', split: 'type', metric: 'ypp', order: 'low',
    playType: 'all', down: 0, half: 'all', offense: 'all', defense: 'all', motion: 'all', playAction: 'all', minSnaps: 1, player: 'all', presence: 'all', downRange: 'all', minDistance: 0, maxDistance: 0,
  };
  let responsePlan = plan;
  replace('analysis-ai:discover', () => models);
  replace('analysis-ai:plan', (_event, body) => {
    request = body;
    if (failure) throw new Error('Local model failed');
    return delayed ? new Promise(resolve => { resolvePlan = resolve; }) : responsePlan;
  });
  replace('analysis-ai:cancel', () => { cancellations++; });
  for (const channel of ['film:open', 'film:suggest', 'film:analyze']) {
    replace(channel, () => { throw new Error('Film is forbidden'); });
  }
  const games = [
    { gameId: '2024_04_BUF_BAL', season: 2024, week: 4, gameType: 'REG', homeTeam: 'BAL', awayTeam: 'BUF', homeScore: 35, awayScore: 10 },
    { gameId: '2024_05_BAL_CIN', season: 2024, week: 5, gameType: 'REG', homeTeam: 'CIN', awayTeam: 'BAL', homeScore: 38, awayScore: 41 },
  ];
  replace('pbp:get', (_event, { gameId }) => ({ plays: Array.from({ length: 4 }, (_n, i) => ({
    ...P.normalizePlay({
      game_id: gameId, play_id: i + 1, posteam: 'BUF', defteam: 'BAL', qtr: 1, time: '10:00',
      play_type: i % 2 ? 'pass' : 'run', down: 3, ydstogo: 7, yards_gained: i % 2 ? 10 : 4,
      epa: i % 2 ? 0.5 : -0.5, desc: `AI workflow fixture ${i + 1}`,
    }), personnel: { offense: '11' },
    onField: { defense: i < 2 ? [
      { id: '00-0037235', name: 'Kyle Hamilton' },
      ...Array.from({ length: 10 }, (_value, index) => ({ id: `defender-${index}`, name: `Defender ${index}` })),
    ] : i === 2 ? Array.from({ length: 11 }, (_value, index) => ({ id: `defender-${index}`, name: `Defender ${index}` })) : [] },
  })) }));
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  await wait(`$('status').textContent.includes('AI workflow offline boot')`);
  await js(`(async () => {
    await setWorkspaceMode('analysis', false);
    S.games = ${JSON.stringify(games)};
    S.sel = {season:2024,team:'BAL',gameId:'2024_04_BUF_BAL'};
    renderSelectors(); await loadGame();
  })()`);
  await wait(`$('lab-summary').textContent.includes('4BAL defense scored snaps')`);
  assert.equal(await js(`$('lab-ai').hidden`), true);
  assert.equal(await js(`getComputedStyle($('lab-ai')).display`), 'none', 'no disabled button or unsupported message');
  assert.equal(await js(`$('lab-copy-context').disabled`), false, 'manual copying does not require a model');
  let copied = null;
  clipboard.writeText = text => { copied = text; };
  await js(`$('lab-copy-context').click()`);
  await wait(`!$('analysis-context-copy').disabled`);
  assert.match(await js(`$('analysis-context-preview').value`), /COMPUTED SUMMARY CSV/);
  assert.equal(copied, null, 'preview does not write the clipboard');
  await js(`$('analysis-context-question').value='Explain this game';
    $('analysis-context-question').dispatchEvent(new Event('input'));`);
  await wait(`!$('analysis-context-copy').disabled`);
  await js(`$('analysis-context-copy').click()`);
  await wait(`$('analysis-context-status').textContent.includes('Text copied')`);
  assert.match(copied, /Question: Explain this game/);
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(app.getPath('userData'), 'context.txt') });
  await js(`$('analysis-context-save').click()`);
  await wait(`$('analysis-context-status').textContent.includes('saved as TXT')`);
  assert.equal(fs.readFileSync(path.join(app.getPath('userData'), 'context.txt'), 'utf8'), copied);
  await js(`$('analysis-context-close').click()`);
  models = [{ id: 'apple', label: 'Apple on-device model' }, { id: 'other', label: 'Other test model' }];
  await js(`(async () => { S.sel.gameId='2024_05_BAL_CIN'; renderSelectors(); await loadGame(); })()`);
  await wait(`!$('lab-ai').hidden && !$('lab-ai-ask').disabled`);
  assert.equal(await js(`$('lab-ai-model-label').hidden`), false);
  await js(`$('lab-ai').open=true; $('lab-ai-question').value='Compare run and pass yards per play'; $('lab-ai-form').requestSubmit()`);
  await wait(`!$('lab-ai-answer').hidden`);
  assert.equal(request.context.snaps, 4);
  assert.equal(request.context.side, 'defense');
  assert.match(await js(`$('lab-ai-summary').textContent`), /4.00 \(2 known observations; 2 snaps\)/);
  assert.equal(await js(`$('lab-ai-rows').children.length`), 2);
  assert.match(await js(`$('lab-ai-query').textContent`), /All snaps \/ Run \/ pass/);
  await js(`document.querySelector('#lab-ai-rows button').click()`);
  assert.equal(await js(`$('lab-ai-evidence-plays').children.length`), 2);
  responsePlan = { ...plan, split: 'none', metric: 'epa', player: '00-0037235', presence: 'compare' };
  await js(`$('lab-ai-question').value='Compare defensive EPA with and without Kyle Hamilton'; $('lab-ai-form').requestSubmit()`);
  await wait(`!$('lab-ai-answer').hidden`);
  assert.equal(request.catalog.players.find(player => player.id === '00-0037235').name, 'Kyle Hamilton');
  assert.equal(await js(`$('lab-ai-rows').children.length`), 3);
  assert.match(await js(`$('lab-ai-rows').textContent`), /With Kyle Hamilton/);
  assert.match(await js(`$('lab-ai-rows').textContent`), /Without Kyle Hamilton/);
  assert.match(await js(`$('lab-ai-coverage').textContent`), /confirmed without: 1; unknown: 1/);
  assert.match(await js(`$('lab-ai-statistics').textContent`), /n = 2/);
  await js(`document.querySelector('#lab-ai-rows button').click()`);
  assert.equal(await js(`$('lab-ai-evidence-plays').children.length`), 1, 'without evidence includes only its confirmed snap');
  responsePlan = plan;
  await js(`$('lab-ai-question').value='Compare run and pass yards per play'; $('lab-ai-form').requestSubmit()`);
  await wait(`!$('lab-ai-answer').hidden`);
  await js(`document.querySelector('#lab-selection-plays input').click();
    $('lab-selection-mode').value='include'; $('lab-selection-mode').dispatchEvent(new Event('change'))`);
  assert.equal(await js(`$('lab-ai-answer').hidden`), true, 'cohort changes clear old answers');
  await js(`$('lab-ai-form').requestSubmit()`);
  await wait(`!$('lab-ai-answer').hidden`);
  assert.equal(request.context.snaps, 1, 'only selected plays are sent as the question cohort');
  assert.match(request.context.filters, /Only selected plays/);
  await js(`$('clear-filters').click(); $('lab-ai-model').value='other'; $('lab-ai-model').dispatchEvent(new Event('change'))`);
  assert.equal(await js(`$('lab-ai-answer').hidden`), true);
  failure = true;
  await js(`$('lab-ai-form').requestSubmit()`);
  await wait(`$('lab-ai-status').textContent.includes('Local model failed')`);
  assert.equal(await js(`$('lab-ai-answer').hidden`), true);
  failure = false; delayed = true;
  await js(`$('lab-ai-form').requestSubmit()`);
  await wait(`!$('lab-ai-cancel').hidden`);
  await js(`$('type-chips').querySelector('[data-type="pass"]').click()`);
  assert.equal(cancellations, 1);
  resolvePlan(plan);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await js(`$('lab-ai-answer').hidden`), true, 'late results never answer a changed cohort');
  await js(`$('lab-ai-form').requestSubmit()`);
  await wait(`!$('lab-ai-cancel').hidden`);
  await js(`$('lab-ai-cancel').click()`);
  resolvePlan(plan);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await js(`$('lab-ai-status').textContent`), 'Question cancelled.');
  assert.equal(cancellations, 2);
  delayed = false;
  let configured = false;
  let savedKey;
  let checks = 0;
  const cloudStatus = () => ({
    protectedStorage: true,
    providers: [
      { id: 'openai', name: 'OpenAI', model: 'gpt-4.1-mini', configured },
      { id: 'anthropic', name: 'Anthropic', model: 'claude-haiku-4-5-20251001', configured: false },
    ],
  });
  replace('analysis-ai:cloud-status', cloudStatus);
  replace('analysis-ai:cloud-save', (_event, body) => {
    savedKey = body.key;
    configured = true;
    models.push({ id: 'cloud:openai', label: 'OpenAI / gpt-4.1-mini (cloud)', cloud: true });
    return cloudStatus();
  });
  replace('analysis-ai:cloud-check', () => {
    checks++;
    return { provider: 'OpenAI (cloud)', usage: { inputTokens: 42, outputTokens: 12 } };
  });
  replace('analysis-ai:cloud-disconnect', () => {
    configured = false;
    models = models.filter(m => !m.cloud);
    return cloudStatus();
  });
  await js(`toggleOverlay('settings', true); $('configure-cloud-ai').click()`);
  await wait(`!$('cloud-ai-save').disabled`);
  assert.equal(await js(`$('cloud-ai-key').value`), '');
  assert.equal(await js(`$('cloud-ai-check').disabled`), true);
  await js(`$('cloud-ai-key').value='sk-test-not-a-real-credential';
    $('cloud-ai-key').dispatchEvent(new Event('input')); $('cloud-ai-form').requestSubmit()`);
  await wait(`$('cloud-ai-status').textContent.includes('Provider saved')`);
  assert.equal(savedKey, 'sk-test-not-a-real-credential');
  assert.equal(await js(`$('cloud-ai-key').value`), '', 'raw credentials are cleared after saving');
  assert.equal(checks, 0, 'saving does not make a network request');
  await js(`$('cloud-ai-model').value='gpt-4.1'; $('cloud-ai-model').dispatchEvent(new Event('input'))`);
  assert.equal(await js(`$('cloud-ai-check').disabled`), true, 'unsaved model changes cannot test the old saved model');
  await js(`$('cloud-ai-model').value='gpt-4.1-mini'; $('cloud-ai-model').dispatchEvent(new Event('input')); $('cloud-ai-check').click()`);
  await wait(`$('cloud-ai-status').textContent.includes('42 input / 12 output')`);
  assert.equal(checks, 1);
  await js(`$('cloud-ai-close').click(); toggleOverlay('settings', false);`);
  await wait(`$('lab-ai-model').querySelector('[value="cloud:openai"]') !== null`);
  replace('analysis-ai:plan', (_event, body) => {
    request = body;
    return { plan, usage: { inputTokens: 123, outputTokens: 45 }, provider: 'OpenAI' };
  });
  await js(`$('lab-ai-model').value='cloud:openai'; $('lab-ai-model').dispatchEvent(new Event('change'))`);
  assert.match(await js(`$('lab-ai-privacy').textContent`), /leave this device/);
  await js(`$('lab-ai-form').requestSubmit()`);
  await wait(`!$('lab-ai-answer').hidden`);
  assert.match(await js(`$('lab-ai-usage').textContent`), /123 input \/ 45 output/);
  assert.equal(request.provider, 'cloud:openai');
  await js(`toggleOverlay('settings', true); $('configure-cloud-ai').click()`);
  await wait(`!$('cloud-ai-disconnect').disabled`);
  await js(`$('cloud-ai-disconnect').click()`);
  await wait(`$('cloud-ai-status').textContent.includes('disconnected')`);
  await js(`$('cloud-ai-close').click(); toggleOverlay('settings', false);`);
  await wait(`$('lab-ai-model').querySelector('[value="cloud:openai"]') === null`);
  assert.equal(await js(`$('lab-ai-answer').hidden`), true);
  assert.match(await js(`$('lab-ai-privacy').textContent`), /stay on this device/);
  win.setSize(1100, 800);
  assert.equal(await js(`$('lab-ai').scrollWidth <= $('lab-ai').clientWidth`), true);
  console.log('ANALYTICS AI WORKFLOWS PASSED');
  app.exit(0);
}

if (process.versions.electron) module.exports = exercise;
else {
  const test = require('node:test');
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  test('native AI availability, answers, evidence, selections, errors and stale/cancelled requests', {
    skip: !process.env.A22_TEST_AI, timeout: 60000,
  }, () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'amp22-ai-workflows-'));
    try {
      const result = spawnSync(require('electron'), ['--no-sandbox', path.join(__dirname, '..')], {
        env: { ...process.env, A22_USER_DATA: profile, A22_DEV_SCRIPT: __filename },
        encoding: 'utf8', timeout: 55000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /ANALYTICS AI WORKFLOWS PASSED/);
    } finally { fs.rmSync(profile, { recursive: true, force: true }); }
  });
}
