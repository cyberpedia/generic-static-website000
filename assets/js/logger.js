(function(){
  // Studio logger: writes to #live-console if present, else falls back to a floating panel
  const Logger = {
    init() {
      if (window.BUG) return;
      const api = {
        lines: [],
        panel: null,
        pre: null,
        show() {
          if (!this.panel) this._createPanel();
          this.panel.style.display = 'block';
        },
        hide() {
          if (this.panel) this.panel.style.display = 'none';
        },
        _appendLine(line) {
          if (!this.pre) return;
          const div = document.createElement('div');
          div.className = 'line';
          div.textContent = line;
          this.pre.appendChild(div);
          this.pre.scrollTop = this.pre.scrollHeight;
        },
        log(msg, data) {
          const t = new Date().toLocaleTimeString();
          const line = `[${t}] ${String(msg)}${data !== undefined ? ' ' + JSON.stringify(data) : ''}`;
          this.lines.push(line);
          this._appendLine(line);
          try { console.log(line); } catch (_) {}
        },
        warn(msg, data) {
          this.log('WARN: ' + msg, data);
        },
        error(msg, err) {
          this.log('ERROR: ' + msg + (err && err.message ? (' ' + err.message) : ''));
        },
        clear() {
          this.lines = [];
          if (this.pre) this.pre.innerHTML = '';
        },
        _createPanel() {
          // Prefer the in-layout console container
          const anchor = document.getElementById('live-console');
          if (anchor) {
            this.panel = anchor;
            this.pre = anchor;
            return;
          }
          // Fallback to floating panel
          const panel = document.createElement('div');
          panel.id = 'debug-panel';
          panel.style.position = 'fixed';
          panel.style.bottom = '16px';
          panel.style.right = '16px';
          panel.style.width = '360px';
          panel.style.maxHeight = '40vh';
          panel.style.zIndex = '99999';
          panel.style.background = '#0f1322';
          panel.style.color = '#e6e6e9';
          panel.style.border = '1px solid #1c2236';
          panel.style.borderRadius = '12px';
          panel.style.boxShadow = '0 16px 40px rgba(0,0,0,0.45)';
          const head = document.createElement('div');
          head.style.display = 'flex';
          head.style.alignItems = 'center';
          head.style.justifyContent = 'space-between';
          head.style.padding = '8px';
          head.innerHTML = '<strong>Debug Console</strong>';
          const pre = document.createElement('div');
          pre.style.margin = '0';
          pre.style.padding = '8px';
          pre.style.maxHeight = '30vh';
          pre.style.overflow = 'auto';
          pre.style.fontFamily = 'ui-monospace, monospace';
          panel.appendChild(head);
          panel.appendChild(pre);
          document.body.appendChild(panel);
          this.panel = panel;
          this.pre = pre;
        }
      };
      window.BUG = api;

      // Hook Clear button in the UI if present
      const clearBtn = document.getElementById('console-clear');
      if (clearBtn) clearBtn.addEventListener('click', () => { api.clear(); });

      // Capture window errors and unhandled rejections
      window.addEventListener('error', (e) => {
        api.error('window.error', e.error || e.message || e);
      });
      window.addEventListener('unhandledrejection', (e) => {
        api.error('unhandledrejection', e.reason || e);
      });

      // Intercept console methods
      try {
        const orig = {
          log: console.log.bind(console),
          warn: console.warn.bind(console),
          error: console.error.bind(console)
        };
        console.log = (...args) => { orig.log(...args); try { api.log(args.map(String).join(' ')); } catch (_) {} };
        console.warn = (...args) => { orig.warn(...args); try { api.warn(args.map(String).join(' ')); } catch (_) {} };
        console.error = (...args) => { orig.error(...args); try { api.error(args.map(String).join(' ')); } catch (_) {} };
      } catch (_) {}

      api.show();
      api.log('Debug Logger initialized.');
    }
  };
  document.addEventListener('DOMContentLoaded', () => {
    Logger.init();
  });
})();