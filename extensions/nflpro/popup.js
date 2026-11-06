'use strict';

const api = typeof browser === 'undefined' ? chrome : browser;
const status = document.getElementById('status');
let statusKey = '';
async function currentTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/pro\.nfl\.com\/film\/plays(?:\?|$)/.test(tab.url)) throw new Error('Open an NFL Pro game first.');
  const game = new URL(tab.url).searchParams.get('gameId');
  if (!game || !/^[a-zA-Z0-9-]{1,80}$/.test(game)) throw new Error('Select a single game first.');
  statusKey = `capture:${tab.id}:${game}`;
  return { tab, game, tabId: tab.id };
}
function render(value) {
  status.textContent = value?.message || 'Ready to capture the entire game.';
  const running = ['capturing', 'saving'].includes(value?.phase);
  document.getElementById('capture').disabled = running;
  document.getElementById('cancel').hidden = value?.phase !== 'capturing';
  document.getElementById('diagnostics').hidden = !value?.diagnostics;
  const progress = document.getElementById('progress');
  progress.hidden = !running;
  progress.max = value?.total || 1;
  if (value?.total) progress.value = value.completed;
  else progress.removeAttribute('value');
}
document.getElementById('capture').addEventListener('click', async () => {
  document.getElementById('capture').disabled = true;
  try {
    const context = await currentTab();
    await api.scripting.executeScript({
      target: { tabId: context.tabId }, world: 'MAIN', files: ['participation.js', 'collector.js', 'page.js'],
    });
    const prepared = await api.tabs.sendMessage(context.tabId, { action: 'prepare-game', game: context.game, tabId: context.tabId });
    if (prepared?.error || !prepared?.jobId) throw new Error(prepared?.error || 'Reload NFL Pro after updating the extension.');
    try {
      await api.scripting.executeScript({
        target: { tabId: context.tabId }, world: 'MAIN',
        func: (id) => { window.AMP22Capture.start(id); }, args: [prepared.jobId],
      });
    } catch (error) {
      await api.tabs.sendMessage(context.tabId, {
        action: 'abort-game', game: context.game, tabId: context.tabId, error: error.message,
      });
      throw error;
    }
  } catch (error) { render({ phase: 'error', message: error.message }); }
});
document.getElementById('cancel').addEventListener('click', async () => {
  try {
    const context = await currentTab();
    const result = await api.tabs.sendMessage(context.tabId, { action: 'cancel-game', game: context.game, tabId: context.tabId });
    if (result?.error) throw new Error(result.error);
    if (result?.jobId) await api.scripting.executeScript({
      target: { tabId: context.tabId }, world: 'MAIN',
      func: (id) => window.AMP22Capture?.stop(id), args: [result.jobId],
    });
  } catch (error) { status.textContent = error.message; }
});
document.getElementById('diagnostics').addEventListener('click', async () => {
  const button = document.getElementById('diagnostics');
  const message = document.getElementById('diagnostics-status');
  button.disabled = true;
  try {
    const context = await currentTab();
    const result = await api.tabs.sendMessage(context.tabId, {
      action: 'download-diagnostics', game: context.game, tabId: context.tabId,
    });
    if (result?.error || !result?.filename) throw new Error(result?.error || 'The diagnostics download was not accepted.');
    message.textContent = `Diagnostics download requested: ${result.filename}`;
  } catch (error) { message.textContent = `Diagnostics export failed: ${error.message}`; }
  finally { button.disabled = false; }
});
api.storage.onChanged.addListener((changes) => {
  if (changes[statusKey]) render(changes[statusKey].newValue);
});
currentTab().then(async (context) => {
  const result = await api.tabs.sendMessage(context.tabId, { action: 'capture-status', game: context.game, tabId: context.tabId });
  if (result?.error) throw new Error(result.error);
  render(result?.status);
}).catch((error) => render({ phase: 'error', message: error.message }));
