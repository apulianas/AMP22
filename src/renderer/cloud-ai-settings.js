'use strict';

window.createCloudAISettings = function () {
  const $ = id => document.getElementById(`cloud-ai-${id}`);
  const dialog = $('settings');
  let status;
  let busy = false;
  let checking = false;

  function controls() {
    const provider = status?.providers.find(p => p.id === $('provider').value);
    for (const id of ['provider', 'model', 'key']) $(id).disabled = busy;
    $('save').disabled = busy || !status;
    const edited = $('model').value.trim() !== provider?.model || !!$('key').value.trim();
    $('check').disabled = busy || !status || !provider?.configured || edited;
    $('disconnect').disabled = busy || !provider?.configured;
    $('cancel').hidden = !checking;
    $('close').disabled = busy && !checking;
  }

  function selection() {
    const provider = status?.providers.find(p => p.id === $('provider').value);
    $('key').value = '';
    $('model').value = provider?.model || '';
    $('account').textContent = provider?.configured ? 'API key saved. Leave the key blank to keep it, or enter a replacement.' : 'No API key saved.';
    controls();
  }

  function changed() {
    window.dispatchEvent(new Event('amp22-ai-providers-changed'));
  }

  async function perform(action) {
    if (busy) return;
    busy = true;
    $('status').classList.remove('error');
    controls();
    try { await action(); }
    catch (error) {
      $('status').textContent = `Provider action failed: ${error.message}`;
      $('status').classList.add('error');
    } finally {
      busy = checking = false;
      $('key').value = '';
      controls();
    }
  }

  document.getElementById('configure-cloud-ai').addEventListener('click', () => {
    dialog.showModal();
    $('status').textContent = 'Reading saved provider configuration...';
    perform(async () => {
      status = await window.api.cloudAIStatus();
      selection();
      $('status').textContent = 'No network request is made until you check a connection or ask a cloud question. ' +
        'OS-protected storage is checked when saving or sending; macOS may request Keychain access then.';
    });
  });
  $('provider').addEventListener('change', () => { selection(); $('status').textContent = ''; });
  for (const id of ['model', 'key']) $(id).addEventListener('input', controls);
  $('form').addEventListener('submit', event => {
    event.preventDefault();
    const request = { provider: $('provider').value, model: $('model').value.trim(), key: $('key').value.trim() };
    perform(async () => {
      $('status').textContent = 'Saving encrypted provider credentials...';
      status = await window.api.saveCloudAI(request);
      selection();
      changed();
      $('status').textContent = 'Provider saved. Check connection to verify model access and structured output. No cloud request has been sent.';
    });
    $('key').value = '';
  });
  $('check').addEventListener('click', () => {
    checking = true;
    perform(async () => {
      $('status').textContent = 'Waiting for confirmation to send a synthetic connection test...';
      const result = await window.api.checkCloudAI($('provider').value);
      $('status').textContent = `Connection and structured query verified: ${result.provider}. ` +
        (result.usage ? `Reported usage: ${result.usage.inputTokens} input / ${result.usage.outputTokens} output tokens. API charges may apply.` :
          'Token usage was not reported. API charges may apply.');
    });
  });
  $('disconnect').addEventListener('click', () => perform(async () => {
    status = await window.api.disconnectCloudAI($('provider').value);
    selection();
    changed();
    $('status').textContent = 'Provider disconnected; its encrypted key was removed. Revoke the API key at the provider if it is no longer needed.';
  }));
  $('cancel').addEventListener('click', () => {
    window.api.cancelAnalysisQuestion().catch(error => {
      $('status').textContent = `Cancellation failed: ${error.message}`;
      $('status').classList.add('error');
    });
  });
  $('close').addEventListener('click', () => {
    if (checking) window.api.cancelAnalysisQuestion().catch(error => console.warn('Cloud cancellation:', error.message));
    dialog.close();
  });
  dialog.addEventListener('cancel', event => {
    if (busy) event.preventDefault();
    if (checking) $('cancel').click();
  });
  dialog.addEventListener('close', () => { $('key').value = ''; });
  controls();
};
