const API = (() => {
  const state = { csrf: null, allowed: [], uploadMax: null };

  async function init() {
    const res = await fetch('api/session.php', { credentials: 'same-origin' });
    const json = await res.json();
    state.csrf = json.csrf;
    state.allowed = json.allowed_extensions || [];
    state.uploadMax = json.max_upload_mb || null;
    return json;
  }

  async function get(path, params = {}) {
    const url = new URL(path, window.location.origin);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), { credentials: 'same-origin' });
    return res.json();
  }

  async function post(path, body = {}) {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': state.csrf
      },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    return res.json();
  }

  async function upload(path, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'X-CSRF-Token': state.csrf },
      credentials: 'same-origin',
      body: form
    });
    return res.json();
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function gradient(ctx, color1, color2, width, height) {
    const g = ctx.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, color1);
    g.addColorStop(1, color2);
    return g;
  }

  return { state, init, get, post, upload, fmtTime, gradient };
})();