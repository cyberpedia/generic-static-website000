(function () {
  const containerId = 'toast-container';

  function ensureContainer() {
    let el = document.getElementById(containerId);
    if (!el) {
      el = document.createElement('div');
      el.id = containerId;
      document.body.appendChild(el);
    }
    return el;
  }

  function show(message, type = 'info', timeout = 3000, title = null) {
    const cont = ensureContainer();
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const titleEl = document.createElement('div');
    titleEl.className = 'title';
    titleEl.textContent = title || (type === 'success' ? 'Success' : type === 'error' ? 'Error' : 'Notice');

    const msgEl = document.createElement('div');
    msgEl.className = 'msg';
    msgEl.textContent = message;

    t.appendChild(titleEl);
    t.appendChild(msgEl);
    cont.appendChild(t);

    setTimeout(() => {
      try {
        t.style.transition = 'opacity 200ms ease, transform 200ms ease';
        t.style.opacity = '0';
        t.style.transform = 'translateY(6px)';
        setTimeout(() => cont.removeChild(t), 220);
      } catch (_) {}
    }, timeout);
  }

  window.Toast = { show };
})();