/* global A22 */
(function () {
  'use strict';
  const T = A22.tracking;
  const $ = id => document.getElementById(`highlight-${id}`);

  function graphic(track, appearance, width, photo) {
    const radius = width * track.radius;
    const label = track.showName && track.name;
    const hasPhoto = track.showPhoto && photo;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(Math.max(radius * 2 + 8, label || hasPhoto ? width * 0.21 : 0));
    const labelHeight = label || hasPhoto ? Math.round(width * 0.0375) : 0;
    canvas.height = Math.ceil(radius * 2 + 8 + labelHeight);
    const ctx = canvas.getContext('2d');
    const anchorX = canvas.width / 2, anchorY = canvas.height - radius - 4;
    ctx.beginPath();
    ctx.arc(anchorX, anchorY, radius, 0, Math.PI * 2);
    ctx.fillStyle = appearance.accent;
    ctx.globalAlpha = 0.18 * appearance.opacity;
    ctx.fill();
    ctx.globalAlpha = Math.max(0.35, appearance.opacity);
    ctx.strokeStyle = appearance.text;
    ctx.lineWidth = Math.max(4, width / 240);
    ctx.stroke();
    ctx.strokeStyle = appearance.accent;
    ctx.lineWidth = Math.max(2, width / 480);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (labelHeight) {
      ctx.fillStyle = appearance.background;
      ctx.globalAlpha = appearance.opacity;
      ctx.fillRect(0, 0, canvas.width, labelHeight);
      ctx.globalAlpha = 1;
      if (hasPhoto) ctx.drawImage(photo, 0, 0, labelHeight, labelHeight);
      if (label) {
        ctx.font = `bold ${Math.round(width * 0.014)}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = appearance.text;
        ctx.strokeStyle = appearance.outline;
        ctx.lineWidth = 2;
        const left = hasPhoto ? labelHeight + 5 : 8;
        ctx.strokeText(track.name, left, labelHeight / 2, canvas.width - left - 8);
        ctx.fillText(track.name, left, labelHeight / 2, canvas.width - left - 8);
      }
    }
    return { canvas, anchorX, anchorY };
  }

  A22.createHighlightEditor = function (options) {
    const video = $('video'), otherVideo = $('other-video'), canvas = $('canvas');
    let clip = null, angle = 'sideline', busy = false, requestedTime = 0;
    let job = null, running = null, analysisQueue = Promise.resolve();
    let offense = [], offenseTime = null, suggestion = null;
    let saving = Promise.resolve();
    const saveErrors = new Map();
    const saveKey = value => value.highlightKey || value;
    let photoRevision = 0;
    let viewports = null, themeChoices = [], themeSaving = false, playerChoices = [], snapSaving = false;
    const photos = new Map();
    const graphics = new WeakMap();
    const base = (camera = angle) => camera === 'sideline' ? clip.aStart : clip.bStart;
    const otherAngle = () => angle === 'sideline' ? 'endzone' : 'sideline';
    const track = () => clip?.highlights?.[angle];
    const start = () => (angle === 'sideline' ? clip.aStart : clip.bStart) + clip.trim;
    const end = () => base() + clip.len - (clip.trimEnd ?? 0);
    const time = () => video.currentTime;
    const retained = () => !!clip && time() >= start() && time() < end();
    function requireRetained() {
      if (retained()) return true;
      status('This frame is removed. Seek inside the retained range before editing player annotations.', true);
      return false;
    }
    function status(message, error = false) {
      $('status').textContent = message;
      $('status').classList.toggle('error', error);
    }
    function setBusy(value) {
      busy = value;
      $('controls').disabled = !clip || options.isClean();
      $('cancel').hidden = !value;
      $('progress-panel').hidden = !value;
      options.onBusy(value);
    }
    function persist(current = clip) {
      const value = structuredClone(current.highlights);
      if (clip === current && !busy) status('Saving clip annotations...');
      saving = saving.then(() => options.save(current, value)).then(() => {
        saveErrors.delete(saveKey(current));
        if (clip === current && !busy) status('Clip annotations saved locally. Review assisted tracks before exporting.');
      }).catch(error => { saveErrors.set(saveKey(current), error); status(`Annotations could not be saved: ${error.message}`, true); });
      return saving;
    }
    function ensureTrack() {
      if (!track()) {
        clip.highlights ||= {};
        const marked = options.getSnap?.(clip);
        clip.highlights[angle] = { ...T.defaults(options.defaults()), name: '', id: null, points: [],
          snap: marked?.confirmed ? base() + marked.time : null };
      }
      return track();
    }
    function syncControls() {
      const value = track() || { ...T.defaults(options.defaults()), name: '', snap: null };
      $('enabled').checked = !!track();
      $('mode').value = value.mode;
      $('radius').value = Number((value.radius * 100).toFixed(2));
      $('name').value = value.name;
      $('show-name').checked = value.showName;
      $('show-photo').checked = value.showPhoto;
      $('snap').value = value.snap === null ? '' : (value.snap - start()).toFixed(3);
      $('snap').min = 0;
      $('snap').max = clip ? end() - start() : 0;
      $('offense-count').textContent = `${offense.length} offensive targets marked`;
      $('accept-snap').disabled = !suggestion;
      $('suggestion').textContent = suggestion
        ? `Suggested snap: ${(suggestion.time - start()).toFixed(2)}s (${suggestion.confidence} relative confidence; ${suggestion.players} marked offensive targets). Review before accepting.`
        : 'No snap suggestion. Mark at least 3 stationary offensive players on the same pre-snap frame, then run tracking.';
      const points = value.points || [];
      syncThemeControls(value);
      const first = points.find(p => p.t >= start() && p.t < end());
      const last = points.findLast(p => p.t >= start() && p.t < end());
      $('review-stop').disabled = !last;
      $('coverage').textContent = points.length === 1
        ? job?.value === track() ? 'Position placed. Tracking is running in the background; the motion track appears when analysis finishes.'
          : 'One position placed, not a motion track. Click the player to track again, or use Track from this frame.'
        : first && last
          ? `${points.length} saved positions; first ${(first.t - start()).toFixed(2)}s, last ${(last.t - start()).toFixed(2)}s of ${(end() - start()).toFixed(2)}s. Gaps and footage after the last position are not highlighted. Use Go to last tracked frame to continue a stopped track.`
          : 'No track in this retained clip. Click the player on the film to start background tracking. Choosing a name or pressing Play preview alone does not run tracking.';
    }
    function syncTrimHandles() {
      for (const boundary of ['start', 'end']) {
        const input = $('trim-' + boundary);
        input.disabled = !clip || !!options.isExporting?.();
        if (!clip) continue;
        const value = boundary === 'start' ? clip.trim : clip.len - (clip.trimEnd ?? 0);
        input.max = clip.len;
        input.step = 1 / clip.fps;
        input.value = value;
        input.setAttribute('aria-valuetext', `${value.toFixed(2)} seconds from original start${boundary === 'end' ? '; exclusive end' : ''}`);
        $('trim-' + boundary + '-label').textContent = `${value.toFixed(2)}s`;
      }
      if (!clip) return;
      // Match the 14px thumbs so removed portions line up with the handles and playhead.
      const track = ratio => `calc(7px + (100% - 14px) * ${ratio})`;
      $('time').style.setProperty('--trim-start', clip.trim > 0 ? track(clip.trim / clip.len) : '0%');
      $('time').style.setProperty('--trim-end', clip.trimEnd > 0 ? track((clip.len - clip.trimEnd) / clip.len) : '100%');
      syncSnapMarker();
    }
    function syncSnapMarker() {
      const value = clip && options.getSnap?.(clip);
      $('snap-marker').hidden = !value;
      $('mark-play-snap').disabled = !clip || snapSaving || !!options.isExporting?.() || !options.saveSnap;
      $('clear-play-snap').disabled = $('mark-play-snap').disabled || !value?.confirmed;
      $('go-play-snap').disabled = !value || !!options.isExporting?.();
      $('play-snap-status').textContent = !value && options.snapLearning?.() === false
        ? 'Snap learning is off. You can still mark this play.' : T.snapLabel(value);
      if (value) {
        $('snap-marker').style.setProperty('--snap-position', value.time / clip.len);
        $('snap-marker').classList.toggle('confirmed', value.confirmed);
      }
    }
    async function savePlaySnap(relative, enableTrack = false) {
      if (!clip || snapSaving || options.isExporting?.() || !options.saveSnap) return;
      const current = clip, camera = angle;
      snapSaving = true;
      syncSnapMarker();
      try {
        const result = await options.saveSnap(current, relative);
        if (enableTrack && !current.highlights?.[camera]) {
          current.highlights ||= {};
          current.highlights[camera] = { ...T.defaults(options.defaults()), name: '', id: null, points: [], snap: null };
        }
        let changed = false;
        for (const [name, value] of Object.entries(current.highlights || {})) {
          if (!['sideline', 'endzone'].includes(name)) continue;
          value.snap = relative === null ? null : (name === 'sideline' ? current.aStart : current.bStart) + relative;
          changed = true;
        }
        if (changed) await persist(current);
        if (clip === current) {
          syncControls();
          draw();
          if (!saveErrors.has(saveKey(current))) status(result?.warning || (relative === null ? 'Snap cleared.' : 'Snap confirmed and saved locally.'), !!result?.warning);
        }
      } catch (error) {
        status(`Snap could not be saved: ${error.message}`, true);
      } finally {
        snapSaving = false;
        syncSnapMarker();
      }
    }
    function syncThemeControls(value = track() || options.defaults()) {
      if (!options.themes) return;
      themeChoices = options.themes();
      const inherited = options.appearance();
      const appearance = T.appearance(value, inherited);
      $('theme').replaceChildren(new Option('Match play information', 'match'));
      for (const item of themeChoices) $('theme').add(new Option(item.label, item.value));
      $('theme').add(new Option('Custom / modified', 'custom'));
      const match = value.theme && themeChoices.find(item => item.theme.background === value.theme.background && item.theme.accent === value.theme.accent);
      $('theme').value = value.theme == null ? 'match' : match?.value || 'custom';
      $('theme-background').value = appearance.background;
      $('theme-accent').value = appearance.accent;
      $('opacity-match').checked = value.opacity == null;
      $('opacity').value = appearance.opacity * 100;
      $('opacity-value').textContent = `${Math.round(appearance.opacity * 100)}%`;
      $('theme-delete').disabled = themeSaving || !$('theme').value.startsWith('saved-');
      $('theme-save').disabled = themeSaving;
    }
    function drawTrack(ctx, viewport, camera, timestamp) {
      const value = clip.highlights?.[camera];
      const p = value && T.visible(value, timestamp) && T.position(value.points, timestamp);
      const cameraStart = base(camera) + clip.trim;
      if (!p || options.isClean() || timestamp < cameraStart || timestamp >= base(camera) + clip.len - (clip.trimEnd ?? 0)) return;
      const appearance = T.appearance(value, options.appearance()), photo = photos.get(value.id);
      const key = JSON.stringify([value.radius, value.name, value.showName, value.showPhoto, appearance, viewport.w]);
      let cached = graphics.get(value);
      if (!cached || cached.key !== key || cached.photo !== photo) {
        cached = { key, photo, image: graphic(value, appearance, viewport.w, photo) };
        graphics.set(value, cached);
      }
      const image = cached.image;
      ctx.drawImage(image.canvas, viewport.x + p.x * viewport.w - image.anchorX, viewport.y + p.y * viewport.h - image.anchorY);
    }
    function draw() {
      if (!clip || video.readyState < 2) return;
      if (video.seeking || options.mode?.() === 'both' && (otherVideo.readyState < 2 || otherVideo.seeking)) return;
      canvas.hidden = false;
      if (options.renderPreview) {
        viewports = options.renderPreview({ canvas, clip, angle, video, otherVideo, time: time() - start(), drawTrack });
      } else {
        canvas.width = 960;
        canvas.height = Math.round(960 * video.videoHeight / video.videoWidth);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        viewports = { [angle]: { x: 0, y: 0, w: canvas.width, h: canvas.height } };
        drawTrack(ctx, viewports[angle], angle, time());
      }
      const ctx = canvas.getContext('2d');
      const value = track(), t = time();
      const p = value && T.position(value.points, t);
      $('preview-state').textContent = !retained() ? 'Removed frame: play information and player highlights are hidden.'
        : !value ? 'No player highlight enabled.'
        : value.mode === 'presnap' && value.snap === null ? 'Set or confirm the snap to preview a pre-snap highlight.'
          : !T.visible(value, t) ? 'Highlight hidden: this frame is at or after the configured snap.'
            : !p ? 'Untracked frame. Click the player here to track from this frame.'
              : value.points.length === 1 ? job?.value === value ? 'Position placed. Tracking in the background; you can keep using the preview.'
                : 'Position placed only. Click the player to track again.'
                : 'Showing a saved tracked position. Review that the circle stays on the intended player.';
      const viewport = viewports[angle];
      if (offenseTime !== null && Math.abs(t - offenseTime) < 0.06) {
        ctx.strokeStyle = '#ffffff';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        offense.forEach((p, index) => {
          ctx.strokeRect(viewport.x + p.x * viewport.w - 6, viewport.y + p.y * viewport.h - 6, 12, 12);
          ctx.fillText(String(index + 1), viewport.x + p.x * viewport.w + 9, viewport.y + p.y * viewport.h);
        });
      }
      $('time').value = Math.max(0, time() - base());
      $('time-label').textContent = `${Math.max(0, time() - base()).toFixed(2)} / ${clip.len.toFixed(2)}s`;
      $('time').setAttribute('aria-valuetext', `${(time() - base()).toFixed(2)} seconds from original start; ${retained() ? 'retained' : 'removed'}`);
    }
    function stopPlayback() { video.pause(); otherVideo.pause(); $('play').textContent = 'Play preview'; }
    function syncOther(exact = false) {
      if (!clip || !otherVideo.readyState) return;
      const target = base(otherAngle()) + time() - base();
      if (Math.abs(otherVideo.currentTime - target) > (exact ? 0.000001 : 0.04)) otherVideo.currentTime = target;
    }
    function seek(relative) {
      stopPlayback();
      const target = Math.min(base() + clip.len - 0.001, Math.max(base(), base() + relative));
      if (offenseTime !== null && Math.abs(target - offenseTime) > 0.06) {
        offense = [];
        offenseTime = null;
        syncControls();
      }
      requestedTime = target - base();
      video.currentTime = target;
      syncOther(true);
    }
    video.addEventListener('seeked', draw);
    video.addEventListener('loadedmetadata', () => { if (clip) seek(requestedTime); });
    otherVideo.addEventListener('loadedmetadata', () => syncOther(true));
    otherVideo.addEventListener('seeked', draw);
    for (const source of [video, otherVideo]) {
      source.addEventListener('loadeddata', draw);
      source.addEventListener('error', () => status('Cut-up preview could not open this film.', true));
    }
    function stopAtEnd() {
      if (!clip || video.paused || time() < end()) return;
      stopPlayback();
      video.currentTime = Math.max(start(), end() - 0.001);
      syncOther();
    }
    video.addEventListener('timeupdate', () => {
      stopAtEnd();
      if (options.mode?.() === 'both') syncOther();
      draw();
    });
    function animate() {
      stopAtEnd();
      if (video.paused) return;
      if (options.mode?.() === 'both') syncOther();
      draw();
      requestAnimationFrame(animate);
    }
    $('play').addEventListener('click', () => {
      if (!clip) return;
      if (!video.paused) { stopPlayback(); return; }
      if (time() < start() || time() >= end() - 0.001) video.currentTime = start();
      syncOther();
      Promise.all([video.play(), ...(options.mode?.() === 'both' ? [otherVideo.play()] : [])])
        .then(() => { $('play').textContent = 'Pause preview'; animate(); })
        .catch(error => { stopPlayback(); status(`Preview failed: ${error.message}`, true); });
    });
    $('time').addEventListener('input', () => seek(Number($('time').value)));
    $('mark-play-snap').addEventListener('click', () => {
      if (!clip || video.readyState < 2 || video.seeking || options.mode?.() === 'both' && (otherVideo.readyState < 2 || otherVideo.seeking)) {
        status('Wait for the selected frame to finish loading before marking the snap.', true);
        return;
      }
      stopPlayback();
      return savePlaySnap(time() - base());
    });
    $('clear-play-snap').addEventListener('click', () => savePlaySnap(null));
    $('go-play-snap').addEventListener('click', () => {
      const value = clip && options.getSnap?.(clip);
      if (value) seek(value.time);
    });
    for (const boundary of ['start', 'end']) $('trim-' + boundary).addEventListener('input', () => {
      if (!clip || options.isExporting?.()) return;
      const frame = 1 / clip.fps;
      const value = Number($('trim-' + boundary).value);
      if (!Number.isFinite(value)) return;
      const snapped = value >= clip.len - frame / 2 ? clip.len : Math.round(value * clip.fps) / clip.fps;
      if (boundary === 'start') {
        clip.trim = Math.max(0, Math.min(snapped, clip.len - (clip.trimEnd ?? 0) - frame));
      } else {
        const endTime = Math.min(clip.len, Math.max(snapped, clip.trim + Math.min(frame, clip.len - clip.trim)));
        clip.trimEnd = clip.len - endTime;
      }
      clip.trimEdited = true;
      syncTrimHandles();
      syncControls();
      seek(boundary === 'start' ? clip.trim : Math.max(clip.trim, clip.len - (clip.trimEnd ?? 0) - 0.001));
      options.onTrim?.(clip);
    });
    $('back').addEventListener('click', () => seek(time() - base() - 1 / clip.fps));
    $('forward').addEventListener('click', () => seek(time() - base() + 1 / clip.fps));
    $('review-stop').addEventListener('click', () => {
      const last = track()?.points.findLast(p => p.t >= start() && p.t < end());
      if (!last) return;
      seek(last.t - base());
      status('This is the last tracked frame. Step forward to a clear view and click the same player to resume background tracking. Earlier tracked positions are kept.');
    });
    canvas.addEventListener('click', event => {
      if (!clip || options.isClean() || video.readyState < 2 || $('tool').value === 'overlay') return;
      if (video.seeking || options.mode?.() === 'both' && otherVideo.seeking) {
        status('Wait for the selected video frame to finish loading before placing a player.', true);
        return;
      }
      if (!requireRetained()) return;
      stopPlayback();
      const bounds = canvas.getBoundingClientRect();
      const viewport = viewports?.[angle];
      if (!viewport) return;
      const x = (event.clientX - bounds.left) / bounds.width * canvas.width;
      const y = (event.clientY - bounds.top) / bounds.height * canvas.height;
      const p = { x: (x - viewport.x) / viewport.w, y: (y - viewport.y) / viewport.h };
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
        status('Click inside the selected preview camera, not the other angle or output padding.', true);
        return;
      }
      if ($('tool').value === 'offense') {
        if (offense.length >= 11) { status('At most 11 offensive targets. Clear the markers to start again.', true); return; }
        if (offenseTime !== null && Math.abs(offenseTime - time()) > 0.06) offense = [];
        offenseTime = time();
        offense.push(p);
        syncControls();
      } else {
        const value = ensureTrack();
        value.points = value.points.filter(point => point.t < time() - 0.001);
        value.points.push({ ...p, t: time() });
        suggestion = null;
        syncControls();
        persist();
        draw();
        return startTracking();
      }
      draw();
    });
    $('clear-offense').addEventListener('click', () => { offense = []; offenseTime = null; syncControls(); draw(); });
    $('enabled').addEventListener('change', () => {
      if ($('enabled').checked) ensureTrack();
      else if (clip.highlights) {
        cancelForCurrentTrack();
        delete clip.highlights[angle];
      }
      syncControls(); persist(); draw();
    });
    for (const [id, field, read] of [
      ['mode', 'mode', element => element.value],
      ['radius', 'radius', element => Number(element.value) / 100],
      ['name', 'name', element => element.value],
      ['show-name', 'showName', element => element.checked],
      ['show-photo', 'showPhoto', element => element.checked],
    ]) $(id).addEventListener('change', () => {
      ensureTrack()[field] = read($(id));
      Object.assign(track(), T.defaults(track()));
      syncControls(); persist(); draw();
      if (id === 'show-photo') loadPhoto();
    });
    $('player').addEventListener('change', () => {
      const player = playerChoices.find(p => p.id === $('player').value);
      const value = ensureTrack();
      value.id = player?.id || null;
      value.name = player?.name || '';
      syncControls(); persist(); loadPhoto(); draw();
    });
    function setSnap(value) {
      if (options.saveSnap) return savePlaySnap(value === null ? null : value - base(), true);
      ensureTrack().snap = value;
      syncControls(); persist(); draw();
    }
    $('snap').addEventListener('change', () => {
      const value = $('snap').valueAsNumber;
      if ($('snap').value === '') setSnap(null);
      else if (Number.isFinite(value) && value >= 0 && value <= end() - start()) setSnap(start() + value);
      else { syncControls(); status('Snap must be inside this retained clip.', true); }
    });
    $('set-snap').addEventListener('click', () => { if (requireRetained()) setSnap(time()); });
    $('accept-snap').addEventListener('click', () => {
      if (!suggestion) return;
      if (suggestion.time >= start() && suggestion.time <= end()) setSnap(suggestion.time);
      else status('Suggested snap is outside this retained clip. Set the snap manually.', true);
    });
    $('clear-track').addEventListener('click', () => {
      cancelForCurrentTrack();
      if (clip.highlights) delete clip.highlights[angle];
      suggestion = null;
      syncControls(); persist(); draw();
    });
    $('defaults').addEventListener('click', async () => {
      try { await options.saveDefaults(T.defaults(track() || options.defaults())); status('Highlight display defaults saved. Existing clips are unchanged.'); }
      catch (error) { status(`Defaults could not be saved: ${error.message}`, true); }
    });
    $('theme').addEventListener('change', () => {
      const value = ensureTrack(), selected = $('theme').value;
      value.theme = selected === 'match' ? null : A22.overlay.theme(themeChoices.find(item => item.value === selected)?.theme || T.appearance(value, options.appearance()));
      syncThemeControls(); persist(); draw();
    });
    for (const key of ['background', 'accent']) {
      $('theme-' + key).addEventListener('input', () => {
        const value = ensureTrack();
        value.theme = A22.overlay.theme({ ...T.appearance(value, options.appearance()), [key]: $('theme-' + key).value });
        syncThemeControls(); draw();
      });
      $('theme-' + key).addEventListener('change', () => persist());
    }
    $('opacity-match').addEventListener('change', () => {
      ensureTrack().opacity = $('opacity-match').checked ? null : Number($('opacity').value) / 100;
      syncThemeControls(); persist(); draw();
    });
    $('opacity').addEventListener('input', () => {
      ensureTrack().opacity = Number($('opacity').value) / 100;
      syncThemeControls(); draw();
    });
    $('opacity').addEventListener('change', () => persist());
    async function saveTheme(remove) {
      if (themeSaving) return;
      const selected = $('theme').value;
      const name = $('theme-name').value.trim();
      if (!remove && (!name || name.length > 60)) { status('Enter a theme name (1-60 characters).', true); return; }
      if (remove && !selected.startsWith('saved-')) return;
      themeSaving = true; syncThemeControls();
      try {
        await options.saveTheme({ name, theme: A22.overlay.theme(T.appearance(track() || options.defaults(), options.appearance())), remove: remove ? Number(selected.slice(6)) : null });
        status(remove ? 'Saved theme deleted. Current player colors are unchanged.' : `Theme "${name}" saved for player and play-information overlays.`);
      } catch (error) { status(`Could not save player theme: ${error.message}`, true); }
      finally { themeSaving = false; syncThemeControls(); }
    }
    $('theme-save').addEventListener('click', () => saveTheme(false));
    $('theme-delete').addEventListener('click', () => saveTheme(true));
    $('tool').addEventListener('change', () => {
      canvas.dataset.tool = $('tool').value;
      if ($('tool').value !== 'overlay') options.openPlayer?.();
    });
    async function loadPhoto() {
      const token = ++photoRevision;
      const ids = [...new Set(Object.values(clip?.highlights || {}).filter(value => value.showPhoto && value.id && !photos.has(value.id)).map(value => value.id))];
      if (!ids.length) { draw(); return; }
      try {
        for (const result of await window.api.getHeadshots(ids)) {
          if (token !== photoRevision) return;
          if (!result?.dataUrl) { status(`Headshot unavailable: ${result?.warning || 'No headshot available for this player.'} Name and circle remain available.`, true); continue; }
          const image = new Image();
          image.src = result.dataUrl;
          await image.decode();
          if (token !== photoRevision) return;
          photos.set(result.id, options.preparePhoto(image));
        }
        draw();
      } catch (error) {
        if (token === photoRevision) status(`Headshot unavailable: ${error.message}. Name and circle remain available.`, true);
      }
    }
    function showProgress(fraction) {
      const progress = Math.max(0, Math.min(1, fraction));
      $('progress').value = progress;
      $('progress-label').textContent = `Tracking ${job.angle === 'sideline' ? 'sideline' : 'end zone'}${job.clip.playNumber ? `, play ${job.clip.playNumber}` : ''}: ${Math.round(progress * 100)}%. You can keep previewing or editing.`;
    }
    async function cancelRunning() {
      if (!running) return;
      try { await window.api.cancelTracking(); }
      catch (error) { status(`Could not cancel tracking: ${error.message}. The next track will wait for the current analysis to finish.`, true); }
    }
    function cancelTracking() {
      job = null;
      setBusy(false);
      status('Tracking cancelled. Earlier positions and the placed marker are kept.');
      syncControls(); draw();
      return cancelRunning();
    }
    function cancelForCurrentTrack() {
      if (job?.value === track()) void cancelTracking();
    }
    function startTracking() {
      if (!requireRetained()) return;
      const value = track();
      const seed = value && T.position(value.points, time());
      if (!seed) { status('Click the player on the current frame before tracking.', true); return; }
      if (options.isClean()) return;
      const requestedStart = time(), requestedClip = clip, requestedAngle = angle;
      const requestedEnd = end(), retainedStart = start();
      const seeds = [{ x: seed.x, y: seed.y }, ...(offenseTime !== null && Math.abs(offenseTime - time()) < 0.06 ? offense : [])];
      const next = job = { clip: requestedClip, angle: requestedAngle, value };
      setBusy(true); showProgress(0); syncControls(); draw();
      status('Tracking in the background. Click again to replace the pending track.');
      const cancellation = cancelRunning();
      // Wait for the old worker to release its slot; skip superseded queued placements.
      analysisQueue = analysisQueue.then(async () => {
        await cancellation;
        if (job !== next) return;
        running = next;
        try {
          const result = await window.api.trackPlayer({ file: requestedClip.file, start: requestedStart, len: Math.min(T.MAX_SECONDS, requestedEnd - requestedStart), seeds });
          if (job !== next || requestedClip.highlights?.[requestedAngle] !== value) return;
          const points = value.points.filter(p => p.t < requestedStart - 0.001).concat(result.points);
          if (points.length > T.MAX_POINTS) throw new Error('Track exceeds the 60-second position limit. Start a shorter highlight.');
          value.points = points;
          const visible = () => clip?.highlights?.[angle] === value;
          if (visible()) { suggestion = result.suggestion; syncControls(); draw(); }
          await persist(requestedClip);
          if (job !== next) return;
          if (saveErrors.has(saveKey(requestedClip))) throw new Error(`Annotations could not be saved: ${saveErrors.get(saveKey(requestedClip)).message}`);
          const last = result.points.at(-1);
          const stopped = !last || last.t < Math.min(requestedEnd, requestedStart + T.MAX_SECONDS) - 0.15;
          if (visible()) status(`${stopped ? 'Tracking stopped early' : 'Tracking finished'}: ${result.points.length} positions${last ? `, through ${(last.t - retainedStart).toFixed(2)}s of ${(requestedEnd - retainedStart).toFixed(2)}s` : ''}. ${result.warnings.join(' ')}${requestedEnd - requestedStart > T.MAX_SECONDS ? ' Analysis is capped at 60 seconds; remaining footage is not highlighted.' : ''} ${stopped ? 'Use Go to last tracked frame, then click the player to continue.' : 'Play preview to review the track before exporting.'}`, stopped);
        } catch (error) {
          if (job === next) status(`Tracking stopped: ${error.message}`, true);
        } finally {
          running = null;
          if (job === next) { job = null; setBusy(false); syncControls(); draw(); }
        }
      });
      return analysisQueue;
    }
    $('run').addEventListener('click', startTracking);
    $('cancel').addEventListener('click', cancelTracking);
    window.api.onTrackingProgress(fraction => { if (job && running === job) showProgress(fraction); });
    $('angle').addEventListener('change', () => select(clip, true));

    function select(next, preserveTime = false) {
      const relative = clip && next === clip && preserveTime ? Math.max(0, time() - base()) : next?.trim || 0;
      requestedTime = relative;
      stopPlayback();
      if (next && job && saveKey(next) === saveKey(job.clip)) next.highlights = job.clip.highlights;
      clip = next;
      angle = $('angle').value;
      if (options.mode) {
        const mode = options.mode();
        const single = ['sideline', 'endzone'].includes(mode);
        $('angle').disabled = single;
        if (single) angle = $('angle').value = mode;
      }
      canvas.hidden = true;
      viewports = null;
      offense = []; offenseTime = null; suggestion = null;
      photoRevision++;
      $('editor').hidden = !clip;
      setBusy(busy);
      syncTrimHandles();
      if (!clip) return;
      $('time').max = clip.len;
      $('time').value = relative;
      $('time').step = 1 / clip.fps;
      $('player').replaceChildren(new Option('Custom name / no roster identity', ''));
      playerChoices = options.players(clip);
      for (const p of playerChoices) $('player').add(new Option(`${p.team || ''} ${p.number ? '#' + p.number : ''} ${p.name || p.id}`, p.id));
      if (track()?.id && !playerChoices.some(p => p.id === track().id)) {
        playerChoices = [...playerChoices, { id: track().id, name: track().name }];
        $('player').add(new Option(`Saved identity: ${track().name || track().id} (not in available roster)`, track().id));
      }
      $('player').value = track()?.id || '';
      syncControls();
      if (video.src !== clip.url) video.src = clip.url;
      else seek(relative);
      if (otherVideo.src !== clip.url) otherVideo.src = clip.url;
      else syncOther();
      status(busy ? 'Tracking continues in the background. You can preview, edit, or close Share.'
        : $('tool').value === 'overlay' ? 'Drag play information on the video, or choose a player tool to place / correct a highlight.'
          : 'Click the player on the film to start background tracking or correct from this frame.');
      loadPhoto();
    }

    return {
      select,
      relativeTime: () => clip ? Math.max(0, time() - base()) : 0,
      ready: () => !!clip && video.readyState >= 2 && !video.seeking && (options.mode?.() !== 'both' || otherVideo.readyState >= 2 && !otherVideo.seeking),
      busy: () => busy,
      pause: stopPlayback,
      refresh: () => { $('controls').disabled = !clip || options.isClean(); syncTrimHandles(); syncThemeControls(); draw(); },
      async export(clips, mode, appearance, centered) {
        if (busy) throw new Error('Finish or cancel background player tracking before exporting highlights.');
        await saving;
        const failed = clips.find(value => saveErrors.has(saveKey(value)));
        if (failed) throw new Error(`Save clip annotations before exporting: ${saveErrors.get(saveKey(failed)).message}`);
        const ids = [...new Set(clips.flatMap(c => Object.values(c.highlights || {}).filter(t => t.showPhoto && t.id).map(t => t.id)))];
        const images = new Map(), warnings = [];
        if (ids.length) {
          for (const result of await window.api.getHeadshots(ids)) {
            if (!result.dataUrl) { warnings.push(`Highlight headshot ${result.id}: ${result.warning || 'unavailable'}`); continue; }
            try {
              const image = new Image(); image.src = result.dataUrl; await image.decode(); images.set(result.id, options.preparePhoto(image));
            } catch (error) { warnings.push(`Highlight headshot ${result.id}: ${error.message}`); }
          }
        }
        const result = clips.map(c => {
          const highlights = {};
          for (const [angleName, value] of Object.entries(c.highlights || {})) {
            if (['sideline', 'endzone'].includes(mode) && angleName !== mode) continue;
            T.validateTrack(value);
            if (value.points.length === 0) throw new Error('A highlight is enabled without a player position. Place the player or remove that highlight.');
            if (value.mode === 'presnap' && value.snap === null) throw new Error('Set or confirm the snap for each pre-snap highlight.');
            const geometry = T.geometry(mode === 'both' ? 'both' : angleName, angleName, c.info, centered);
            const image = graphic(value, T.appearance(value, appearance), geometry.w, images.get(value.id));
            highlights[angleName] = { ...value, graphic: {
              dataUrl: image.canvas.toDataURL('image/png'), width: image.canvas.width, height: image.canvas.height,
              anchorX: image.anchorX, anchorY: image.anchorY,
            } };
          }
          return { ...c, highlights };
        });
        return { clips: result, warnings };
      },
    };
  };
})();
