const Settings = (() => {
  const state = { presets: { viz: {}, eq: {} } };

  async function init() {
    const data = await API.get('api/settings.php');
    state.presets.viz = data.viz_presets || {};
    state.presets.eq = data.eq_presets || {};
    renderPresetList();
    bindUI();
  }

  function bindUI() {
    const sv = document.getElementById('save-viz-preset');
    const se = document.getElementById('save-eq-preset');
    const ap = document.getElementById('apply-preset');
    if (!sv || !se || !ap) return;
    sv.addEventListener('click', saveVizPreset);
    se.addEventListener('click', saveEqPreset);
    ap.addEventListener('click', applySelectedPreset);
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
      color2: document.getElementById('viz-color-2').value
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
      document.getElementById('viz-style').value = p.style;
      document.getElementById('viz-color-1').value = p.color1;
      document.getElementById('viz-color-2').value = p.color2;
      App.state.viz.setStyle(p.style);
      App.state.viz.setColors(p.color1, p.color2);
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

  function presetName() {
    const el = document.getElementById('preset-name');
    const name = el ? el.value.trim() : '';
    if (!name) alert('Enter a preset name');
    return name;
  }

  return { init };
})();