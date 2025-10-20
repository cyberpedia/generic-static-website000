(function () {
  if (window.Settings) return;

  window.Settings = (() => {
    const state = { presets: { viz: {}, eq: {} } };

    async function init() {
      const data = await API.get('api/settings.php');
      state.presets.viz = data.viz_presets || {};
      state.presets.eq = data.eq_presets || {};
      addDefaultVizPresets();
      renderPresetList();
      bindUI();
    }

    function bindUI() {
      const sv = document.getElementById('save-viz-preset');
      const se = document.getElementById('save-eq-preset');
      const ap = document.getElementById('apply-preset');
      const del = document.getElementById('delete-preset');
      if (!sv || !se || !ap) return;
      sv.addEventListener('click', saveVizPreset);
      se.addEventListener('click', saveEqPreset);
      ap.addEventListener('click', applySelectedPreset);
      if (del) del.addEventListener('click', deleteSelectedPreset);
    }

    function addDefaultVizPresets() {
      const defaults = {
        'Avee Radial Glow': {
          style: 'radial',
          color1: '#19d3ae', color2: '#1e90ff',
          glow: true, trail: true, art: false,
          rot: 0.65, decay: 0.92, thickness: 1.2,
          ringFloor: 0.16, radialFloor: 0.16,
          glowStrength: 16, trailAlpha: 0.10,
          spikeScale: 1.0, waveScale: 1.0
        },
        'Avee Circle Spikes': {
          style: 'circle',
          color1: '#19d3ae', color2: '#1e90ff',
          glow: true, trail: false, art: false,
          rot: 0.35, decay: 0.92, thickness: 1.1,
          ringFloor: 0.18, radialFloor: 0.18,
          glowStrength: 12, trailAlpha: 0.08,
          spikeScale: 1.2, waveScale: 1.0
        },
        'Avee Ring Wave': {
          style: 'ring',
          color1: '#19d3ae', color2: '#1e90ff',
          glow: true, trail: true, art: true,
          rot: 0.5, decay: 0.92, thickness: 1.3,
          ringFloor: 0.16, radialFloor: 0.16,
          glowStrength: 14, trailAlpha: 0.10,
          spikeScale: 1.0, waveScale: 1.2
        },
        'Avee Mirror EQ': {
          style: 'mirror',
          color1: '#19d3ae', color2: '#1e90ff',
          glow: false, trail: false, art: false,
          rot: 0.0, decay: 0.93, thickness: 1.0,
          ringFloor: 0.12, radialFloor: 0.12,
          glowStrength: 0, trailAlpha: 0.0,
          spikeScale: 1.0, waveScale: 1.0
        },
        'Avee Particles': {
          style: 'particles',
          color1: '#19d3ae', color2: '#1e90ff',
          glow: true, trail: true, art: false,
          rot: 0.5, decay: 0.92, thickness: 1.0,
          ringFloor: 0.16, radialFloor: 0.16,
          glowStrength: 14, trailAlpha: 0.12,
          spikeScale: 1.0, waveScale: 1.0
        }
      };
      for (const [name, preset] of Object.entries(defaults)) {
        if (!state.presets.viz[name]) state.presets.viz[name] = preset;
      }
    }

    function renderPresetList() {
      const select = document.getElementById('preset-list');
      if (!select) return;
      select.innerHTML = '';
      for (const name of Object.keys(state.presets.viz)) {
        const opt = document.createElement('option');
        opt.value = `viz:${name}`;
        opt.textContent = `Viz: ${name}`;
        select.appendChild(opt);
      }
      for (const name of Object.keys(state.presets.eq)) {
        const opt = document.createElement('option');
        opt.value = `eq:${name}`;
        opt.textContent = `EQ: ${name}`;
        select.appendChild(opt);
      }
    }

    async function saveVizPreset() {
      const name = presetName();
      if (!name) return;
      const preset = {
        style: document.getElementById('viz-style').value,
        color1: document.getElementById('viz-color-1').value,
        color2: document.getElementById('viz-color-2').value,
        glow: document.getElementById('viz-glow').checked,
        trail: document.getElementById('viz-trail').checked,
        art: document.getElementById('viz-art').checked,
        rot: Number(document.getElementById('viz-rot').value || 0.6),
        decay: Number(document.getElementById('viz-decay').value || 0.92),
        thickness: Number(document.getElementById('viz-thickness').value || 1),
        ringFloor: Number(document.getElementById('viz-ring-floor').value || 0.16),
        radialFloor: Number(document.getElementById('viz-ring-floor').value || 0.16),
        glowStrength: Number(document.getElementById('viz-glow-strength').value || 12),
        trailAlpha: Number(document.getElementById('viz-trail-alpha').value || 0.08),
        spikeScale: Number(document.getElementById('viz-spike-scale').value || 1),
        waveScale: Number(document.getElementById('viz-wave-scale').value || 1)
      };
      const res = await API.post('api/settings.php', { action: 'save_viz', name, preset });
      if (res.ok) {
        state.presets.viz[name] = preset;
        renderPresetList();
      } else {
        alert(res.error || 'Failed to save');
      }
    }

    async function saveEqPreset() {
      const name = presetName();
      if (!name) return;
      const gains = [];
      document.querySelectorAll('#eq-panel input[type="range"]').forEach(sl => {
        gains[Number(sl.dataset.band)] = Number(sl.value);
      });
      const res = await API.post('api/settings.php', { action: 'save_eq', name, gains });
      if (res.ok) {
        state.presets.eq[name] = gains;
        renderPresetList();
      } else {
        alert(res.error || 'Failed to save');
      }
    }

    async function applySelectedPreset() {
      const sel = document.getElementById('preset-list').value || '';
      if (!sel) return;
      const [type, name] = sel.split(':');
      if (type === 'viz') {
        const p = state.presets.viz[name];
        if (!p) return;
        // update UI
        document.getElementById('viz-style').value = p.style;
        document.getElementById('viz-color-1').value = p.color1;
        document.getElementById('viz-color-2').value = p.color2;
        document.getElementById('viz-glow').checked = !!p.glow;
        document.getElementById('viz-trail').checked = !!p.trail;
        document.getElementById('viz-art').checked = !!p.art;
        document.getElementById('viz-rot').value = p.rot ?? 0.6;
        document.getElementById('viz-decay').value = p.decay ?? 0.92;
        document.getElementById('viz-thickness').value = p.thickness ?? 1;
        document.getElementById('viz-ring-floor').value = p.ringFloor ?? 0.16;
        document.getElementById('viz-glow-strength').value = p.glowStrength ?? 12;
        document.getElementById('viz-trail-alpha').value = p.trailAlpha ?? 0.08;
        document.getElementById('viz-spike-scale').value = p.spikeScale ?? 1;
        document.getElementById('viz-wave-scale').value = p.waveScale ?? 1;

        // apply to viz
        const viz = App.state.viz;
        viz.setStyle(p.style);
        viz.setColors(p.color1, p.color2);
        viz.setGlow(!!p.glow);
        viz.setTrail(!!p.trail);
        viz.setShowArt(!!p.art);
        viz.setRotationSpeed(p.rot ?? 0.6);
        viz.setDecay(p.decay ?? 0.92);
        viz.setThickness(p.thickness ?? 1);
        viz.setRingFloor(p.ringFloor ?? 0.16);
        viz.setRadialFloor(p.radialFloor ?? (p.ringFloor ?? 0.16));
        viz.setGlowStrength(p.glowStrength ?? 12);
        viz.setTrailAlpha(p.trailAlpha ?? 0.08);
        viz.setSpikeScale(p.spikeScale ?? 1);
        viz.setWaveScale(p.waveScale ?? 1);
      } else if (type === 'eq') {
        const gains = state.presets.eq[name];
        if (!gains) return;
        document.querySelectorAll('#eq-panel input[type="range"]').forEach(sl => {
          const i = Number(sl.dataset.band);
          const g = gains[i] ?? 0;
          sl.value = g;
          App.state.eq.setGain(i, g);
        });
      }
    }

    async function deleteSelectedPreset() {
      const sel = document.getElementById('preset-list').value || '';
      if (!sel) return;
      const [type, name] = sel.split(':');
      if (!type || !name) return;
      const res = await API.post('api/settings.php', { action: 'delete', type, name });
      if (res.ok) {
        if (type === 'viz') delete state.presets.viz[name];
        else delete state.presets.eq[name];
        renderPresetList();
      } else {
        alert(res.error || 'Failed to delete');
      }
    }

    function presetName() {
      const el = document.getElementById('preset-name');
      const name = el ? el.value.trim() : '';
      if (!name) alert('Enter a preset name');
      return name;
    }

    return { init };
  })();
})();