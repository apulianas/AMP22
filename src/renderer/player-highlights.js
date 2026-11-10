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
    const video = $('video'), canvas = $('canvas');
    let clip = null, angle = 'sideline', busy = false, photo = null, photoKey = '';
    let job = null, running = null, analysisQueue = Promise.resolve();
    let offense = [], offenseTime = null, suggestion = null;
    let saving = Promise.resolve();
    const saveErrors = new Map();
    const saveKey = value => value.highlightKey || value;
    let photoRevision = 0;
    const track = () => clip?.highlights?.[angle];
    const start = () => (angle === 'sideline' ? clip.aStart : clip.bStart) + clip.trim;
    const end = () => (angle === 'sideline' ? clip.aStart : clip.bStart) + clip.len;
    const time = () => video.currentTime;
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
        clip.highlights[angle] = { ...T.defaults(options.defaults()), name: '', id: null, points: [], snap: null };
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
      $('snap').max = clip ? clip.len - clip.trim : 0;
      $('offense-count').textContent = `${offense.length} offensive targets marked`;
      $('accept-snap').disabled = !suggestion;
      $('suggestion').textContent = suggestion
        ? `Suggested snap: ${(suggestion.time - start()).toFixed(2)}s (${suggestion.confidence} relative confidence; ${suggestion.players} marked offensive targets). Review before accepting.`
        : 'No snap suggestion. Mark at least 3 stationary offensive players on the same pre-snap frame, then run tracking.';
      const points = value.points || [];
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
    function draw() {
      if (!clip || video.readyState < 2) return;
      canvas.width = 960;
      canvas.height = Math.round(960 * video.videoHeight / video.videoWidth);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const value = track(), t = time();
      const p = value && T.position(value.points, t);
      $('preview-state').textContent = !value ? 'No player highlight enabled.'
        : value.mode === 'presnap' && value.snap === null ? 'Set or confirm the snap to preview a pre-snap highlight.'
          : !T.visible(value, t) ? 'Highlight hidden: this frame is at or after the configured snap.'
            : !p ? 'Untracked frame. Click the player here to track from this frame.'
              : value.points.length === 1 ? job?.value === value ? 'Position placed. Tracking in the background; you can keep using the preview.'
                : 'Position placed only. Click the player to track again.'
                : 'Showing a saved tracked position. Review that the circle stays on the intended player.';
      if (value && T.visible(value, t)) {
        if (p) {
          const image = graphic(value, options.appearance(), canvas.width, photo);
          ctx.drawImage(image.canvas, p.x * canvas.width - image.anchorX, p.y * canvas.height - image.anchorY);
        }
      }
      if (offenseTime !== null && Math.abs(t - offenseTime) < 0.06) {
        ctx.strokeStyle = '#ffffff';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        offense.forEach((p, index) => {
          ctx.strokeRect(p.x * canvas.width - 6, p.y * canvas.height - 6, 12, 12);
          ctx.fillText(String(index + 1), p.x * canvas.width + 9, p.y * canvas.height);
        });
      }
      $('time').value = Math.max(0, time() - start());
      $('time-label').textContent = `${Math.max(0, time() - start()).toFixed(2)} / ${(end() - start()).toFixed(2)}s`;
    }
    function stopPlayback() { video.pause(); $('play').textContent = 'Play preview'; }
    function seek(relative) {
      stopPlayback();
      const target = Math.min(end() - 0.001, Math.max(start(), start() + relative));
      if (offenseTime !== null && Math.abs(target - offenseTime) > 0.06) {
        offense = [];
        offenseTime = null;
        syncControls();
      }
      video.currentTime = target;
    }
    video.addEventListener('seeked', draw);
    video.addEventListener('loadedmetadata', () => { if (clip) seek(0); });
    video.addEventListener('error', () => status('Highlight preview could not open this film.', true));
    video.addEventListener('timeupdate', () => { if (clip && time() >= end() - 0.05) stopPlayback(); draw(); });
    function animate() {
      if (video.paused) return;
      draw();
      requestAnimationFrame(animate);
    }
    $('play').addEventListener('click', () => {
      if (!video.paused) { stopPlayback(); return; }
      if (time() >= end() - 0.1) video.currentTime = start();
      video.play().then(() => { $('play').textContent = 'Pause preview'; animate(); })
        .catch(error => status(`Preview failed: ${error.message}`, true));
    });
    $('time').addEventListener('input', () => seek(Number($('time').value)));
    $('back').addEventListener('click', () => seek(time() - start() - 1 / clip.fps));
    $('forward').addEventListener('click', () => seek(time() - start() + 1 / clip.fps));
    $('review-stop').addEventListener('click', () => {
      const last = track()?.points.findLast(p => p.t >= start() && p.t < end());
      if (!last) return;
      seek(last.t - start());
      status('This is the last tracked frame. Step forward to a clear view and click the same player to resume background tracking. Earlier tracked positions are kept.');
    });
    canvas.addEventListener('click', event => {
      if (!clip || options.isClean() || video.readyState < 2) return;
      stopPlayback();
      const bounds = canvas.getBoundingClientRect();
      const p = { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
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
      const player = options.players(clip).find(p => p.id === $('player').value);
      const value = ensureTrack();
      value.id = player?.id || null;
      value.name = player?.name || '';
      syncControls(); persist(); loadPhoto(); draw();
    });
    function setSnap(value) {
      ensureTrack().snap = value;
      syncControls(); persist(); draw();
    }
    $('snap').addEventListener('change', () => {
      const value = $('snap').valueAsNumber;
      if ($('snap').value === '') setSnap(null);
      else if (Number.isFinite(value) && value >= 0 && value <= end() - start()) setSnap(start() + value);
      else { syncControls(); status('Snap must be inside this retained clip.', true); }
    });
    $('set-snap').addEventListener('click', () => setSnap(time()));
    $('accept-snap').addEventListener('click', () => { if (suggestion) setSnap(suggestion.time); });
    $('clear-track').addEventListener('click', () => {
      cancelForCurrentTrack();
      if (clip.highlights) delete clip.highlights[angle];
      suggestion = null; photo = null; photoKey = '';
      syncControls(); persist(); draw();
    });
    $('defaults').addEventListener('click', async () => {
      try { await options.saveDefaults(T.defaults(track() || options.defaults())); status('Highlight display defaults saved. Existing clips are unchanged.'); }
      catch (error) { status(`Defaults could not be saved: ${error.message}`, true); }
    });
    async function loadPhoto() {
      const key = track()?.showPhoto ? track()?.id : null;
      if (key === photoKey) return;
      const token = ++photoRevision;
      photoKey = key;
      photo = null;
      if (!key) { draw(); return; }
      try {
        const [result] = await window.api.getHeadshots([key]);
        if (token !== photoRevision) return;
        if (!result?.dataUrl) throw new Error(result?.warning || 'No headshot available for this player.');
        const image = new Image();
        image.src = result.dataUrl;
        await image.decode();
        if (token !== photoRevision) return;
        photo = options.preparePhoto(image); draw();
      } catch (error) {
        if (token === photoRevision) { photoKey = ''; status(`Headshot unavailable: ${error.message}. Name and circle remain available.`, true); }
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
    $('angle').addEventListener('change', () => select(clip));

    function select(next) {
      stopPlayback();
      if (next && job && saveKey(next) === saveKey(job.clip)) next.highlights = job.clip.highlights;
      clip = next;
      angle = $('angle').value;
      offense = []; offenseTime = null; suggestion = null;
      photo = null; photoKey = ''; photoRevision++;
      $('editor').hidden = !clip;
      if (!clip) return;
      $('time').max = clip.len - clip.trim;
      $('time').value = 0;
      $('time').step = 1 / clip.fps;
      $('player').replaceChildren(new Option('Custom name / no roster identity', ''));
      for (const p of options.players(clip)) $('player').add(new Option(`${p.team || ''} ${p.number ? '#' + p.number : ''} ${p.name || p.id}`, p.id));
      $('player').value = track()?.id || '';
      syncControls(); setBusy(busy);
      if (video.src !== clip.url) video.src = clip.url;
      else seek(0);
      status(busy ? 'Tracking continues in the background. You can preview, edit, or close Share.'
        : 'Click the player on the film to start background tracking or correct from this frame.');
      loadPhoto();
    }

    return {
      select,
      busy: () => busy,
      pause: stopPlayback,
      refresh: () => { $('controls').disabled = !clip || options.isClean(); draw(); },
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
            const image = graphic(value, appearance, geometry.w, images.get(value.id));
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
