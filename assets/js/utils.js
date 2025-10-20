const API = (() => {
  const state = { csrf: null, allowed: [], uploadMax: null };

  // Build URL under current directory (supports subfolders like /Djweb-main/)
  const basePath = (() => {
    const p = window.location.pathname;
    if (p.endsWith('/')) return p;
    const i = p.lastIndexOf('/');
    return i >= 0 ? p.slice(0, i + 1) : '/';
  })();

  function buildURL(path, params = {}) {
    // Absolute URL passthrough
    if (/^https?:\/\//i.test(path)) {
      const url = new URL(path);
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, v);
      }
      return url.toString();
    }
    const url = new URL(basePath + path.replace(/^\//, ''), window.location.origin);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    return url.toString();
  }

  // Build a resource URL under current directory, encoding each path segment safely (handles spaces, #, ?)
  function resource(path) {
    const rel = path.replace(/^\//, '');
    const segs = rel.split('/').map(s => encodeURIComponent(s));
    return basePath + segs.join('/');
  }

  async function init() {
    const res = await fetch(buildURL('api/session.php'), { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
    const json = await res.json();
    state.csrf = json.csrf;
    state.allowed = json.allowed_extensions || [];
    state.uploadMax = json.max_upload_mb || null;
    return json;
  }

  async function get(path, params = {}) {
    const url = buildURL(path, params);
    const res = await fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    const text = await res.text();
    throw new Error(`Unexpected response: ${text.slice(0, 120)}`);
  }

  async function post(path, body = {}) {
    const url = buildURL(path);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': state.csrf,
        'Accept': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    const text = await res.text();
    throw new Error(`Unexpected response: ${text.slice(0, 120)}`);
  }

  async function upload(path, file) {
    const url = buildURL(path);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-CSRF-Token': state.csrf, 'Accept': 'application/json' },
      credentials: 'same-origin',
      body: form
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    const text = await res.text();
    throw new Error(`Unexpected response: ${text.slice(0, 120)}`);
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

  return { state, init, get, post, upload, fmtTime, gradient, buildURL, resource };
})();