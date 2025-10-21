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
    // UI mode
    orientation: 'auto', // 'auto' | 'portrait' | 'landscape'
    theme: 'dark'
    };

  async function init() {
    // Ensure audio debug disabled unless explicitly enabled
    try { if (typeof window.AUDIO_DEBUG === 'undefined') window.AUDIO_DEBUG = false; } catch (_) {}

    try {
      await API.init();
    } catch (e) {
      console.warn('API init failed, continuing without session', e);
      try { if (window.BUG) BUG.warn('API.init failed', e); } catch (_) {}
    }

    // Ensure debug panel is visible
    try { if (window.BUG) { BUG.show(); BUG.log('App.init'); } } catch (_) {}

    // Create AudioContext immediately so visualizer shows (audio won't play until user interacts)
    bindUI();
    ensureAudioContext();
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
    // default to flat emphasis for uniform ring/spike heights without tuning
    try { if (state.viz.setEmphasisMode) state.viz.setEmphasisMode('flat'); } catch (_) {}
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
      const ringFloor = Number(document.getElementById('viz-ring-floor').value || 0.16);
      const radialFloor = Number(document.getElementById('viz-radial-floor').value || ringFloor);
      state.viz.setRingFloor(ringFloor);
      state.viz.setRadialFloor(radialFloor);
      state.viz.setGlowStrength(Number(document.getElementById('viz-glow-strength').value || 12));
      state.viz.setTrailAlpha(Number(document.getElementById('viz-trail-alpha').value || 0.08));
      state.viz.setSpikeScale(Number(document.getElementById('viz-spike-scale').value || 1));
      state.viz.setWaveScale(Number(document.getElementById('viz-wave-scale').value || 1));
      if (typeof state.viz.setSegments === 'function') state.viz.setSegments(Number(document.getElementById('viz-segments').value || 4));
      // beat tuning defaults
      if (typeof state.viz.setBeatSensitivity === 'function') state.viz.setBeatSensitivity(Number(document.getElementById('viz-beat-sense').value || 1));
      if (typeof state.viz.setBeatBoost === 'function') state.viz.setBeatBoost(Number(document.getElementById('viz-beat-boost').value || 1));
      if (typeof state.viz.setBeatThreshold === 'function') state.viz.setBeatThreshold(Number(document.getElementById('viz-beat-thresh').value || 0.08));
      if (typeof state.viz.setBeatDecay === 'function') state.viz.setBeatDecay(Number(document.getElementById('viz-beat-decay').value || 0.90));
      if (typeof state.viz.setBeatSource === 'function') state.viz.setBeatSource((document.getElementById('viz-beat-src')?.value) || 'avg');
      if (typeof state.viz.setBeatHoldMs === 'function') state.viz.setBeatHoldMs(Number(document.getElementById('viz-beat-hold')?.value || 120));
      if (typeof state.viz.setPulseWidth === 'function') state.viz.setPulseWidth(Number(document.getElementById('viz-pulse-w')?.value || 1));
      if (typeof state.viz.setBpmEnabled === 'function') state.viz.setBpmEnabled(!!document.getElementById('viz-bpm')?.checked);
      if (typeof state.viz.setStylePresets === 'function') state.viz.setStylePresets(!!document.getElementById('viz-style-presets')?.checked);
      // emphasis and smoothing
      if (typeof state.viz.setEmphasis === 'function') state.viz.setEmphasis(
        Number(document.getElementById('viz-low-gain').value || 1),
        Number(document.getElementById('viz-mid-gain').value || 1),
        Number(document.getElementById('viz-high-gain').value || 1)
      );
      if (typeof state.viz.setEmphasisMode === 'function') state.viz.setEmphasisMode((document.getElementById('viz-emphasis-mode')?.value) || 'flat');
      if (typeof state.viz.setSmoothing === 'function') state.viz.setSmoothing(Number(document.getElementById('viz-smooth').value || 0.75));
      if (typeof state.viz.setPerformanceMode === 'function') {
        const perfOn = !!document.getElementById('viz-perf')?.checked;
        state.viz.setPerformanceMode(perfOn);
        // adjust analyser FFT sizes dynamically
        const fft = perfOn ? 512 : 1024;
        const smooth = perfOn ? 0.7 : 0.75;
        state.analyser.fftSize = fft;
        state.analyserL.fftSize = fft;
        state.analyserR.fftSize = fft;
        state.analyser.smoothingTimeConstant = smooth;
        state.analyserL.smoothingTimeConstant = smooth;
        state.analyserR.smoothingTimeConstant = smooth;
      }
    } catch (_) {}
    // initialize layer stack with current style
    try {
      const initStyle = document.getElementById('viz-style').value;
      state.viz.addLayer(initStyle, {
        color1: document.getElementById('viz-color-1').value,
        color2: document.getElementById('viz-color-2').value,
        rotation: Number(document.getElementById('viz-rot').value || 0.6),
        thickness: Number(document.getElementById('viz-thickness').value || 1),
        ringFloor: Number(document.getElementById('viz-ring-floor').value || 0.16),
        radialFloor: Number(document.getElementById('viz-radial-floor').value || 0.16),
        spikeScale: Number(document.getElementById('viz-spike-scale').value || 1),
        waveScale: Number(document.getElementById('viz-wave-scale').value || 1),
        segments: Number(document.getElementById('viz-segments').value || 4)
      });
      state.viz.selectLayer(0);
      renderLayersUI();
    } catch (_) {}

    state.viz.start();

    reflowCanvas();

    try { updateTuningVisibility(document.getElementById('viz-style').value); } catch (_) {}
    try { populateStyleTemplates(document.getElementById('viz-style').value); } catch (_) {}

    window.addEventListener('resize', reflowCanvas);
    try {
      if (window.screen && window.screen.orientation) {
        window.screen.orientation.addEventListener('change', reflowCanvas);
      }
    } catch (_) {}

    setVolume(Number(document.getElementById('volume').value || 0.9));
  }

  // Canvas reflow obeying orientation setting
  function reflowCanvas() {
    const canvas = document.getElementById('viz');
    if (!canvas) return;
    canvas.style.width = '100%';
    canvas.style.maxWidth = '100%';
    canvas.style.display = 'block';
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    let isLandscape;
    if (state.orientation === 'landscape') isLandscape = true;
    else if (state.orientation === 'portrait') isLandscape = false;
    else isLandscape = vw > vh;

    // Portrait should be taller; Landscape more compact
    const portraitRatio = 0.65;
    const landscapeRatio = 0.45;

    let targetH = isLandscape
      ? Math.round(Math.min(420, Math.max(140, vh * landscapeRatio)))
      : Math.round(Math.min(480, Math.max(160, vh * portraitRatio)));

    canvas.style.height = targetH + 'px';
    try { state.viz && state.viz.resize(); } catch (_) {}
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
    if (window.AUDIO_DEBUG) {
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
      const selected = (state.viz && state.viz.sel >= 0) ? String(state.viz.sel) : 'none';
      const beatLevel = state.viz ? Number(state.viz.beatLevel || 0).toFixed(2) : '0.00';
      const bpm = state.viz && state.viz.bpmEnabled ? (state.viz.bpm || '—') : '—';

      const lines = [
        `AudioContext: ${ctxState}`,
        `Track: ${track}`,
        `Playing: ${playing}`,
        `Recording: ${rec}`,
        `Layers: ${layersCount}`,
        `Selected: ${selected}`,
        `Beat Level: ${beatLevel}`,
        `BPM: ${bpm}`
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

  // Throttled action logger
  const throttles = {};
  function logAction(name, data = {}, key = null, interval = 200) {
    try {
      if (!window.BUG || !window.DEBUG) return;
      if (key) {
        const now = performance.now();
        const last = throttles[key] || 0;
        if (now - last < interval) return;
        throttles[key] = now;
      }
      BUG.log(name, data);
    } catch (_) {}
  }

  // Show/hide tuning controls per visualizer style to avoid confusion
  function updateTuningVisibility(style) {
    const s = (style || document.getElementById('viz-style')?.value || 'bars').toLowerCase();
    const mode = (document.getElementById('viz-emphasis-mode')?.value || 'flat').toLowerCase();

    const SHOW = new Set();
    const ALL = [
      'viz-rot','viz-decay','viz-thickness','viz-ring-floor','viz-radial-floor',
      'viz-glow-strength','viz-trail-alpha','viz-spike-scale','viz-wave-scale','viz-segments',
      'viz-beat-sense','viz-beat-boost','viz-beat-thresh','viz-beat-decay',
      'viz-beat-src','viz-beat-hold','viz-pulse-w',
      'viz-emphasis-mode','viz-low-gain','viz-mid-gain','viz-high-gain','viz-smooth'
    ];

    function show(ids) { ids.forEach(id => SHOW.add(id)); }
    function setVisible(id, on) {
      const el = document.getElementById(id);
      if (!el) return;
      const lab = el.closest('label') || el.parentElement;
      if (lab) lab.style.display = on ? '' : 'none';
    }

    // Define per-style applicability (baseline)
    if (s === 'bars') {
      show(['viz-decay','viz-thickness','viz-radial-floor','viz-glow-strength','viz-trail-alpha','viz-emphasis-mode','viz-smooth']);
    } else if (s === 'mirror') {
      show(['viz-decay','viz-thickness','viz-radial-floor','viz-glow-strength','viz-trail-alpha','viz-emphasis-mode','viz-smooth']);
    } else if (s === 'wave') {
      show(['viz-thickness','viz-wave-scale','viz-glow-strength','viz-trail-alpha','viz-smooth']);
    } else if (s === 'ring') {
      show(['viz-rot','viz-thickness','viz-wave-scale','viz-segments','viz-glow-strength','viz-trail-alpha','viz-smooth']);
    } else if (s === 'radial') {
      show([
        'viz-rot','viz-decay','viz-thickness','viz-radial-floor','viz-glow-strength','viz-trail-alpha',
        'viz-segments',
        'viz-beat-sense','viz-beat-boost','viz-beat-thresh','viz-beat-decay','viz-beat-src','viz-beat-hold','viz-pulse-w',
        'viz-emphasis-mode','viz-smooth'
      ]);
    } else if (s === 'particles') {
      show(['viz-thickness','viz-glow-strength','viz-trail-alpha','viz-segments','viz-beat-sense','viz-beat-boost','viz-beat-thresh','viz-beat-decay','viz-beat-src','viz-beat-hold','viz-pulse-w','viz-smooth']);
    } else { // circle (default)
      show(['viz-rot','viz-decay','viz-thickness','viz-ring-floor','viz-glow-strength','viz-spike-scale','viz-segments','viz-emphasis-mode','viz-smooth']);
    }

    // Emphasis sliders only when mode = weighted and supported by style
    const emphasisSupported = (s === 'bars' || s === 'mirror' || s === 'radial' || s === 'circle');
    if (emphasisSupported && mode === 'weighted') {
      show(['viz-low-gain','viz-mid-gain','viz-high-gain']);
    }

    // apply visibility
    ALL.forEach(id => setVisible(id, SHOW.has(id)));

    // Some checkboxes in viz-options could be style-specific: Trail not used for circle
    const trail = document.getElementById('viz-trail');
    if (trail) {
      const lab = trail.closest('label') || trail.parentElement;
      if (lab) lab.style.display = (s === 'circle') ? 'none' : '';
    }
    const bpmToggle = document.getElementById('viz-bpm');
    if (bpmToggle) {
      const lab = bpmToggle.closest('label') || bpmToggle.parentElement;
      if (lab) lab.style.display = (s === 'radial' || s === 'particles') ? '' : 'none';
    }
  }

  // Built-in style templates (per visualizer style)
  const STYLE_TEMPLATES = {
    circle: [
      { name: 'Circle Spikes', params: {
        rot: 0.55, decay: 0.92, thickness: 1.2, ringFloor: 0.18, spikeScale: 1.2,
        lowGain: 1.0, midGain: 1.0, highGain: 1.15, smoothing: 0.75
      }},
      { name: 'Circle Smooth', params: {
        rot: 0.35, decay: 0.95, thickness: 1.4, ringFloor: 0.20, spikeScale: 0.95,
        lowGain: 1.05, midGain: 1.0, highGain: 1.05, smoothing: 0.80
      }}
    ],
    radial: [
      { name: 'Radial Glow', params: {
        rot: 0.7, decay: 0.92, thickness: 1.25, radialFloor: 0.18,
        beatSense: 1.10, beatBoost: 1.20, beatThreshold: 0.08, beatDecay: 0.90,
        beatSource: 'avg', beatHoldMs: 120, pulseWidth: 1.10,
        lowGain: 1.1, midGain: 1.0, highGain: 1.1, smoothing: 0.75
      }},
      { name: 'Radial Punchy', params: {
        rot: 0.85, decay: 0.90, thickness: 1.35, radialFloor: 0.16,
        beatSense: 1.25, beatBoost: 1.30, beatThreshold: 0.10, beatDecay: 0.88,
        beatSource: 'low', beatHoldMs: 150, pulseWidth: 1.2,
        lowGain: 1.2, midGain: 0.95, highGain: 1.05, smoothing: 0.72
      }}
    ],
    ring: [
      { name: 'Ring Wave Smooth', params: {
        rot: 0.40, thickness: 1.6, waveScale: 1.20, smoothing: 0.80
      }},
      { name: 'Ring Wave Punchy', params: {
        rot: 0.65, thickness: 1.3, waveScale: 1.35, smoothing: 0.70
      }}
    ],
    bars: [
      { name: 'Bars EQ', params: {
        decay: 0.92, thickness: 1.2, radialFloor: 0.14,
        lowGain: 1.2, midGain: 1.0, highGain: 1.1, smoothing: 0.75
      }},
      { name: 'Bars Calm', params: {
        decay: 0.95, thickness: 1.0, radialFloor: 0.16,
        lowGain: 1.05, midGain: 1.0, highGain: 1.05, smoothing: 0.82
      }}
    ],
    mirror: [
      { name: 'Mirror EQ', params: {
        decay: 0.92, thickness: 1.2, radialFloor: 0.14,
        lowGain: 1.2, midGain: 1.0, highGain: 1.1, smoothing: 0.75
      }},
      { name: 'Mirror Calm', params: {
        decay: 0.95, thickness: 1.0, radialFloor: 0.16,
        lowGain: 1.05, midGain: 1.0, highGain: 1.05, smoothing: 0.82
      }}
    ],
    particles: [
      { name: 'Particles Orbit', params: {
        thickness: 1.0,
        beatSense: 1.0, beatBoost: 1.2, beatThreshold: 0.10, beatDecay: 0.90,
        beatSource: 'avg', beatHoldMs: 140, pulseWidth: 1.2, smoothing: 0.75
      }},
      { name: 'Particles Spark', params: {
        thickness: 1.1,
        beatSense: 1.2, beatBoost: 1.3, beatThreshold: 0.12, beatDecay: 0.88,
        beatSource: 'high', beatHoldMs: 160, pulseWidth: 1.3, smoothing: 0.72
      }}
    ]
  };

  function populateStyleTemplates(style) {
    const sel = document.getElementById('style-template');
    if (!sel) return;
    const list = STYLE_TEMPLATES[String(style || '').toLowerCase()] || [];
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— None —';
    sel.appendChild(none);
    for (const t of list) {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = t.name;
      sel.appendChild(opt);
    }
    sel.value = '';
  }

  function applyStyleTemplate(name) {
    const style = document.getElementById('viz-style')?.value || 'bars';
    const list = STYLE_TEMPLATES[String(style).toLowerCase()] || [];
    const tpl = list.find(t => t.name === name);
    if (!tpl) return;
    const p = tpl.params || {};

    // helper: set element and dispatch event to reuse existing handlers
    function setInput(id, value, ev = 'input') {
      const el = document.getElementById(id);
      if (!el || typeof value === 'undefined') return;
      el.value = String(value);
      el.dispatchEvent(new Event(ev, { bubbles: true }));
    }

    // apply numeric/select params
    setInput('viz-rot', p.rot);
    setInput('viz-decay', p.decay);
    setInput('viz-thickness', p.thickness);
    setInput('viz-ring-floor', p.ringFloor);
    setInput('viz-radial-floor', p.radialFloor);
    setInput('viz-glow-strength', p.glowStrength);
    setInput('viz-trail-alpha', p.trailAlpha);
    setInput('viz-spike-scale', p.spikeScale);
    setInput('viz-wave-scale', p.waveScale);
    setInput('viz-beat-sense', p.beatSense);
    setInput('viz-beat-boost', p.beatBoost);
    setInput('viz-beat-thresh', p.beatThreshold);
    setInput('viz-beat-decay', p.beatDecay);
    setInput('viz-beat-hold', p.beatHoldMs);
    setInput('viz-pulse-w', p.pulseWidth);
    setInput('viz-low-gain', p.lowGain);
    setInput('viz-mid-gain', p.midGain);
    setInput('viz-high-gain', p.highGain);
    setInput('viz-smooth', p.smoothing);

    // beat source select uses change
    if (typeof p.beatSource !== 'undefined') setInput('viz-beat-src', p.beatSource, 'change');

    logAction('viz.template.apply', { style, name });
    // ensure visibility after applying
    try { updateTuningVisibility(style); } catch (_) {}
  }

  function bindUI() {

    

    document.getElementById('play').addEventListener('click', async () => {
      ensureAudioContext();
      logAction('player.playButton');
      // Ensure AudioContext resumed per user gesture
      try { if (state.ctx && state.ctx.state === 'suspended') await state.ctx.resume(); } catch (_) {}

      // If no track selected yet, start with first in library
      if (!state.currentTrack && state.library.length > 0) {
        logAction('player.autoplayFirst');
        playIndex(0);
        return;
      }

      const active = state.activeAudio || (state.useA ? state.audioB : state.audioA);
      if (!active) return;
      if (active.paused) {
        active.play().then(() => {
          document.getElementById('play').textContent = 'Pause';
          const bnPlay = document.getElementById('bn-play'); if (bnPlay) bnPlay.classList.add('primary');
          logAction('player.play');
        }).catch(err => {
          console.error('Play toggle error', err);
          logAction('player.play.error', { message: err.message });
        });
      } else {
        try {
          active.pause();
          document.getElementById('play').textContent = 'Play';
          const bnPlay = document.getElementById('bn-play'); if (bnPlay) bnPlay.classList.remove('primary');
          logAction('player.pause');
        } catch (err) {
          console.error('Pause toggle error', err);
          logAction('player.pause.error', { message: err.message });
        }
      }
    });

    document.getElementById('prev').addEventListener('click', () => {
      let i = state.currentIndex - 1;
      if (i < 0) i = state.library.length - 1;
      logAction('player.prev', { index: i });
      playIndex(i);
    });

    document.getElementById('next').addEventListener('click', () => {
      let i = state.currentIndex + 1;
      if (i >= state.library.length) i = 0;
      logAction('player.next', { index: i });
      playIndex(i);
    });

    document.getElementById('shuffle').addEventListener('click', () => {
      state.shuffle = !state.shuffle;
      document.getElementById('shuffle').classList.toggle('primary', state.shuffle);
      const bnShuf = document.getElementById('bn-shuffle'); if (bnShuf) bnShuf.classList.toggle('primary', state.shuffle);
      logAction('player.shuffle', { on: state.shuffle });
    });

    document.getElementById('repeat').addEventListener('click', () => {
      state.repeat = !state.repeat;
      document.getElementById('repeat').classList.toggle('primary', state.repeat);
      const bnRep = document.getElementById('bn-repeat'); if (bnRep) bnRep.classList.toggle('primary', state.repeat);
      logAction('player.repeat', { on: state.repeat });
    });

    // AppBar: top search/rescan/upload/import mirroring library actions
    const topSearch = document.getElementById('top-search');
    if (topSearch) {
      topSearch.addEventListener('input', (e) => {
        const q = e.target.value;
        logAction('library.search.top', { q }, 'search.top', 300);
        filterLibrary(q);
        const libSearch = document.getElementById('search'); if (libSearch) libSearch.value = q;
      });
    }
    const topRescan = document.getElementById('top-rescan');
    if (topRescan) {
      topRescan.addEventListener('click', async () => {
        logAction('library.rescan.top');
        await loadLibrary(true);
        notify('Library refreshed', 'success', 2500);
      });
    }
    const topImportBtn = document.getElementById('top-import-btn');
    if (topImportBtn) {
      topImportBtn.addEventListener('click', async () => {
        const url = (document.getElementById('top-import-url').value || '').trim();
        if (!url) return;
        logAction('import.url.top', { url });
        const res = await API.post('api/remote_import.php', { url });
        if (!res.ok) {
          notify(res.error || 'Import failed', 'error');
          logAction('import.url.top.error', { error: res.error || 'failed' });
        } else {
          notify('Imported audio from URL', 'success');
          logAction('import.url.top.success');
          try { await API.post('api/library.php', { action: 'rescan' }); } catch (_) {}
        }
        await loadLibrary(true);
      });
    }
    const topUpload = document.getElementById('top-upload-input');
    if (topUpload) {
      topUpload.addEventListener('change', async () => {
        const files = Array.from(topUpload.files || []);
        logAction('upload.files.top', files.map(f => ({ name: f.name, size: f.size })));
        let okCount = 0, errCount = 0;
        for (const f of files) {
          try {
            const res = await API.upload('api/upload.php', f);
            logAction('upload.result.top', res);
            if (res.ok) okCount++;
            else { errCount++; notify(res.error || `Upload failed: ${f.name}`, 'error'); }
          } catch (err) {
            console.error('Upload failed', err);
            errCount++;
            notify(`Upload failed: ${f.name}`, 'error');
            logAction('upload.error.top', { message: err.message });
          }
        }
        try { await API.post('api/library.php', { action: 'rescan' }); } catch (_) {}
        await loadLibrary(true);
        if (okCount > 0) notify(`Uploaded ${okCount} file(s)`, 'success');
        if (errCount > 0) notify(`${errCount} upload(s) failed`, 'error');
        topUpload.value = '';
      });
    }

    // BottomNav: delegate to existing controls
    const bnPrev = document.getElementById('bn-prev');
    const bnPlay = document.getElementById('bn-play');
    const bnNext = document.getElementById('bn-next');
    const bnShuffle = document.getElementById('bn-shuffle');
    const bnRepeat = document.getElementById('bn-repeat');

    if (bnPrev) bnPrev.addEventListener('click', () => document.getElementById('prev').click());
    if (bnNext) bnNext.addEventListener('click', () => document.getElementById('next').click());
    if (bnShuffle) bnShuffle.addEventListener('click', () => document.getElementById('shuffle').click());
    if (bnRepeat) bnRepeat.addEventListener('click', () => document.getElementById('repeat').click());
    if (bnPlay) bnPlay.addEventListener('click', () => document.getElementById('play').click());

    document.getElementById('volume').addEventListener('input', (e) => {
      const v = Number(e.target.value);
      setVolume(v);
      logAction('player.volume', { value: v }, 'vol');
    });

    document.getElementById('rate').addEventListener('input', (e) => {
      const r = Number(e.target.value);
      state.audioA.playbackRate = r;
      state.audioB.playbackRate = r;
      logAction('player.rate', { value: r }, 'rate');
    });

    const pitchBtn = document.getElementById('pitch-lock');
    if (pitchBtn) {
      pitchBtn.addEventListener('click', () => {
        const on = !pitchBtn.classList.contains('primary');
        setPitchLock(on);
        pitchBtn.classList.toggle('primary', on);
        logAction('player.pitchLock', { on });
      });
      // default ON
      setPitchLock(true);
      pitchBtn.classList.add('primary');
    }

    document.getElementById('rescan').addEventListener('click', async () => {
      logAction('library.rescan');
      await loadLibrary(true);
      notify('Library refreshed', 'success', 2500);
    });

    document.getElementById('search').addEventListener('input', (e) => {
      const q = e.target.value;
      logAction('library.search', { q }, 'search', 300);
      filterLibrary(q);
    });

    const importBtn = document.getElementById('import-url-btn');
    if (importBtn) {
      importBtn.addEventListener('click', async () => {
        const url = (document.getElementById('import-url').value || '').trim();
        if (!url) return;
        logAction('import.url', { url });
        const res = await API.post('api/remote_import.php', { url });
        if (!res.ok) {
          notify(res.error || 'Import failed', 'error');
          logAction('import.url.error', { error: res.error || 'failed' });
        } else {
          notify('Imported audio from URL', 'success');
          logAction('import.url.success');
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
        logAction('import.url.mobile', { url });
        const res = await API.post('api/remote_import.php', { url });
        if (!res.ok) {
          notify(res.error || 'Import failed', 'error');
          logAction('import.url.mobile.error', { error: res.error || 'failed' });
        } else {
          notify('Imported audio from URL', 'success');
          logAction('import.url.mobile.success');
          try { await API.post('api/library.php', { action: 'rescan' }); } catch (_) {}
        }
        await loadLibrary(true);
      });
    }

    const up = document.getElementById('upload-input');
    up.addEventListener('change', async () => {
      const files = Array.from(up.files || []);
      await uploadQueue(files);
      up.value = '';
    });

    // Floating tools bindings
    const fSearch = document.getElementById('float-search');
    const fRescan = document.getElementById('float-rescan');
    const fUpload = document.getElementById('float-upload-input');
    const fImportUrl = document.getElementById('float-import-url');
    const fImportBtn = document.getElementById('float-import-btn');

    if (fSearch) fSearch.addEventListener('input', (e) => {
      const q = e.target.value;
      filterLibrary(q);
      const libSearch = document.getElementById('search'); if (libSearch) libSearch.value = q;
    });
    if (fRescan) fRescan.addEventListener('click', async () => {
      await loadLibrary(true);
      notify('Library refreshed', 'success', 2000);
    });
    if (fUpload) fUpload.addEventListener('change', async () => {
      const files = Array.from(fUpload.files || []);
      await uploadQueue(files);
      fUpload.value = '';
    });
    if (fImportBtn) fImportBtn.addEventListener('click', async () => {
      const url = (fImportUrl.value || '').trim();
      if (!url) return;
      try {
        const res = await API.post('api/remote_import.php', { url });
        if (!res.ok) {
          notify(res.error || 'Import failed', 'error');
        } else {
          notify('Imported audio from URL', 'success');
          try { await API.post('api/library.php', { action: 'rescan' }); } catch (_) {}
          await loadLibrary(true);
        }
      } catch (err) {
        notify('Import failed: ' + err.message, 'error');
      }
    });

    document.getElementById('viz-style').addEventListener('change', (e) => {
      const style = e.target.value;
      if (state.viz) state.viz.setStyle(style);
      try { updateTuningVisibility(style); } catch (_) {}
      try { populateStyleTemplates(style); } catch (_) {}
      logAction('viz.style', { style });
    });
    document.getElementById('viz-color-1').addEventListener('change', (e) => {
      if (state.viz) state.viz.setColors(e.target.value, document.getElementById('viz-color-2').value);
      logAction('viz.color1', { color: e.target.value });
    });
    document.getElementById('viz-color-2').addEventListener('change', (e) => {
      if (state.viz) state.viz.setColors(document.getElementById('viz-color-1').value, e.target.value);
      logAction('viz.color2', { color: e.target.value });
    });
    const glow = document.getElementById('viz-glow');
    const trail = document.getElementById('viz-trail');
    const art = document.getElementById('viz-art');
    if (glow) glow.addEventListener('change', () => { if (state.viz) state.viz.setGlow(glow.checked); logAction('viz.glow', { on: glow.checked }); });
    if (trail) trail.addEventListener('change', () => { if (state.viz) state.viz.setTrail(trail.checked); logAction('viz.trail', { on: trail.checked }); });
    if (art) art.addEventListener('change', () => { if (state.viz) state.viz.setShowArt(art.checked); logAction('viz.art', { on: art.checked }); });

    // orientation + theme
    const orientSel = document.getElementById('viz-orient');
    if (orientSel) {
      orientSel.addEventListener('change', () => {
        state.orientation = orientSel.value || 'auto';
        reflowCanvas();
        logAction('viz.orientation', { value: state.orientation });
      });
    }
    const themeSel = document.getElementById('theme-select');
    if (themeSel) {
      themeSel.addEventListener('change', () => {
        state.theme = themeSel.value || 'dark';
        document.body.classList.toggle('light', state.theme === 'light');
        logAction('theme.change', { value: state.theme });
      });
    }

    // options toggles
    const stylePresets = document.getElementById('viz-style-presets');
    if (stylePresets) {
      stylePresets.addEventListener('change', () => {
        if (state.viz && state.viz.setStylePresets) state.viz.setStylePresets(stylePresets.checked);
        // also re-apply on current style
        if (state.viz && stylePresets.checked) state.viz.setStyle(document.getElementById('viz-style').value);
        logAction('viz.stylePresets', { on: stylePresets.checked });
      });
    }
    const bpmToggle = document.getElementById('viz-bpm');
    if (bpmToggle) {
      bpmToggle.addEventListener('change', () => {
        if (state.viz && state.viz.setBpmEnabled) state.viz.setBpmEnabled(bpmToggle.checked);
        logAction('viz.bpm', { on: bpmToggle.checked });
      });
    }
    const perfToggle = document.getElementById('viz-perf');
    if (perfToggle) {
      perfToggle.addEventListener('change', () => {
        const on = perfToggle.checked;
        if (state.viz && state.viz.setPerformanceMode) state.viz.setPerformanceMode(on);
        // adjust analyser FFT sizes dynamically
        if (state.analyser) {
          const fft = on ? 512 : 1024;
          const smooth = on ? 0.7 : 0.75;
          state.analyser.fftSize = fft;
          state.analyserL.fftSize = fft;
          state.analyserR.fftSize = fft;
          state.analyser.smoothingTimeConstant = smooth;
          state.analyserL.smoothingTimeConstant = smooth;
          state.analyserR.smoothingTimeConstant = smooth;
        }
        logAction('viz.performanceMode', { on });
      });
    }

    // tuning controls
    const rot = document.getElementById('viz-rot');
    const dec = document.getElementById('viz-decay');
    const th = document.getElementById('viz-thickness');
    const rf = document.getElementById('viz-ring-floor');
    const rfRad = document.getElementById('viz-radial-floor');
    const gs = document.getElementById('viz-glow-strength');
    const ta = document.getElementById('viz-trail-alpha');
    const ss = document.getElementById('viz-spike-scale');
    const ws = document.getElementById('viz-wave-scale');
    const bs = document.getElementById('viz-beat-sense');
    const bb = document.getElementById('viz-beat-boost');
    const bt = document.getElementById('viz-beat-thresh');
    const bd = document.getElementById('viz-beat-decay');
    const lg = document.getElementById('viz-low-gain');
    const mg = document.getElementById('viz-mid-gain');
    const hg = document.getElementById('viz-high-gain');
    const sm = document.getElementById('viz-smooth');
    const srcSel = document.getElementById('viz-beat-src');
    const holdMs = document.getElementById('viz-beat-hold');
    const pulseW = document.getElementById('viz-pulse-w');
    const tplSel = document.getElementById('style-template');
    const emphMode = document.getElementById('viz-emphasis-mode');
    const seg = document.getElementById('viz-segments');

    rot.addEventListener('input', e => { if (state.viz) state.viz.setRotationSpeed(Number(e.target.value)); logAction('viz.rot', { value: Number(e.target.value) }, 'viz-rot'); });
    dec.addEventListener('input', e => { if (state.viz) state.viz.setDecay(Number(e.target.value)); logAction('viz.decay', { value: Number(e.target.value) }, 'viz-decay'); });
    th.addEventListener('input', e => { if (state.viz) state.viz.setThickness(Number(e.target.value)); logAction('viz.thickness', { value: Number(e.target.value) }, 'viz-thickness'); });
    rf.addEventListener('input', e => { if (state.viz) { const v = Number(e.target.value); state.viz.setRingFloor(v); } logAction('viz.ringFloor', { value: Number(e.target.value) }, 'viz-ringFloor'); });
    if (rfRad) rfRad.addEventListener('input', e => { if (state.viz) { const v = Number(e.target.value); state.viz.setRadialFloor(v); } logAction('viz.radialFloor', { value: Number(e.target.value) }, 'viz-radialFloor'); });
    gs.addEventListener('input', e => { if (state.viz) state.viz.setGlowStrength(Number(e.target.value)); logAction('viz.glowStrength', { value: Number(e.target.value) }, 'viz-glowStrength'); });
    ta.addEventListener('input', e => { if (state.viz) state.viz.setTrailAlpha(Number(e.target.value)); logAction('viz.trailAlpha', { value: Number(e.target.value) }, 'viz-trailAlpha'); });
    ss.addEventListener('input', e => { if (state.viz) state.viz.setSpikeScale(Number(e.target.value)); logAction('viz.spikeScale', { value: Number(e.target.value) }, 'viz-spikeScale'); });
    ws.addEventListener('input', e => { if (state.viz) state.viz.setWaveScale(Number(e.target.value)); logAction('viz.waveScale', { value: Number(e.target.value) }, 'viz-waveScale'); });
    if (seg) seg.addEventListener('input', e => { if (state.viz && state.viz.setSegments) state.viz.setSegments(Number(e.target.value)); logAction('viz.segments', { value: Number(e.target.value) }, 'viz-segments'); });
    if (bs) bs.addEventListener('input', e => { if (state.viz && state.viz.setBeatSensitivity) state.viz.setBeatSensitivity(Number(e.target.value)); logAction('viz.beatSense', { value: Number(e.target.value) }, 'viz-beatSense'); });
    if (bb) bb.addEventListener('input', e => { if (state.viz && state.viz.setBeatBoost) state.viz.setBeatBoost(Number(e.target.value)); logAction('viz.beatBoost', { value: Number(e.target.value) }, 'viz-beatBoost'); });
    if (bt) bt.addEventListener('input', e => { if (state.viz && state.viz.setBeatThreshold) state.viz.setBeatThreshold(Number(e.target.value)); logAction('viz.beatThreshold', { value: Number(e.target.value) }, 'viz-beatThreshold'); });
    if (bd) bd.addEventListener('input', e => { if (state.viz && state.viz.setBeatDecay) state.viz.setBeatDecay(Number(e.target.value)); logAction('viz.beatDecay', { value: Number(e.target.value) }, 'viz-beatDecay'); });
    if (srcSel) srcSel.addEventListener('change', e => { if (state.viz && state.viz.setBeatSource) state.viz.setBeatSource(e.target.value); logAction('viz.beatSource', { value: e.target.value }); });
    if (holdMs) holdMs.addEventListener('input', e => { if (state.viz && state.viz.setBeatHoldMs) state.viz.setBeatHoldMs(Number(e.target.value)); logAction('viz.beatHoldMs', { value: Number(e.target.value) }, 'viz-beatHoldMs'); });
    if (pulseW) pulseW.addEventListener('input', e => { if (state.viz && state.viz.setPulseWidth) state.viz.setPulseWidth(Number(e.target.value)); logAction('viz.pulseWidth', { value: Number(e.target.value) }, 'viz-pulseWidth'); });
    if (lg) lg.addEventListener('input', () => { if (state.viz && state.viz.setEmphasis) state.viz.setEmphasis(Number(lg.value), Number(mg.value), Number(hg.value)); logAction('viz.emphasisLow', { value: Number(lg.value) }, 'viz-emphasisLow'); });
    if (mg) mg.addEventListener('input', () => { if (state.viz && state.viz.setEmphasis) state.viz.setEmphasis(Number(lg.value), Number(mg.value), Number(hg.value)); logAction('viz.emphasisMid', { value: Number(mg.value) }, 'viz-emphasisMid'); });
    if (hg) hg.addEventListener('input', () => { if (state.viz && state.viz.setEmphasis) state.viz.setEmphasis(Number(lg.value), Number(mg.value), Number(hg.value)); logAction('viz.emphasisHigh', { value: Number(hg.value) }, 'viz-emphasisHigh'); });
    if (sm) sm.addEventListener('input', e => { if (state.viz && state.viz.setSmoothing) state.viz.setSmoothing(Number(e.target.value)); logAction('viz.smoothing', { value: Number(e.target.value) }, 'viz-smoothing'); });
    if (emphMode) emphMode.addEventListener('change', e => {
      const mode = e.target.value;
      if (state.viz && state.viz.setEmphasisMode) state.viz.setEmphasisMode(mode);
      // Re-run visibility to hide/show low/mid/high sliders
      try { updateTuningVisibility(document.getElementById('viz-style').value); } catch (_) {}
      logAction('viz.emphasisMode', { value: mode });
    });

    if (tplSel) {
      tplSel.addEventListener('change', (e) => {
        const name = e.target.value;
        if (!name) return;
        applyStyleTemplate(name);
      });
    }

    // Layers: edit selected layer controls inside Layers drawer
    const leStyle = document.getElementById('layer-edit-style');
    const leC1 = document.getElementById('layer-edit-color-1');
    const leC2 = document.getElementById('layer-edit-color-2');
    const leSeg = document.getElementById('layer-edit-segments');
    const leBlend = document.getElementById('layer-edit-blend');
    const leAlpha = document.getElementById('layer-edit-alpha');

    const lRot = document.getElementById('layer-rot');
    const lDec = document.getElementById('layer-decay');
    const lTh = document.getElementById('layer-thickness');
    const lRing = document.getElementById('layer-ring-floor');
    const lRad = document.getElementById('layer-radial-floor');
    const lSpike = document.getElementById('layer-spike-scale');
    const lWave = document.getElementById('layer-wave-scale');

    // Image layer controls
    const leImgUrl = document.getElementById('layer-edit-image-url');
    const leImgLoad = document.getElementById('layer-edit-image-load');
    const leImgFile = document.getElementById('layer-edit-image-file');
    const leImgFit = document.getElementById('layer-edit-img-fit');

    function withSel(fn) {
      if (!state.viz || state.viz.sel < 0) return;
      try { fn(state.viz.layers[state.viz.sel], state.viz.sel); } catch (_) {}
    }

    if (leStyle) leStyle.addEventListener('change', (e) => {
      withSel(() => {
        if (state.viz && state.viz.setStyle) state.viz.setStyle(e.target.value);
        renderLayersUI();
        syncLayerEditForm();
        logAction('layer.edit.style', { value: e.target.value });
      });
    });
    if (leC1) leC1.addEventListener('change', (e) => {
      withSel(() => {
        if (state.viz && state.viz.setColors) state.viz.setColors(e.target.value, (leC2?.value || '#1e90ff'));
        renderLayersUI();
        logAction('layer.edit.color1', { value: e.target.value });
      });
    });
    if (leC2) leC2.addEventListener('change', (e) => {
      withSel(() => {
        if (state.viz && state.viz.setColors) state.viz.setColors((leC1?.value || '#19d3ae'), e.target.value);
        renderLayersUI();
        logAction('layer.edit.color2', { value: e.target.value });
      });
    });
    if (leSeg) leSeg.addEventListener('input', (e) => {
      withSel(() => {
        if (state.viz && state.viz.setSegments) state.viz.setSegments(Number(e.target.value));
        logAction('layer.edit.segments', { value: Number(e.target.value) }, 'layer-edit-segments');
      });
    });
    if (leBlend) leBlend.addEventListener('change', (e) => {
      withSel((L) => { L.blend = e.target.value; renderLayersUI(); syncLayerEditForm(); logAction('layer.edit.blend', { value: e.target.value }); });
    });
    if (leAlpha) leAlpha.addEventListener('input', (e) => {
      withSel((L) => { L.alpha = Number(e.target.value); renderLayersUI(); logAction('layer.edit.alpha', { value: Number(e.target.value) }, 'layer-edit-alpha'); });
    });

    if (lRot) lRot.addEventListener('input', (e) => { withSel(() => { if (state.viz && state.viz.setRotationSpeed) state.viz.setRotationSpeed(Number(e.target.value)); }); logAction('layer.edit.rot', { value: Number(e.target.value) }, 'layer-rot'); });
    if (lDec) lDec.addEventListener('input', (e) => { withSel(() => { if (state.viz && state.viz.setDecay) state.viz.setDecay(Number(e.target.value)); }); logAction('layer.edit.decay', { value: Number(e.target.value) }, 'layer-decay'); });
    if (lTh) lTh.addEventListener('input', (e) => { withSel(() => { if (state.viz && state.viz.setThickness) state.viz.setThickness(Number(e.target.value)); }); logAction('layer.edit.thickness', { value: Number(e.target.value) }, 'layer-thickness'); });
    if (lRing) lRing.addEventListener('input', (e) => { withSel(() => { if (state.viz && state.viz.setRingFloor) state.viz.setRingFloor(Number(e.target.value)); }); logAction('layer.edit.ringFloor', { value: Number(e.target.value) }, 'layer-ringFloor'); });
    if (lRad) lRad.addEventListener('input', (e) => { withSel(() => { if (state.viz && state.viz.setRadialFloor) state.viz.setRadialFloor(Number(e.target.value)); }); logAction('layer.edit.radialFloor', { value: Number(e.target.value) }, 'layer-radialFloor'); });
    if (lSpike) lSpike.addEventListener('input', (e) => { withSel(() => { if (state.viz && state.viz.setSpikeScale) state.viz.setSpikeScale(Number(e.target.value)); }); logAction('layer.edit.spikeScale', { value: Number(e.target.value) }, 'layer-spikeScale'); });
    if (lWave) lWave.addEventListener('input', (e) => { withSel(() => { if (state.viz && state.viz.setWaveScale) state.viz.setWaveScale(Number(e.target.value)); }); logAction('layer.edit.waveScale', { value: Number(e.target.value) }, 'layer-waveScale'); });

    // Image layer handlers
    if (leImgLoad) leImgLoad.addEventListener('click', () => {
      const url = (leImgUrl?.value || '').trim();
      if (!url) return;
      withSel(() => {
        if (state.viz && state.viz.setLayerImage) state.viz.setLayerImage(url);
        renderLayersUI();
        notify('Image loaded', 'success', 1500);
        logAction('layer.edit.imageUrl', { url });
      });
    });
    if (leImgFile) leImgFile.addEventListener('change', () => {
      const f = leImgFile.files && leImgFile.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      withSel(() => {
        if (state.viz && state.viz.setLayerImage) state.viz.setLayerImage(url);
        renderLayersUI();
        notify('Image selected', 'success', 1200);
        logAction('layer.edit.imageFile', { name: f.name, size: f.size });
      });
      // Note: we keep the object URL for session; revocation handled on page unload
      leImgFile.value = '';
    });
    if (leImgFit) leImgFit.addEventListener('change', (e) => {
      const fit = e.target.value;
      withSel(() => {
        if (state.viz && state.viz.setLayerImgFit) state.viz.setLayerImgFit(fit);
        renderLayersUI();
        logAction('layer.edit.imgFit', { fit });
      });
    });

    document.getElementById('eq-toggle').addEventListener('click', () => {
      const panel = document.getElementById('eq-panel');
      panel.classList.toggle('show');
      logAction('eq.toggle', { show: panel.classList.contains('show') });
    });

    document.getElementById('eq-preset').addEventListener('change', (e) => {
      state.eq.setPreset(e.target.value);
      logAction('eq.preset', { preset: e.target.value });
    });
    document.querySelectorAll('#eq-panel input[type="range"]').forEach(sl => {
      sl.addEventListener('input', (e) => {
        const i = Number(e.target.dataset.band);
        const v = Number(e.target.value);
        state.eq.setGain(i, v);
        logAction('eq.band', { band: i, value: v }, 'eq-band-' + i);
      });
    });

    document.getElementById('record').addEventListener('click', () => { logAction('record.toggle'); toggleRecording(); });

    // Layers: add new layer, render list and bind actions
    const layerAddBtn = document.getElementById('layer-add');
    if (layerAddBtn) {
      layerAddBtn.addEventListener('click', () => {
        ensureAudioContext();
        const style = document.getElementById('viz-style').value || 'circle';
        const idx = state.viz.addLayer(style, {
          color1: document.getElementById('viz-color-1').value,
          color2: document.getElementById('viz-color-2').value,
          rotation: Number(document.getElementById('viz-rot').value || 0.6),
          thickness: Number(document.getElementById('viz-thickness').value || 1),
          ringFloor: Number(document.getElementById('viz-ring-floor').value || 0.16),
          radialFloor: Number(document.getElementById('viz-radial-floor').value || 0.16),
          spikeScale: Number(document.getElementById('viz-spike-scale').value || 1),
          waveScale: Number(document.getElementById('viz-wave-scale').value || 1),
          segments: Number(document.getElementById('viz-segments').value || 4)
        });
        state.viz.selectLayer(idx);
        renderLayersUI();
        notify('Layer added', 'success', 1500);
      });
    }

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
        logAction('snapshot');
      });
    }

    // Choose audio files: forwards click to upload input
    const chooseBtn = document.getElementById('choose-audio');
    if (chooseBtn) {
      chooseBtn.addEventListener('click', () => {
        const up = document.getElementById('upload-input');
        if (up) up.click();
        logAction('chooseAudioFiles');
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
        logAction('project.load', { ok: true });
      } catch (err) {
        notify('Failed to apply project: ' + err.message, 'error');
        logAction('project.load.error', { message: err.message });
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
        logAction('project.save');
      });
    }
    if (loadProj && loadInp) {
      loadProj.addEventListener('click', () => { logAction('project.load.select'); loadInp.click(); });
      loadInp.addEventListener('change', async () => {
        const f = loadInp.files[0];
        if (!f) return;
        try {
          const text = await f.text();
          const proj = JSON.parse(text);
          applyProject(proj);
        } catch (err) {
          notify('Failed to load project: ' + err.message, 'error');
          logAction('project.load.error', { message: err.message });
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
            // stop playback, clear src/art
            try { state.audioA.pause(); state.audioA.src = ''; } catch (_) {}
            try { state.audioB.pause(); state.audioB.src = ''; } catch (_) {}
            document.getElementById('art').style.backgroundImage = '';
            notify('Track deleted', 'success');
            logAction('track.delete', { path: state.currentTrack.path });
            state.currentTrack = null;
            document.getElementById('track-title').textContent = '—';
            document.getElementById('track-time').textContent = '0:00 / 0:00';
            document.getElementById('play').textContent = 'Play';
            await loadLibrary(true);
          } else {
            notify(res.error || 'Delete failed', 'error');
            logAction('track.delete.error', { error: res.error || 'failed' });
          }
        } catch (err) {
          console.error('Delete error', err);
          notify('Delete failed: ' + err.message, 'error');
          logAction('track.delete.error', { message: err.message });
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
      logAction('record.stop');
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
    logAction('record.start');
  }

  // Upload queue with concurrency + overlay status to reduce lag
  async function uploadQueue(files) {
    const overlay = document.getElementById('upload-overlay');
    const status = document.getElementById('upload-status');
    const total = files.length;
    let done = 0, ok = 0, err = 0;
    const limit = 2; // concurrency
    const queue = files.slice();
    const running = [];

    function updateStatus() {
      if (status) status.textContent = `Uploading ${done}/${total}…`;
    }
    function showOverlay(on) {
      if (overlay) overlay.classList.toggle('show', !!on);
    }

    showOverlay(true);
    updateStatus();

    async function worker(file) {
      try {
        const res = await API.upload('api/upload.php', file);
        if (res.ok) ok++; else { err++; notify(res.error || `Upload failed: ${file.name}`, 'error'); }
      } catch (e) {
        err++;
        notify(`Upload failed: ${file.name}`, 'error');
      } finally {
        done++;
        updateStatus();
      }
    }

    while (queue.length || running.length) {
      while (queue.length && running.length < limit) {
        const f = queue.shift();
        const p = worker(f).finally(() => {
          const i = running.indexOf(p);
          if (i >= 0) running.splice(i, 1);
        });
        running.push(p);
      }
      await Promise.race(running).catch(()=>{});
    }

    // One rescan at the end
    try { await API.post('api/library.php', { action: 'rescan' }); } catch (_) {}
    await loadLibrary(true);

    showOverlay(false);
    if (ok > 0) notify(`Uploaded ${ok} file(s)`, 'success');
    if (err > 0) notify(`${err} upload(s) failed`, 'error');
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

  // Render Layers UI from visualizer stack (populates both sidebar and floating panel)
  function renderLayersUI() {
    if (!state.viz) return;
    const targets = [];
    const ulMain = document.getElementById('layers-list');
    const ulFab  = document.getElementById('layers-fab-list');
    if (ulMain) targets.push(ulMain);
    if (ulFab) targets.push(ulFab);
    if (targets.length === 0) return;

    const layers = state.viz.getLayers();
    targets.forEach(ul => { ul.innerHTML = ''; });

    layers.forEach((L, idx) => {
      targets.forEach(ul => {
        const li = document.createElement('li');
        li.dataset.index = String(idx);

        const handle = document.createElement('span');
        handle.className = 'handle';
        handle.textContent = '⋮⋮';

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = (L.style || 'Layer');

        const actions = document.createElement('span');
        actions.className = 'actions';

        const eye = document.createElement('button');
        eye.className = 'eye btn secondary';
        eye.title = 'Visible';
        eye.textContent = L.visible === false ? '🙈' : '👁';
        eye.addEventListener('click', (e) => {
          e.stopPropagation();
          state.viz.setLayerVisible(idx, L.visible === false ? true : false);
          renderLayersUI();
        });

        const gear = document.createElement('button');
        gear.className = 'gear btn secondary';
        gear.title = 'Settings';
        gear.textContent = '⚙️';
        gear.addEventListener('click', (e) => {
          e.stopPropagation();
          state.viz.selectLayer(idx);
          const d = document.getElementById('layers-drawer');
          const s = document.getElementById('layers-scrim');
          if (d) d.classList.add('open');
          if (s) s.classList.add('show');
          syncLayerEditForm();
        });

        const trash = document.createElement('button');
        trash.className = 'trash btn danger';
        trash.title = 'Delete';
        trash.textContent = '🗑';
        trash.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!window.confirm('Delete layer?')) return;
          state.viz.removeLayer(idx);
          renderLayersUI();
        });

        actions.appendChild(eye);
        actions.appendChild(gear);
        actions.appendChild(trash);

        li.appendChild(handle);
        li.appendChild(name);
        li.appendChild(actions);

        li.addEventListener('click', () => {
          state.viz.selectLayer(idx);
          renderLayersUI();
        });

        // Highlight selected
        if (state.viz.sel === idx) {
          li.style.borderColor = '#2e7be7';
        }

        ul.appendChild(li);
      });
    });

    // After render, sync edit form with selected layer
    syncLayerEditForm();
  }

  function syncLayerEditForm() {
    try {
      if (!state.viz || state.viz.sel < 0) return;
      const L = state.viz.layers[state.viz.sel];
      const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = String(val); };
      const setShow = (id, on) => {
        const el = document.getElementById(id);
        if (!el) return;
        const wrap = el.closest('label') || el.closest('.viz-style') || el.parentElement;
        if (wrap) wrap.style.display = on ? '' : 'none';
      };

      // Selected layer values
      setVal('layer-edit-style', L.style || 'circle');
      setVal('layer-edit-color-1', L.color1 || '#19d3ae');
      setVal('layer-edit-color-2', L.color2 || '#1e90ff');
      setVal('layer-rot', (typeof L.rotation !== 'undefined' ? L.rotation : document.getElementById('viz-rot')?.value) || 0.6);
      setVal('layer-decay', (document.getElementById('viz-decay')?.value) || 0.92);
      setVal('layer-thickness', (typeof L.thickness !== 'undefined' ? L.thickness : document.getElementById('viz-thickness')?.value) || 1);
      setVal('layer-ring-floor', (typeof L.ringFloor !== 'undefined' ? L.ringFloor : document.getElementById('viz-ring-floor')?.value) || 0.16);
      setVal('layer-radial-floor', (typeof L.radialFloor !== 'undefined' ? L.radialFloor : document.getElementById('viz-radial-floor')?.value) || 0.16);
      setVal('layer-spike-scale', (typeof L.spikeScale !== 'undefined' ? L.spikeScale : document.getElementById('viz-spike-scale')?.value) || 1);
      setVal('layer-wave-scale', (typeof L.waveScale !== 'undefined' ? L.waveScale : document.getElementById('viz-wave-scale')?.value) || 1);
      setVal('layer-edit-segments', (typeof L.segments !== 'undefined' ? L.segments : document.getElementById('viz-segments')?.value) || 2);
      setVal('layer-edit-blend', (typeof L.blend !== 'undefined' ? L.blend : 'lighter'));
      setVal('layer-edit-alpha', (typeof L.alpha !== 'undefined' ? L.alpha : 1));

      // Image fields visibility and values
      const isImage = (String(L.style).toLowerCase() === 'image');
      setVal('layer-edit-image-url', L.imgSrc || '');
      setVal('layer-edit-img-fit', L.imgFit || 'cover');
      setShow('layer-edit-image-url', isImage);
      setShow('layer-edit-image-load', isImage);
      setShow('layer-edit-image-file', isImage);
      setShow('layer-edit-img-fit', isImage);

      // Style-specific visibility: show only controls relevant to the selected layer style
      const s = String(L.style || 'circle').toLowerCase();
      const showIds = new Set();

      if (s === 'bars' || s === 'mirror') {
        ['layer-decay','layer-thickness','layer-radial-floor'].forEach(id => showIds.add(id));
      } else if (s === 'wave') {
        ['layer-thickness','layer-wave-scale'].forEach(id => showIds.add(id));
      } else if (s === 'ring') {
        ['layer-rot','layer-thickness','layer-wave-scale','layer-edit-segments'].forEach(id => showIds.add(id));
      } else if (s === 'radial') {
        ['layer-rot','layer-decay','layer-thickness','layer-radial-floor','layer-edit-segments'].forEach(id => showIds.add(id));
      } else if (s === 'particles') {
        ['layer-thickness','layer-edit-segments'].forEach(id => showIds.add(id));
      } else if (s === 'circle') {
        ['layer-rot','layer-decay','layer-thickness','layer-ring-floor','layer-spike-scale','layer-edit-segments'].forEach(id => showIds.add(id));
      } else if (s === 'image') {
        // image fields already shown above; hide most tuning sliders
        ['layer-edit-blend','layer-edit-alpha'].forEach(id => showIds.add(id));
      } else if (s === 'background') {
        // background: just colors, blend, alpha; tuning sliders hidden
        ['layer-edit-blend','layer-edit-alpha'].forEach(id => showIds.add(id));
      }

      const ALL = [
        'layer-rot','layer-decay','layer-thickness','layer-ring-floor','layer-radial-floor',
        'layer-spike-scale','layer-wave-scale','layer-edit-segments','layer-edit-blend','layer-edit-alpha'
      ];
      ALL.forEach(id => setShow(id, showIds.has(id)));
    } catch (_) {}
  }

  // Populate Playlist Create drawer list from library
  function populatePlaylistCreateList(filter = '') {
    const container = document.getElementById('pl-lib-list');
    if (!container) return;
    const q = String(filter || '').toLowerCase();
    container.innerHTML = '';
    const items = state.library.filter(it => !q || (it.name || '').toLowerCase().includes(q));
    items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.padding = '6px 8px';
      row.style.borderBottom = '1px dashed #2a3350';

      const left = document.createElement('label');
      left.style.display = 'inline-flex';
      left.style.alignItems = 'center';
      left.style.gap = '8px';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.index = String(idx);

      const name = document.createElement('span');
      name.textContent = it.name || it.path;

      left.appendChild(cb);
      left.appendChild(name);

      const play = document.createElement('button');
      play.className = 'btn secondary';
      play.textContent = 'Play';
      play.addEventListener('click', () => playTrack(it));

      row.appendChild(left);
      row.appendChild(play);

      container.appendChild(row);
    });
  }

  // Open Playlist Select drawer and execute callback with chosen id
  async function openPlaylistSelect(onChoose) {
    const drawer = document.getElementById('pl-select-drawer');
    const scrim = document.getElementById('pl-select-scrim');
    const ul = document.getElementById('pl-select-list');
    if (!drawer || !ul) return;
    try {
      const data = await API.get('api/playlists.php');
      ul.innerHTML = '';
      (data.playlists || []).forEach(pl => {
        const li = document.createElement('li');
        li.textContent = pl.name + (pl.type === 'smart' ? ' • Smart' : '');
        li.addEventListener('click', async () => {
          if (typeof onChoose === 'function') await onChoose(pl.id, pl.name);
          drawer.classList.remove('open');
          if (scrim) scrim.classList.remove('show');
        });
        ul.appendChild(li);
      });
      drawer.classList.add('open');
      if (scrim) scrim.classList.add('show');
    } catch (err) {
      notify('Failed to load playlists', 'error');
    }
  }

  return { init, playTrack, state, getCurrentTrack, loadLibrary, renderLayersUI, ensureAudioContext, syncLayerEditForm };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init().then(() => {
    if (typeof Settings !== 'undefined') Settings.init();
    if (typeof Cloud !== 'undefined') Cloud.init();
  }).catch(err => console.error(err));
});