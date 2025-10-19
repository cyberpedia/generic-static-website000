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
    pitchLock: true
  };

  async function init() {
    await API.init();

    // Do not create AudioContext until user gesture (mobile restriction)
    bindUI();
    await loadLibrary();
    PlaylistUI.init({ playTrack, getCurrentTrack: () => state.currentTrack });

    // Default slider value; actual volume applied once AudioContext is created
    document.getElementById('volume').value = 0.9;
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
  }

  function ensureCtx() {
    if (state.ctx) return;

    state.ctx = new (window.AudioContext || window.webkitAudioContext)();
    state.master = state.ctx.createGain();
    state.eq = new Equalizer(state.ctx);
    state.analyser = state.ctx.createAnalyser();
    state.analyser.fftSize = 2048;
    state.analyser.smoothingTimeConstant = 0.8;

    // Audio chain: sources -> eq -> analyser -> destination
    state.eq.connect(state.analyser);
    state.analyser.connect(state.ctx.destination);

    // For recording visualizer + audio
    state.recordingDest = state.ctx.createMediaStreamDestination();

    // connect eq output to recording as well
    state.eq.output.connect(state.recordingDest);

    // setup audio elements
    setupAudioElements();

    // Visualizer
    const canvas = document.getElementById('viz');
    state.viz = new Visualizer(state.analyser, canvas);
    state.viz.start();

    // apply default volume
    const v = Number(document.getElementById('volume').value || 0.9);
    setVolume(v);

    // apply stored pitch lock
    setPitchLock(state.pitchLock);
  }

  async function loadLibrary(rescan = false) {
    const data = await API.get('api/library.php', { page: 0, size: 500, rescan: rescan ? 1 : undefined });
    if (data && data.ok === false) {
      console.warn('Library API unavailable or returned non-JSON', data);
      // Keep existing library; do not overwrite with empty on failure
      renderLibrary();
      return;
    }
    state.library = (data && data.items) ? data.items : [];
    renderLibrary();
  }

  function renderLibrary(list = null) {
    const ul = document.getElementById('library-list');
    ul.innerHTML = '';
    const src = Array.isArray(list) ? list : state.library;
    src.forEach((item, idx) => {
      const li = document.createElement('li');
      li.textContent = item.name;
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
    if (i < 0 || i >= state.library.length) return;
    ensureCtx();
    const track = state.library[i];
    state.currentIndex = i;
    playTrack(track);
  }

  function playTrack(track) {
    ensureCtx();
    const src = track.blobUrl ? track.blobUrl : ('assets/music/' + track.path);

    // Update UI info
    document.getElementById('track-title').textContent = track.name || track.path || '—';
    state.currentTrack = { path: track.path, name: track.name, blobUrl: track.blobUrl || null };

    const useA = state.useA;

    const incoming = useA ? state.audioB : state.audioA;
    const outgoing = useA ? state.audioA : state.audioB;
    const incomingGain = useA ? state.gainB : state.gainA;
    const outgoingGain = useA ? state.gainA : state.gainB;

    incoming.pause();
    incoming.src = src;
    incoming.currentTime = 0;
    incoming.playbackRate = Number(document.getElementById('rate').value || 1);
    incoming.volume = 1.0;

    // Art via jsmediatags if possible (only for file URLs, not blobs)
    if (!track.blobUrl) {
      try {
        jsmediatags.read(src, {
          onSuccess: (tag) => {
            const pic = tag.tags.picture;
            if (pic) {
              const base64 = arrayBufferToBase64(pic.data);
              const url = `data:${pic.format};base64,${base64}`;
              document.getElementById('art').style.backgroundImage = `url(${url})`;
              document.getElementById('art').style.backgroundSize = 'cover';
            } else {
              document.getElementById('art').style.backgroundImage = '';
            }
          },
          onError: () => {
            document.getElementById('art').style.backgroundImage = '';
          }
        });
      } catch (_) {}
    } else {
      document.getElementById('art').style.backgroundImage = '';
    }

    incoming.addEventListener('loadedmetadata', () => {
      updateTime();
    }, { once: true });

    incoming.play().then(() => {
      crossfade(incomingGain, outgoingGain, state.crossfade);
      state.useA = !state.useA;
      document.getElementById('play').textContent = 'Pause';
    }).catch(err => console.error('Playback error', err));
  }

  function crossfade(inGain, outGain, seconds) {
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
    const dur = active.duration || 0;
    const cur = active.currentTime || 0;
    document.getElementById('track-time').textContent = `${API.fmtTime(cur)} / ${API.fmtTime(dur)}`;
  }

  function onEnded() {
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
      ensureCtx();
      try { await state.ctx.resume(); } catch (_) {}
      if (state.currentIndex === -1 && state.library.length > 0 && (state.useA ? state.audioB.src === '' : state.audioA.src === '')) {
        playIndex(0);
        return;
      }
      const active = state.useA ? state.audioB : state.audioA;
      if (active.paused) {
        active.play();
        document.getElementById('play').textContent = 'Pause';
      } else {
        active.pause();
        document.getElementById('play').textContent = 'Play';
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
      if (state.audioA) state.audioA.playbackRate = r;
      if (state.audioB) state.audioB.playbackRate = r;
    });

    const pitchBtn = document.getElementById('pitch-lock');
    if (pitchBtn) {
      pitchBtn.addEventListener('click', () => {
        const on = !pitchBtn.classList.contains('primary');
        setPitchLock(on);
        pitchBtn.classList.toggle('primary', on);
      });
      // default ON without touching AudioContext
      pitchBtn.classList.add('primary');
      state.pitchLock = true;
    }

    document.getElementById('rescan').addEventListener('click', async () => {
      await loadLibrary(true);
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
        if (!res.ok) alert(res.error || 'Import failed');
        await loadLibrary(true);
      });
    }

    const up = document.getElementById('upload-input');
    up.addEventListener('change', async () => {
      const files = Array.from(up.files || []);
      let anySuccess = false;
      let anyFallback = false;
      for (const f of files) {
        const res = await API.upload('api/upload.php', f);
        if (res && res.ok) {
          anySuccess = true;
        } else {
          anyFallback = true;
          // Fallback: play directly from blob URL in this session
          const url = URL.createObjectURL(f);
          const item = {
            id: 'blob-' + Math.random().toString(36).slice(2),
            path: '',
            name: f.name,
            size: f.size,
            blobUrl: url
          };
          state.library.unshift(item);
        }
      }
      if (anySuccess) {
        await loadLibrary(true);
      } else if (anyFallback) {
        renderLibrary();
      }
      up.value = '';
    });

    document.getElementById('viz-style').addEventListener('change', (e) => {
      if (state.viz) state.viz.setStyle(e.target.value);
    });
    document.getElementById('viz-color-1').addEventListener('change', (e) => {
      if (state.viz) state.viz.setColors(e.target.value, document.getElementById('viz-color-2').value);
    });
    document.getElementById('viz-color-2').addEventListener('change', (e) => {
      if (state.viz) state.viz.setColors(document.getElementById('viz-color-1').value, e.target.value);
    });

    document.getElementById('eq-toggle').addEventListener('click', () => {
      document.getElementById('eq-panel').classList.toggle('show');
    });

    document.getElementById('eq-preset').addEventListener('change', (e) => {
      ensureCtx();
      state.eq.setPreset(e.target.value);
    });
    document.querySelectorAll('#eq-panel input[type="range"]').forEach(sl => {
      sl.addEventListener('input', (e) => {
        ensureCtx();
        const i = Number(e.target.dataset.band);
        const v = Number(e.target.value);
        state.eq.setGain(i, v);
      });
    });

    document.getElementById('record').addEventListener('click', () => toggleRecording());
  }

  function setVolume(v) {
    // control via element volume plus master gain
    const active = state.useA ? state.audioB : state.audioA;
    if (active) active.volume = v;
    if (state.master) state.master.gain.value = v;
  }

  function toggleRecording() {
    ensureCtx();
    if (state.recorder) {
      state.recorder.stop();
      state.recorder = null;
      document.getElementById('record').textContent = 'Record';
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
    state.pitchLock = !!on;
    const props = ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch'];
    if (state.audioA && state.audioB) {
      for (const p of props) {
        try { state.audioA[p] = state.pitchLock; } catch (_) {}
        try { state.audioB[p] = state.pitchLock; } catch (_) {}
      }
    }
  }

  function getCurrentTrack() {
    return state.currentTrack;
  }

  return { init, playTrack, state, getCurrentTrack, loadLibrary };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init().then(() => {
    if (typeof Settings !== 'undefined') Settings.init();
    if (typeof Cloud !== 'undefined') Cloud.init();
  }).catch(err => console.error(err));
});