(function () {
  if (window.Cloud) return;

  window.Cloud = (() => {
    let loaded = false;

    async function init() {
      bindUI();
      // Lazy-load cloud lists only when user opens the "Cloud Files" section
      const ul = document.getElementById('cloud-list');
      const details = ul ? ul.closest('details') : null;
      if (details) {
        details.addEventListener('toggle', async () => {
          if (details.open && !loaded) {
            // clear existing items then load
            ul.innerHTML = '';
            await refreshLists();
            loaded = true;
          }
        });
      }
    }

    function bindUI() {
      const dbx = document.getElementById('connect-dropbox');
      const ggl = document.getElementById('connect-google');

      if (dbx) dbx.addEventListener('click', () => {
        window.location.href = 'api/cloud_oauth.php?provider=dropbox';
      });
      if (ggl) ggl.addEventListener('click', () => {
        window.location.href = 'api/cloud_oauth.php?provider=google';
      });
    }

    async function refreshLists() {
      await loadProvider('dropbox');
      await loadProvider('google');
    }

    async function loadProvider(provider) {
      const ul = document.getElementById('cloud-list');
      if (!ul) return;
      try {
        const data = await API.get('api/cloud_list.php', { provider });
        if (data.error) {
          // silently ignore if not connected
          return;
        }
        (data.files || []).forEach(file => {
          const li = document.createElement('li');
          li.textContent = `${file.name} (${provider})`;
          const importBtn = document.createElement('button');
          importBtn.className = 'btn';
          importBtn.textContent = 'Import';
          importBtn.addEventListener('click', async () => {
            const res = await API.post('api/cloud_import.php', { provider, id: file.id, path: file.path, name: file.name });
            if (!res.ok) {
              if (typeof Toast !== 'undefined') Toast.show(res.error || 'Import failed', 'error');
              else alert(res.error || 'Import failed');
            } else {
              if (typeof Toast !== 'undefined') Toast.show('Imported from cloud', 'success');
              await App.loadLibrary(true);
            }
          });
          li.appendChild(importBtn);
          ul.appendChild(li);
        });
      } catch (err) {
        // ignore unauthorized or HTML responses
        try { if (window.BUG) BUG.warn('cloud.loadProvider', provider, err); } catch (_) {}
      }
    }

    return { init };
  })();
})();