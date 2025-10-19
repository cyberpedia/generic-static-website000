const API = (() => {
  const state = { csrf: null, allowed: [], uploadMax: null };

  function baseURL(path) {
    // Build URL relative to current directory, robust against <base> tags and non-root deployments
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return new URL(path, base);
  }

  async function init() {
    const res = await fetch(baseURL('api/session.php'), { credentials: 'same-origin' });
    const json = await safeJson(res);
    state.csrf = json.csrf;
    state.allowed = json.allowed_extensions || [];
    state.uploadMax = json.max_upload_mb || null;
    return json;
  }

  async function get(path, params = {}) {
    const url = baseURL(path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), { credentials: 'same-origin' });
    return safeJson(res);
  }

  async function post(path, body = {}) {
    const res = await fetch(baseURL(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': state.csrf
      },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    return safeJson(res);
  }

  async function upload(path, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(baseURL(path), {
      method: 'POST',
      headers: { 'X-CSRF-Token': state.csrf },
      credentials: 'same-origin',
      body: form
    });
    return safeJson(res);
  }

  async function safeJson(res) {
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    if (ct.includes('application/json')) {
      try {
        return await res.json();
      } catch (_) {
        return { ok: false, status: res.status, error: 'Invalid JSON body' };
      }
    }
    // Fallback: try to parse, else return text for diagnostics
    try {
      return await res.json();
    } catch (_) {
      const txt = await res.text();
      return { ok: false, status: res.status, error: 'Invalid JSON', body: txt };
    }
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