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
    tsMode: false,        // advanced time-stretch mode
    tsNode: null,         // PitchShifter node
    tsPaused: false
  };

  async function init() {
    await API.init();

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

    bindUI();
    await loadLibrary();
    PlaylistUI.init({ playTrack, getCurrentTrack: () => state.currentTrack });

    // default settings
    document.getElementById('volume').value = 0.9;
    setVolume(0.9);
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

  async function loadLibrary(rescan = false) {
    const data = await API.get('api/library.php', { page: 0, size: 500, rescan: rescan ? 1 : undefined });
    state.library = data.items || [];
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
    const track = state.library[i];
    state.currentIndex = i;
    playTrack(track);
  }

  function playTrack(track) {
    const src = 'assets/music/' + track.path;

    // Update UI info
    document.getElementById('track-title').textContent = track.name || track.path;
    state.currentTrack = { path: track.path, name: track.name };

    if (state.tsMode) {
      playTrackAdvanced(src);
      return;
    }

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

    // Art via jsmediatags if possible
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

    incoming.addEventListener('loadedmetadata', () => {
      updateTime();
    }, { once: true });

    incoming.play().then(() => {
      crossfade(incomingGain, outgoingGain, state.crossfade);
      state.useA = !state.useA;
      document.getElementById('play').textContent = 'Pause';
    }).catch(err => console.error('Playback error', err));
  }

  async function playTrackAdvanced(src) {
    // disconnect media elements from eq input
    try { state.gainA.disconnect(state.eq.input); } catch (_) {}
    try { state.gainB.disconnect(state.eq.input); } catch (_) {}

    // stop any existing ts node
    if (state.tsNode) {
      try { state.tsNode.disconnect(); } catch (_) {}
      state.tsNode = null;
    }

    // fetch and decode audio buffer
    const resp = await fetch(src);
    const arr = await resp.arrayBuffer();
    const buffer = await state.ctx.decodeAudioData(arr);

    // instantiate PitchShifter from soundtouchjs
    const node = new PitchShifter(state.ctx, buffer, 4096);
    node.connect(state.eq.input);

    // set tempo from UI
    const r = Number(document.getElementById('rate').value || 1);
    node.tempo = r;
    node.rate = 1;
    node.pitch = 1;

    // update time periodically
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      const cur = node.timePlayed || 0;
      const dur = buffer.duration || 0;
      document.getElementById('track-time').textContent = `${API.fmtTime(cur)} / ${API.fmtTime(dur)}`;
      if (cur >= dur) {
        clearInterval(state.timerInterval);
        onEnded();
      }
    }, 250);

    // save node
    state.tsNode = node;

    // set play button state
    document.getElementById('play').textContent = 'Pause';
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
    document.getElementById('play').addEventListener('click', () => {
      if (state.tsMode && state.tsNode) {
        if (state.tsPaused) {
          try { state.tsNode.connect(state.eq.input); } catch (_) {}
          state.tsPaused = false;
          document.getElementById('play').textContent = 'Pause';
        } else {
          try { state.tsNode.disconnect(); } catch (_) {}
          state.tsPaused = true;
          document.getElementById('play').textContent = 'Play';
        }
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
      if (state.tsMode && state.tsNode) {
        // advanced: change tempo (time-stretch) without pitch
        try { state.tsNode.tempo = r; } catch (_) {}
      } else {
        state

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
      for (const f of files) {
        const res = await API.upload('api/upload.php', f);
        if (!res.ok) alert(res.error || 'Upload failed');
      }
      await loadLibrary(true);
      up.value = '';
    });

    document.getElementById('viz-style').addEventListener('change', (e) => {
      state.viz.setStyle(e.target.value);
    });
    document.getElementById('viz-color-1').addEventListener('change', (e) => {
      state.viz.setColors(e.target.value, document.getElementById('viz-color-2').value);
    });
    document.getElementById('viz-color-2').addEventListener('change', (e) => {
      state.viz.setColors(document.getElementById('viz-color-1').value, e.target.value);
    });

    document.getElementById('eq-toggle').addEventListener('click', () => {
      document.getElementById('eq-panel').classList.toggle('show');
    });

    const advBtn = document.getElementById('advanced-stretch');
    if (advBtn) {
      advBtn.addEventListener('click', () => {
        state.tsMode = !state.tsMode;
        advBtn.classList.toggle('primary', state.tsMode);
        if (state.tsMode && state.currentTrack) {
          playTrack(state.currentTrack);
        } else {
          // reconnect media element sources
          try { state.gainA.connect(state.eq.input); } catch (_) {}
          try { state.gainB.connect(state.eq.input); } catch (_) {}
          if (state.tsNode) {
            try { state.tsNode.disconnect(); } catch (_) {}
            state.tsNode = null;
          }
        }
      });
    }
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
  }

  function setVolume(v) {
    // control via element volume plus master gain
    const active = state.useA ? state.audioB : state.audioA;
    active.volume = v;
    state.master && (state.master.gain.value = v);
  }

  function toggleRecording() {
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
    const props = ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch'];
    for (const p of props) {
      try { state.audioA[p] = on; } catch (_) {}
      try { state.audioB[p] = on; } catch (_) {}
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