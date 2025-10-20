const App = (() => {
  const state = {
    ctx: null,
    eq: null,
    analyser: null,
    viz: null,
    audioA: null,
    audioB: null,
    sourceA: null,
    sourceB: null,
    gainA: null,
    gainB: null,
    master: null,
    recordingDest: null,
    recorder: null,
    useA: true,
    crossfade: 1.8,
    library: [],
    currentIndex: -1,
    currentTrack: null,
    shuffle: false,
    repeat: false,
    timerInterval: null,
    // active/inactive references for reliable play/pause control
    activeAudio: null,
    inactiveAudio: null,
    activeGain: null,
    inactiveGain: null,
    };

  async function init() {
    try {
      await API.init();
    } catch (e) {
      console.warn('API init failed, continuing without session', e);
      try { if (window.BUG) BUG.warn('API.init failed', e); } catch (_) {}
    }

    // Ensure debug panel is visible
    try { if (window.BUG) { BUG.show(); BUG.log('App.init'); } } catch (_) {}

    // Defer AudioContext creation to first user gesture (mobile autoplay policy)
    bindUI();
    await loadLibrary();
    try { if (typeof PlaylistUI !== 'undefined') PlaylistUI.init({ playTrack, getCurrentTrack: () => state.currentTrack }); } catch (_) {}

    // Default slider value; actual volume applied once AudioContext is created
    document.getElementById('volume').value = 0.9;

    // Status updater
    try {
      if (state.timerInterval) clearInterval(state.timerInterval);
      state.timerInterval = setInterval(updateStatus, 1000);
      updateStatus();
    } catch (_) {}
  }

  function ensureAudioContext() {
    if (state.ctx) return;
    try { if (window.BUG) BUG.log('ensureAudioContext'); } catch (_) {}

    state.ctx = new (window.AudioContext || window.webkitAudioContext)();
    state.master = state.ctx.createGain();
    state.eq = new Equalizer(state.ctx);

    // Main analyser (mono mix to destination)
    state.analyser = state.ctx.createAnalyser();
    state.analyser.fftSize = 1024; // lighter FFT for performance
    state.analyser.smoothingTimeConstant = 0.75;

    // Stereo analysers via channel splitter
    state.analyserL = state.ctx.createAnalyser();
    state.analyserR = state.ctx.createAnalyser();
    state.analyserL.fftSize = 1024;
    state.analyserR.fftSize = 1024;
    state.analyserL.smoothingTimeConstant = 0.75;
    state.analyserR.smoothingTimeConstant = 0.75;

    state.splitter = state.ctx.createChannelSplitter(2);

    // Audio chain:
    // sources -> eq -> analyser -> destination
    //                   \\-> splitter -> analyserL/R (for visuals only)
    state.eq.connect(state.analyser);
    state.eq.connect(state.splitter);
    state.analyser.connect(state.ctx.destination);
    state.splitter.connect(state.analyserL, 0);
    state.splitter.connect(state.analyserR, 1);

    // For recording visualizer + audio
    state.recordingDest = state.ctx.createMediaStreamDestination();
    state.eq.output.connect(state.recordingDest);

    // setup audio elements and visualizer
    setupAudioElements();
    const canvas = document.getElementById('viz');
    state.viz = new Visualizer(state.analyser, canvas);
    state.viz.setStereoAnalysers(state.analyserL, state.analyserR);
    // apply current style and colors from UI
    try {
      state.viz.setStyle(document.getElementById('viz-style').value);
      state.viz.setColors(
        document.getElementById('viz-color-1').value,
        document.getElementById('viz-color-2').value
      );
    } catch (_) {}
    // apply tuning defaults from UI
    try {
      state.viz.setRotationSpeed(Number(document.getElementById('viz-rot').value || 0.6));
      state.viz.setDecay(Number(document.getElementById('viz-decay').value || 0.92));
      state.viz.setThickness(Number(document.getElementById('viz-thickness').value || 1));
      const floor = Number(document.getElementById('viz-ring-floor').value || 0.16);
      state.viz.setRingFloor(floor);
      state.viz.setRadialFloor(floor);
      state.viz.setGlowStrength(Number(document.getElementById('viz-glow-strength').value || 12));
      state.viz.setTrailAlpha(Number(document.getElementById('viz-trail-alpha').value || 0.08));
      state.viz.setSpikeScale(Number(document.getElementById('viz-spike-scale').value || 1));
      state.viz.setWaveScale(Number(document.getElementById('viz-wave-scale').value || 1));
    } catch (_) {}
    state.viz.start();

    // Ensure canvas dynamically fits viewport/device orientation
    function adjustCanvas() {
      const canvas = document.getElementById('viz');
      if (!canvas) return;
      canvas.style.width = '100%';
      canvas.style.maxWidth = '100%';
      canvas.style.display = 'block';
      const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
      // Prefer a fraction of viewport height; slightly larger in landscape
      const isLandscape = vw > vh;
      let targetH = isLandscape ? Math.round(Math.min(360, Math.max(140, vh * 0.55)))
                                : Math.round(Math.min(360, Math.max(160, vh * 0.40)));
      canvas.style.height = targetH + 'px';
      try { state.viz && state.viz.resize(); } catch (_) {}
    }
    adjustCanvas();
    window.addEventListener('resize', adjustCanvas);
    try {
      if (window.screen && window.screen.orientation) {
        window.screen.orientation.addEventListener('change', adjustCanvas);
      }
    } catch (_) {}
    try {
      const ro = new ResizeObserver(() => adjustCanvas());
      ro.observe(canvas.parentElement || canvas);
    } catch (_) {}

    // apply initial volume
    setVolume(Number(document.getElementById('volume').value || 0.9));
  }

  function setupAudioElements() {
    state.audioA = new Audio();
    state.audioB = new Audio();
    state.audioA.crossOrigin = 'anonymous';
    state.audioB.crossOrigin = 'anonymous';
    state.audioA.preload = 'metadata';
    state.audioB.preload = 'metadata';

    state.sourceA = state.ctx.createMediaElementSource(state.audioA);
    state.sourceB = state.ctx.createMediaElementSource(state.audioB);

    state.gainA = state.ctx.createGain();
    state.gainB = state.ctx.createGain();
    state.gainA.gain.value = 1;
    state.gainB.gain.value = 0;

    state.sourceA.connect(state.gainA);
    state.sourceB.connect(state.gainB);

    // both flows go into EQ input
    state.gainA.connect(state.eq.input);
    state.gainB.connect(state.eq.input);

    // time update
    state.audioA.addEventListener('timeupdate', updateTime);
    state.audioB.addEventListener('timeupdate', updateTime);

    state.audioA.addEventListener('ended', onEnded);
    state.audioB.addEventListener('ended', onEnded);

    // super logging of audio element events (disabled by default; enable via Debug toggle)
    const logAudioEvents = (label, el) => {
      const events = ['error','stalled','abort','emptied','waiting','canplay','canplaythrough','pause','play','playing','loadedmetadata','loadeddata','timeupdate','ended'];
      events.forEach(ev => {
        el.addEventListener(ev, (e) => {
          try { if (window.DEBUG && window.BUG) BUG.log(`audio:${label}:${ev}`, { currentTime: el.currentTime, src: el.src }); } catch (_) {}
        });
      });
    };
    if (window.DEBUG) {
      logAudioEvents('A', state.audioA);
      logAudioEvents('B', state.audioB);
    }
  }

  async function loadLibrary(rescan = false) {
    try { if (window.BUG) BUG.log('loadLibrary', { rescan }); } catch (_) {}
    try {
      const params = { page: 0, size: 500 };
      if (rescan) params.rescan = 1;
      const data = await API.get('api/library.php', params);
      state.library = data.items || [];
    } catch (err) {
      console.warn('Library load failed:', err);
      try { if (window.BUG) BUG.error('loadLibrary', err); } catch (_) {}
      state.library = [];
    }
    renderLibrary();
  }

  function renderLibrary(list = null) {
    const ul = document.getElementById('library-list');
    ul.innerHTML = '';
    const src = Array.isArray(list) ? list : state.library;
    src.forEach((item, idx) => {
      const li = document.createElement('li');

      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.name;

      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.className = 'btn danger';
      delBtn.title = 'Delete this track';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = window.confirm(`Delete track?
${item.name}`);
        if (!ok) return;
        try {
          const res = await API.post('api/delete.php', { path: item.path });
          if (res.ok) {
            try { if (window.BUG) BUG.log('deleteTrack:list', item.path); } catch (_) {}
            notify(`Deleted ${item.name}`, 'success');
            await loadLibrary(true);
          } else {
            notify(res.error || 'Delete failed', 'error');
          }
        } catch (err) {
          console.error('Delete error', err);
          notify('Delete failed: ' + err.message, 'error');
        }
      });

      li.appendChild(nameSpan);
      li.appendChild(delBtn);
      li.addEventListener('click', () => playIndex(idx));
      ul.appendChild(li);
    });
  }

  function filterLibrary(query) {
    const q = (query || '').toLowerCase();
    if (!q) return renderLibrary();
    const list = state.library.filter(it => (it.name || '').toLowerCase().includes(q));
    renderLibrary(list);
  }

  function playIndex(i) {
    try { if (window.BUG) BUG.log('playIndex', i); } catch (_) {}
    if (i < 0 || i >= state.library.length) return;
    const track = state.library[i];
    state.currentIndex = i;
    playTrack(track);
  }

  function playTrack(track) {
    ensureAudioContext();
    try { if (window.BUG) BUG.log('playTrack', track); } catch (_) {}

    const src = API.resource('assets/music/' + (track.path || ''));

    // Update UI info
    document.getElementById('track-title').textContent = track.name || track.path;
    state.currentTrack = { path: track.path, name: track.name };

    const useA = state.useA;

    const incoming = useA ? state.audioB : state.audioA;
    const outgoing = useA ? state.audioA : state.audioB;
    const incomingGain = useA ? state.gainB : state.gainA;
    const outgoingGain = useA ? state.gainA : state.gainB;

    if (!incoming || !outgoing) return;

    // stop outgoing to avoid play() interrupted by pause()
    try { outgoing.pause(); } catch (_) {}
    incoming.pause();
    incoming.src = src;
    incoming.currentTime = 0;
    incoming.playbackRate = Number(document.getElementById('rate').value || 1);
    incoming.volume = Number(document.getElementById('volume').value || 0.9);

    // resume AudioContext if needed (autoplay policy)
    try {
      if (state.ctx && state.ctx.state === 'suspended') {
        state.ctx.resume().catch(() => {});
      }
    } catch (_) {}

    // Art via jsmediatags if possible
    try {
      jsmediatags.read(src, {
        onSuccess: (tag) => {
          const pic = tag.tags.picture;
          if (pic) {
            const base64 = arrayBufferToBase64(pic.data);
            const url = `data:${pic.format};base64,${base64}`;
            const artEl = document.getElementById('art');
            artEl.style.backgroundImage = `url(${url})`;
            artEl.style.backgroundSize = 'cover';
            if (state.viz) state.viz.setAlbumArt(url);
          } else {
            document.getElementById('art').style.backgroundImage = '';
            if (state.viz) state.viz.setAlbumArt(null);
          }
        },
        onError: () => {
          document.getElementById('art').style.backgroundImage = '';
          if (state.viz) state.viz.setAlbumArt(null);
        }
      });
    } catch (_) { if (state.viz) state.viz.setAlbumArt(null); }

    incoming.addEventListener('loadedmetadata', () => {
      updateTime();
    }, { once: true });

    // resume first, then play
    const resumePromise = (state.ctx && state.ctx.state === 'suspended') ? state.ctx.resume() : Promise.resolve();
    resumePromise.then(() => {
      return incoming.play();
    }).then(() => {
      if (state.ctx) crossfade(incomingGain, outgoingGain, state.crossfade);
      // mark active/inactive for reliable toggling
      state.activeAudio = incoming;
      state.inactiveAudio = outgoing;
      state.activeGain = incomingGain;
      state.inactiveGain = outgoingGain;
      // flip for next track selection
      state.useA = !state.useA;
      document.getElementById('play').textContent = 'Pause';
    }).catch(err => {
      console.error('Playback error', err);
      try { if (window.BUG) BUG.error('playTrack.play', err); } catch (_) {}
    });
  }

  // Advanced time-stretch mode removed due to module compatibility issues with CDN builds.

  function crossfade(inGain, outGain, seconds) {
    if (!state.ctx) return;
    const now = state.ctx.currentTime;
    inGain.gain.cancelScheduledValues(now);
    outGain.gain.cancelScheduledValues(now);

    inGain.gain.setValueAtTime(inGain.gain.value, now);
    outGain.gain.setValueAtTime(outGain.gain.value, now);

    inGain.gain.linearRampToValueAtTime(1.0, now + seconds);
    outGain.gain.linearRampToValueAtTime(0.0, now + seconds);
  }

  function updateTime() {
    const a = state.audioA;
    const b = state.audioB;
    const active = state.useA ? b : a;
    if (!active) return;
    const dur = active.duration || 0;
    const cur = active.currentTime || 0;
    document.getElementById('track-time').textContent = `${API.fmtTime(cur)} / ${API.fmtTime(dur)}`;
    if (state.viz && dur > 0) {
      state.viz.setProgress(cur / dur);
    }
  }

  function updateStatus() {
    try {
      const ctxState = state.ctx ? state.ctx.state : 'inactive';
      const a = state.audioA, b = state.audioB;
      const active = state.activeAudio || (state.useA ? b : a);
      const playing = active ? !active.paused : false;
      const rec = !!state.recorder;
      const track = state.currentTrack ? (state.currentTrack.name || state.currentTrack.path) : 'N/A';
      const layersCount = (document.getElementById('layers-list')?.children?.length) || 0;
      const selected = 'none';
      const beat = false;

      const lines = [
        `AudioContext: ${ctxState}`,
        `Track: ${track}`,
        `Playing: ${playing}`,
        `Recording: ${rec}`,
        `Layers: ${layersCount}`,
        `Selected: ${selected}`,
        `Beat Detected: ${beat}`
      ];
      const pre = document.getElementById('status-info');
      if (pre) pre.textContent = lines.join('\n');
    } catch (err) {
      try { if (window.BUG) BUG.error('updateStatus', err); } catch (_) {}
    }
  }

  function onEnded() {
    try { if (window.BUG) BUG.log('onEnded', { idx: state.currentIndex, repeat: state.repeat, shuffle: state.shuffle }); } catch (_) {}
    if (state.repeat) {
      playIndex(state.currentIndex);
      return;
    }
    let nextIndex = state.currentIndex + 1;
    if (state.shuffle) {
      nextIndex = Math.floor(Math.random() * state.library.length);
    }
    if (nextIndex >= state.library.length) nextIndex = 0;
    playIndex(nextIndex);
  }

  function bindUI() {
    document.getElementById('play').addEventListener('click', async () => {
      ensureAudioContext();
      try { if (window.BUG) BUG.log('playButton'); } catch (_) {}
      // Ensure AudioContext resumed per user gesture
      try { if (state.ctx && state.ctx.state === 'suspended') await state.ctx.resume(); } catch (_) {}

      // If no track selected yet, start with first in library
      if (!state.currentTrack && state.library.length > 0) {
        playIndex(0);
        return;
      }

      const active = state.activeAudio || (state.useA ? state.audioB : state.audioA);
      if (!active) return;
      if (active.paused) {
        active.play().then(() => {
          document.getElementById('play').textContent = 'Pause';
        }).catch(err => {
          console.error('Play toggle error', err);
          try { if (window.BUG) BUG.error('playButton.play', err); } catch (_) {}
        });
      } else {
        try {
          active.pause();
          document.getElementById('play').textContent = 'Play';
        } catch (err) {
          console.error('Pause toggle error', err);
          try { if (window.BUG) BUG.error('playButton.pause', err); } catch (_) {}
        }
      }
    });

    document.getElementById('prev').addEventListener('click', () => {
      let i = state.currentIndex - 1;
      if (i < 0) i = state.library.length - 1;
      playIndex(i);
    });

    document.getElementById('next').addEventListener('click', () => {
      let i = state.currentIndex + 1;
      if (i >= state.library.length) i = 0;
      playIndex(i);
    });

    document.getElementById('shuffle').addEventListener('click', () => {
      state.shuffle = !state.shuffle;
      document.getElementById('shuffle').classList.toggle('primary', state.shuffle);
    });

    document.getElementById('repeat').addEventListener('click', () => {
      state.repeat = !state.repeat;
      document.getElementById('repeat').classList.toggle('primary', state.repeat);
    });

    document.getElementById('volume').addEventListener('input', (e) => {
      setVolume(Number(e.target.value));
    });

    document.getElementById('rate').addEventListener('input', (e) => {
      const r = Number(e.target.value);
      state.audioA.playbackRate = r;
      state.audioB.playbackRate = r;
    });

    const pitchBtn = document.getElementById('pitch-lock');
    if (pitchBtn) {
      pitchBtn.addEventListener('click', () => {
        const on = !pitchBtn.classList.contains('primary');
        setPitchLock(on);
        pitchBtn.classList.toggle('primary', on);
      });
      // default ON
      setPitchLock(true);
      pitchBtn.classList.add('primary');
    }

    document.getElementById('rescan').addEventListener('click', async () => {
      await loadLibrary(true);
      notify('Library refreshed', 'success', 2500);
    });

    document.getElementById('search').addEventListener('input', (e) => {
      filterLibrary(e.target.value);
    });

    const importBtn = document.getElementById('import-url-btn');
    if (importBtn) {
      importBtn.addEventListener('click', async () => {
        const url = (document.getElementById('import-url').value || '').trim();
        if (!url) return;
        const res = await API.post('api/remote_import.php', { url });
        if (!res.ok) {
          notify(res.error || 'Import failed', 'error');
        } else {
          notify('Imported audio from URL', 'success');
          // Force server-side rescan to update index
          try { await API.post('api/library.php', { action: 'rescan' }); } catch (_) {}
        }
        await loadLibrary(true);
      });
    }
    const importBtnMobile = document.getElementById('import-url-btn-mobile');
    if (importBtnMobile) {
      importBtnMobile.addEventListener('click', async () => {
        const url = (document.getElementById('import-url-mobile').value || '').trim();
        if (!url) return;
        const res = await API.post('api/remote_import.php', { url });
        if (!res.ok) {
          notify(res.error || 'Import failed', 'error');
        } else {
          notify('Imported audio from URL', 'success');
          try { await API.post('api/library.php', { action: 'rescan' }); } catch (_) {}
        }
        await loadLibrary(true);
      });
    }

    const up = document.getElementById('upload-input');
    up.addEventListener('change', async () => {
      const files = Array.from(up.files || []);
      try { if (window.BUG) BUG.log('upload.files', files.map(f => ({ name: f.name, size: f.size }))); } catch (_) {}
      let okCount = 0, errCount = 0;
      for (const f of files) {
        try {
          const res = await API.upload('api/upload.php', f);
          try { if (window.BUG) BUG.log('upload.result', res); } catch (_) {}
          if (res.ok) okCount++;
          else { errCount++; notify(res.error || `Upload failed: ${f.name}`, 'error'); }
        } catch (err) {
          console.error('Upload failed', err);
          errCount++;
          notify(`Upload failed: ${f.name}`, 'error');
          try { if (window.BUG) BUG.error('upload.error', err); } catch (_) {}
        }
      }
      // Force server-side rescan to update index
      try { await API.post('api/library.php', { action: 'rescan' }); } catch (_) {}

      await loadLibrary(true);
      if (okCount > 0) notify(`Uploaded ${okCount} file(s)`, 'success');
      if (errCount > 0) notify(`${errCount} upload(s) failed`, 'error');
      up.value = '';
    });
    const upMobile = document.getElementById('upload-input-mobile');
    if (upMobile) {
      upMobile.addEventListener('change', async () => {
        const files = Array.from(upMobile.files || []);
        for (const f of files) {
          const res = await API.upload('api/upload.php', f);
          if (!res.ok) alert(res.error || 'Upload failed');
        }
        await loadLibrary(true);
        upMobile.value = '';
      });
    }

    document.getElementById('viz-style').addEventListener('change', (e) => {
      if (state.viz) state.viz.setStyle(e.target.value);
    });
    document.getElementById('viz-color-1').addEventListener('change', (e) => {
      if (state.viz) state.viz.setColors(e.target.value, document.getElementById('viz-color-2').value);
    });
    document.getElementById('viz-color-2').addEventListener('change', (e) => {
      if (state.viz) state.viz.setColors(document.getElementById('viz-color-1').value, e.target.value);
    });
    const glow = document.getElementById('viz-glow');
    const trail = document.getElementById('viz-trail');
    const art = document.getElementById('viz-art');
    if (glow) glow.addEventListener('change', () => { if (state.viz) state.viz.setGlow(glow.checked); });
    if (trail) trail.addEventListener('change', () => { if (state.viz) state.viz.setTrail(trail.checked); });
    if (art) art.addEventListener('change', () => { if (state.viz) state.viz.setShowArt(art.checked); });

    // tuning controls
    const rot = document.getElementById('viz-rot');
    const dec = document.getElementById('viz-decay');
    const th = document.getElementById('viz-thickness');
    const rf = document.getElementById('viz-ring-floor');
    const gs = document.getElementById('viz-glow-strength');
    const ta = document.getElementById('viz-trail-alpha');
    const ss = document.getElementById('viz-spike-scale');
    const ws = document.getElementById('viz-wave-scale');

    rot.addEventListener('input', e => { if (state.viz) state.viz.setRotationSpeed(Number(e.target.value)); });
    dec.addEventListener('input', e => { if (state.viz) state.viz.setDecay(Number(e.target.value)); });
    th.addEventListener('input', e => { if (state.viz) state.viz.setThickness(Number(e.target.value)); });
    rf.addEventListener('input', e => { if (state.viz) { const v = Number(e.target.value); state.viz.setRingFloor(v); state.viz.setRadialFloor(v); } });
    gs.addEventListener('input', e => { if (state.viz) state.viz.setGlowStrength(Number(e.target.value)); });
    ta.addEventListener('input', e => { if (state.viz) state.viz.setTrailAlpha(Number(e.target.value)); });
    ss.addEventListener('input', e => { if (state.viz) state.viz.setSpikeScale(Number(e.target.value)); });
    ws.addEventListener('input', e => { if (state.viz) state.viz.setWaveScale(Number(e.target.value)); });

    document.getElementById('eq-toggle').addEventListener('click', () => {
      document.getElementById('eq-panel').classList.toggle('show');
    });

    document.getElementById('eq-preset').addEventListener('change', (e) => {
      state.eq.setPreset(e.target.value);
    });
    document.querySelectorAll('#eq-panel input[type="range"]').forEach(sl => {
      sl.addEventListener('input', (e) => {
        const i = Number(e.target.dataset.band);
        const v = Number(e.target.value);
        state.eq.setGain(i, v);
      });
    });

    document.getElementById('record').addEventListener('click', () => toggleRecording());

    // Snapshot
    const snapBtn = document.getElementById('snapshot');
    if (snapBtn) {
      snapBtn.addEventListener('click', () => {
        const canvas = document.getElementById('viz');
        if (!canvas) return;
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = 'visualizer.png';
        a.click();
      });
    }

    // Choose audio files: forwards click to upload input
    const chooseBtn = document.getElementById('choose-audio');
    if (chooseBtn) {
      chooseBtn.addEventListener('click', () => {
        const up = document.getElementById('upload-input');
        if (up) up.click();
      });
    }

    // Save/Load Project (simple JSON of visualizer+EQ settings)
    const saveProj = document.getElementById('save-project');
    const loadProj = document.getElementById('load-project');
    const loadInp = document.getElementById('load-project-input');

    function collectProject() {
      const proj = {
        viz: {
          style: document.getElementById('viz-style').value,
          colors: [document.getElementById('viz-color-1').value, document.getElementById('viz-color-2').value],
          glow: document.getElementById('viz-glow').checked,
          trail: document.getElementById('viz-trail').checked,
          art: document.getElementById('viz-art').checked,
          tuning: {
            rotation: Number(document.getElementById('viz-rot').value || 0),
            decay: Number(document.getElementById('viz-decay').value || 0.9),
            thickness: Number(document.getElementById('viz-thickness').value || 1),
            floor: Number(document.getElementById('viz-ring-floor').value || 0.16),
            glowStrength: Number(document.getElementById('viz-glow-strength').value || 12),
            trailAlpha: Number(document.getElementById('viz-trail-alpha').value || 0.08),
            spikeScale: Number(document.getElementById('viz-spike-scale').value || 1),
            waveScale: Number(document.getElementById('viz-wave-scale').value || 1),
          }
        },
        eqPreset: document.getElementById('eq-preset').value,
        track: state.currentTrack || null
      };
      return proj;
    }

    function applyProject(proj) {
      try {
        document.getElementById('viz-style').value = proj.viz.style;
        document.getElementById('viz-color-1').value = proj.viz.colors[0];
        document.getElementById('viz-color-2').value = proj.viz.colors[1];
        document.getElementById('viz-glow').checked = !!proj.viz.glow;
        document.getElementById('viz-trail').checked = !!proj.viz.trail;
        document.getElementById('viz-art').checked = !!proj.viz.art;
        document.getElementById('viz-rot').value = proj.viz.tuning.rotation;
        document.getElementById('viz-decay').value = proj.viz.tuning.decay;
        document.getElementById('viz-thickness').value = proj.viz.tuning.thickness;
        document.getElementById('viz-ring-floor').value = proj.viz.tuning.floor;
        document.getElementById('viz-glow-strength').value = proj.viz.tuning.glowStrength;
        document.getElementById('viz-trail-alpha').value = proj.viz.tuning.trailAlpha;
        document.getElementById('viz-spike-scale').value = proj.viz.tuning.spikeScale;
        document.getElementById('viz-wave-scale').value = proj.viz.tuning.waveScale;
        document.getElementById('eq-preset').value = proj.eqPreset;

        // Apply to live visualizer/equalizer
        if (state.viz) {
          state.viz.setStyle(proj.viz.style);
          state.viz.setColors(proj.viz.colors[0], proj.viz.colors[1]);
          state.viz.setGlow(!!proj.viz.glow);
          state.viz.setTrail(!!proj.viz.trail);
          state.viz.setShowArt(!!proj.viz.art);
          state.viz.setRotationSpeed(Number(proj.viz.tuning.rotation));
          state.viz.setDecay(Number(proj.viz.tuning.decay));
          state.viz.setThickness(Number(proj.viz.tuning.thickness));
          const floor = Number(proj.viz.tuning.floor);
          state.viz.setRingFloor(floor);
          state.viz.setRadialFloor(floor);
          state.viz.setGlowStrength(Number(proj.viz.tuning.glowStrength));
          state.viz.setTrailAlpha(Number(proj.viz.tuning.trailAlpha));
          state.viz.setSpikeScale(Number(proj.viz.tuning.spikeScale));
          state.viz.setWaveScale(Number(proj.viz.tuning.waveScale));
        }
        if (state.eq) state.eq.setPreset(proj.eqPreset);

        if (proj.track && proj.track.path) {
          // Attempt to load the same track
          const item = state.library.find(it => it.path === proj.track.path);
          if (item) playTrack(item);
        }
        notify('Project loaded', 'success');
      } catch (err) {
        notify('Failed to apply project: ' + err.message, 'error');
      }
    }

    if (saveProj) {
      saveProj.addEventListener('click', () => {
        const proj = collectProject();
        const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'visualizer-project.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      });
    }
    if (loadProj && loadInp) {
      loadProj.addEventListener('click', () => loadInp.click());
      loadInp.addEventListener('change', async () => {
        const f = loadInp.files[0];
        if (!f) return;
        try {
          const text = await f.text();
          const proj = JSON.parse(text);
          applyProject(proj);
        } catch (err) {
          notify('Failed to load project: ' + err.message, 'error');
        } finally {
          loadInp.value = '';
        }
      });
    }

    const delBtn = document.getElementById('delete-track');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (!state.currentTrack || !state.currentTrack.path) return;
        const ok = window.confirm(`Delete current track?
${state.currentTrack.name || state.currentTrack.path}`);
        if (!ok) return;
        try {
          const res = await API.post('api/delete.php', { path: state.currentTrack.path });
          if (res.ok) {
            try { if (window.BUG) BUG.log('deleteTrack', state.currentTrack.path); } catch (_) {}
            // stop playback, clear src/art
            try { state.audioA.pause(); state.audioA.src = ''; } catch (_) {}
            try { state.audioB.pause(); state.audioB.src = ''; } catch (_) {}
            document.getElementById('art').style.backgroundImage = '';
            notify('Track deleted', 'success');
            state.currentTrack = null;
            document.getElementById('track-title').textContent = '—';
            document.getElementById('track-time').textContent = '0:00 / 0:00';
            document.getElementById('play').textContent = 'Play';
            await loadLibrary(true);
          } else {
            notify(res.error || 'Delete failed', 'error');
          }
        } catch (err) {
          console.error('Delete error', err);
          notify('Delete failed: ' + err.message, 'error');
        }
      });
    }
  }

  function setVolume(v) {
    // control via element volume plus master gain
    const active = state.activeAudio || (state.useA ? state.audioB : state.audioA);
    if (active) active.volume = v;
    if (state.audioA) state.audioA.volume = v;
    if (state.audioB) state.audioB.volume = v;
    state.master && (state.master.gain.value = v);
  }

  function toggleRecording() {
    if (state.recorder) {
      state.recorder.stop();
      state.recorder = null;
      document.getElementById('record').textContent = 'Record';
      notify('Recording saved (WebM downloaded)', 'success', 2500);
      return;
    }
    const canvas = document.getElementById('viz');
    const canvasStream = canvas.captureStream(30);
    const audioStream = state.recordingDest.stream;
    const mixed = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioStream.getAudioTracks()
    ]);
    const rec = new MediaRecorder(mixed, { mimeType: 'video/webm;codecs=vp9,opus' });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'visualizer.webm';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    rec.start();
    state.recorder = rec;
    document.getElementById('record').textContent = 'Stop';
    notify('Recording started', 'info', 1800);
  }

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  function setPitchLock(on) {
    const props = ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch'];
    for (const p of props) {
      try { state.audioA[p] = on; } catch (_) {}
      try { state.audioB[p] = on; } catch (_) {}
    }
  }

  function getCurrentTrack() {
    return state.currentTrack;
  }

  function notify(msg, type = 'info', timeout = 3000) {
    if (typeof Toast !== 'undefined') {
      Toast.show(String(msg), type, timeout);
    } else {
      console.log(`[toast:${type}]`, msg);
    }
  }

  return { init, playTrack, state, getCurrentTrack, loadLibrary };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init().then(() => {
    if (typeof Settings !== 'undefined') Settings.init();
    if (typeof Cloud !== 'undefined') Cloud.init();
  }).catch(err => console.error(err));
});