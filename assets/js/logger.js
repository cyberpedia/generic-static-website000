(function () {
  const BUG = {};
  const logs = [];
  let panel, pre, controls;

  function now() {
    const d = new Date();
    return d.toISOString();
  }

  function fmtArgs(args) {
    try {
      return args.map(a => {
        if (a instanceof Error) return (a.stack || (a.name + ': ' + a.message));
        if (typeof a === 'object') return JSON.stringify(a);
        return String(a);
      }).join(' ');
    } catch (_) {
      try { return args.map(String).join(' '); } catch (__){ return '[unserializable]'; }
    }
  }

  function append(type, args) {
    const line = `[${now()}] ${type}: ${fmtArgs(args)}`;
    logs.push(line);
    if (pre) {
      pre.textContent = logs.join('\n');
      pre.scrollTop = pre.scrollHeight;
    }
  }

  function createPanel() {
    panel = document.createElement('div');
    panel.id = 'debug-panel';

    // If a logger anchor exists in the page, render as a normal block there (not floating).
    const anchor = document.getElementById('logger-anchor');
    const isDocked = !!anchor;

    if (isDocked) {
      panel.style.position = 'static';
      panel.style.width = '100%';
      panel.style.maxHeight = '30vh';
      panel.style.background = 'rgba(16,16,24,0.9)';
      panel.style.color = '#e6e6e9';
      panel.style.fontFamily = 'monospace';
      panel.style.fontSize = '12px';
      panel.style.borderTop = '1px solid #333';
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
      panel.style.marginTop = '10px';
      panel.style.marginBottom = '10px';
    } else {
      // Fallback to floating panel fixed at the bottom if no anchor is present.
      panel.style.position = 'fixed';
      panel.style.left = '0';
      panel.style.right = '0';
      panel.style.bottom = '0';
      panel.style.maxHeight = '30vh';
      panel.style.background = 'rgba(16,16,24,0.9)';
      panel.style.color = '#e6e6e9';
      panel.style.fontFamily = 'monospace';
      panel.style.fontSize = '12px';
      panel.style.borderTop = '1px solid #333';
      panel.style.zIndex = '99999';
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
    }

    controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.padding = '6px 8px';
    controls.style.alignItems = 'center';
    controls.style.borderBottom = '1px solid #333';

    const title = document.createElement('div');
    title.textContent = 'Debug Console (temporary)';
    title.style.flex = '1';
    controls.appendChild(title);

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.style.padding = '4px 8px';
    copyBtn.addEventListener('click', async () => {
      const txt = logs.join('\n');

      const fallbackCopy = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = txt;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          const ok = document.execCommand && document.execCommand('copy');
          document.body.removeChild(ta);
          if (ok && window.Toast) Toast.show('Logs copied', 'success', 1500);
        } catch (err) {
          console.warn('Copy fallback failed', err);
          if (window.Toast) Toast.show('Copy failed', 'error', 2000);
        }
      };

      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(txt);
          if (window.Toast) Toast.show('Logs copied', 'success', 1500);
        } else {
          fallbackCopy();
        }
      } catch (e) {
        fallbackCopy();
      }
    });
    controls.appendChild(copyBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.style.padding = '4px 8px';
    clearBtn.addEventListener('click', () => {
      logs.length = 0;
      if (pre) pre.textContent = '';
    });
    controls.appendChild(clearBtn);

    const hideBtn = document.createElement('button');
    hideBtn.textContent = 'Hide';
    hideBtn.style.padding = '4px 8px';
    hideBtn.addEventListener('click', () => {
      panel.style.display = 'none';
    });
    controls.appendChild(hideBtn);

    pre = document.createElement('pre');
    pre.style.margin = '0';
    pre.style.padding = '8px';
    pre.style.overflow = 'auto';
    pre.style.flex = '1';

    panel.appendChild(controls);
    panel.appendChild(pre);
    const anchor = document.getElementById('logger-anchor');
    if (anchor) {
      anchor.appendChild(panel);
    } else {
      document.body.appendChild(panel);
    }
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createPanel);
    } else {
      createPanel();
    }

    const orig = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    };

    console.log = (...args) => { try { append('LOG', args); } catch (_) {} orig.log(...args); };
    console.warn = (...args) => { try { append('WARN', args); } catch (_) {} orig.warn(...args); };
    console.error = (...args) => { try { append('ERROR', args); } catch (_) {} orig.error(...args); };

    window.addEventListener('error', (ev) => {
      append('WINDOW.ERROR', [ev.message, ev.filename + ':' + ev.lineno + ':' + ev.colno]);
    });

    window.addEventListener('unhandledrejection', (ev) => {
      append('PROMISE.REJECTION', [ev.reason]);
    });

    BUG.log = (...args) => append('BUG', args);
    BUG.warn = (...args) => append('BUG.WARN', args);
    BUG.error = (...args) => append('BUG.ERROR', args);
    BUG.logs = () => logs.slice();
    BUG.clear = () => { logs.length = 0; if (pre) pre.textContent = ''; };
    BUG.show = () => { if (panel) panel.style.display = 'flex'; };
    BUG.hide = () => { if (panel) panel.style.display = 'none'; };

    window.BUG = BUG;

    append('BUG', ['Logger initialized']);
    try { console.log('Debug Logger initialized'); } catch (_) {}
  }

  init();
})();