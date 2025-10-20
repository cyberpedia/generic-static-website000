(function(){
  // Studio logger with safe defaults: disabled unless toggled
  const Logger = {
    init() {
      if (window.BUG) return;

      const api = {
        lines: [],
        panel: null,
        pre: null,
        enabled: false,
        origConsole: null,
        errorHandler: null,
        rejectHandler: null,

        show() {
          if (!this.panel) this._createPanel();
          this.panel.style.display = 'block';
        },
        hide() {
          if (this.panel) this.panel.style.display = 'none';
        },
        _appendLine(line) {
          if (!this.pre || !this.enabled) return;
          const div = document.createElement('div');
          div.className = 'line';
          div.textContent = line;
          this.pre.appendChild(div);
          // cap to 300 lines
          if (this.pre.children.length > 300) {
            this.pre.removeChild(this.pre.firstChild);
          }
          this.pre.scrollTop = this.pre.scrollHeight;
        },
        log(msg, data) {
          if (!this.enabled) return;
          const t = new Date().toLocaleTimeString();
          const line = `[${t}] ${String(msg)}${data !== undefined ? ' ' + JSON.stringify(data) : ''}`;
          this.lines.push(line);
          this._appendLine(line);
        },
        warn(msg, data) { this.log('WARN: ' + msg, data); },
        error(msg, err) { this.log('ERROR: ' + msg + (err && err.message ? (' ' + err.message) : '')); },
        clear() {
          this.lines = [];
          if (this.pre) this.pre.innerHTML = '';
        },

        _createPanel() {
          const anchor = document.getElementById('live-console');
          if (anchor) {
            this.panel = anchor;
            this.pre = anchor;
            return;
          }
          // Fallback floating panel (rare)
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
        },

        enable() {
          if (this.enabled) return;
          this.enabled = true;
          window.DEBUG = true;

          // Hook Clear button
          const clearBtn = document.getElementById('console-clear');
          if (clearBtn) clearBtn.addEventListener('click', () => { this.clear(); });

          // Capture errors
          this.errorHandler = (e) => { this.error('window.error', e.error || e.message || e); };
          this.rejectHandler = (e) => { this.error('unhandledrejection', e.reason || e); };
          window.addEventListener('error', this.errorHandler);
          window.addEventListener('unhandledrejection', this.rejectHandler);

          // Intercept console methods
          try {
            this.origConsole = {
              log: console.log.bind(console),
              warn: console.warn.bind(console),
              error: console.error.bind(console)
            };
            console.log = (...args) => { this.origConsole.log(...args); try { this.log(args.map(String).join(' ')); } catch (_) {} };
            console.warn = (...args) => { this.origConsole.warn(...args); try { this.warn(args.map(String).join(' ')); } catch (_) {} };
            console.error = (...args) => { this.origConsole.error(...args); try { this.error(args.map(String).join(' ')); } catch (_) {} };
          } catch (_) {}

          const toggle = document.getElementById('debug-toggle');
          if (toggle) toggle.textContent = 'Disable Debug';

          this.show();
          this.log('Debug Logger enabled.');
        },

        disable() {
          if (!this.enabled) return;
          this.enabled = false;
          window.DEBUG = false;

          // Restore console
          try {
            if (this.origConsole) {
              console.log = this.origConsole.log;
              console.warn = this.origConsole.warn;
              console.error = this.origConsole.error;
            }
          } catch (_) {}

          // Remove error hooks
          try {
            if (this.errorHandler) window.removeEventListener('error', this.errorHandler);
            if (this.rejectHandler) window.removeEventListener('unhandledrejection', this.rejectHandler);
          } catch (_) {}

          const toggle = document.getElementById('debug-toggle');
          if (toggle) toggle.textContent = 'Enable Debug';

          this.log('Debug Logger disabled.');
        }
      };

      window.BUG = api;
      window.DEBUG = true; // enable debug by default

      api.show();
      api.enable(); // turn on capture and logging by default

      // Wire toggle button
      const toggle = document.getElementById('debug-toggle');
      if (toggle) {
        toggle.textContent = 'Disable Debug';
        toggle.addEventListener('click', () => {
          if (!api.enabled) api.enable(); else api.disable();
        });
      }

      const clearBtn = document.getElementById('console-clear');
      if (clearBtn) clearBtn.addEventListener('click', () => { api.clear(); });
    }
  };
  document.addEventListener('DOMContentLoaded', () => { Logger.init(); });
})();