(function () {
  if (window.PlaylistUI) return;

  window.PlaylistUI = (() => {
    const state = { selectedId: null, app: null };

    function init(app) {
      state.app = app;
      document.getElementById('create-playlist').addEventListener('click', createPlaylist);
      document.getElementById('create-smart').addEventListener('click', createSmartPlaylist);
      document.getElementById('add-current').addEventListener('click', addCurrent);
      document.getElementById('delete-playlist').addEventListener('click', deleteSelected);
      loadPlaylists();
    }

    async function loadPlaylists() {
      const data = await API.get('api/playlists.php');
      renderPlaylists(data.playlists || []);
    }

    function renderPlaylists(playlists) {
      const ul = document.getElementById('playlists');
      ul.innerHTML = '';
      playlists.forEach(pl => {
        const li = document.createElement('li');
        li.textContent = pl.name + (pl.type === 'smart' ? ' • Smart' : '');
        li.dataset.id = pl.id;
        li.addEventListener('click', () => selectPlaylist(pl.id));
        if (pl.id === state.selectedId) li.classList.add('active');
        ul.appendChild(li);
      });
      if (!state.selectedId && playlists.length > 0) selectPlaylist(playlists[0].id);
    }

    async function selectPlaylist(id) {
      state.selectedId = id;
      const data = await API.get('api/playlists.php', { id });
      document.getElementById('playlist-title').textContent = data.name || 'Playlist';
      const ul = document.getElementById('playlist-tracks');
      ul.innerHTML = '';
      (data.tracks || []).forEach((t, i) => {
        const li = document.createElement('li');
        li.textContent = t.name || t.path;
        const actions = document.createElement('div');
        const playBtn = document.createElement('button');
        playBtn.className = 'btn';
        playBtn.textContent = 'Play';
        playBtn.addEventListener('click', () => state.app.playTrack(t));
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn';
        removeBtn.textContent = 'Remove';
        removeBtn.disabled = data.type === 'smart';
        removeBtn.addEventListener('click', () => removeTrack(i));
        actions.appendChild(playBtn);
        actions.appendChild(removeBtn);
        li.appendChild(actions);
        ul.appendChild(li);
      });

      // highlight selected in list
      [...document.querySelectorAll('#playlists li')].forEach(li => {
        li.classList.toggle('active', li.dataset.id === id);
      });
    }

    async function createPlaylist() {
      const nameInput = document.getElementById('new-playlist-name');
      const name = nameInput.value.trim();
      if (!name) return;
      const res = await API.post('api/playlists.php', { action: 'create', name });
      nameInput.value = '';
      if (res.ok) {
        loadPlaylists();
        selectPlaylist(res.playlist.id);
      }
    }

    async function createSmartPlaylist() {
      const name = (document.getElementById('smart-name').value || '').trim();
      const contains = (document.getElementById('smart-contains').value || '').trim();
      const exts = (document.getElementById('smart-exts').value || '').trim().toLowerCase();
      const folder = (document.getElementById('smart-folder').value || '').trim();
      const minMb = Number(document.getElementById('smart-minmb').value || '0');
      const maxMb = Number(document.getElementById('smart-maxmb').value || '0');
      if (!name) return alert('Enter smart playlist name');

      const rules = {
        contains,
        exts: exts ? exts.split(',').map(s => s.trim()).filter(Boolean) : [],
        folder,
        minBytes: minMb > 0 ? Math.round(minMb * 1024 * 1024) : 0,
        maxBytes: maxMb > 0 ? Math.round(maxMb * 1024 * 1024) : 0
      };
      const res = await API.post('api/playlists.php', { action: 'create_smart', name, rules });
      if (res.ok) {
        loadPlaylists();
        selectPlaylist(res.playlist.id);
        document.getElementById('smart-name').value = '';
        document.getElementById('smart-contains').value = '';
        document.getElementById('smart-exts').value = '';
        document.getElementById('smart-folder').value = '';
        document.getElementById('smart-minmb').value = '';
        document.getElementById('smart-maxmb').value = '';
      } else {
        alert(res.error || 'Failed to create smart playlist');
      }
    }

    async function addCurrent() {
      if (!state.selectedId) return;
      const t = state.app.getCurrentTrack();
      if (!t) return;
      const res = await API.post('api/playlists.php', { action: 'add_track', id: state.selectedId, track: t });
      if (res.ok) selectPlaylist(state.selectedId);
    }

    async function removeTrack(index) {
      if (!state.selectedId) return;
      const res = await API.post('api/playlists.php', { action: 'remove_track', id: state.selectedId, index });
      if (res.ok) selectPlaylist(state.selectedId);
    }

    async function deleteSelected() {
      if (!state.selectedId) return;
      const res = await API.post('api/playlists.php', { action: 'delete', id: state.selectedId });
      if (res.ok) {
        state.selectedId = null;
        loadPlaylists();
        document.getElementById('playlist-title').textContent = 'Playlist';
        document.getElementById('playlist-tracks').innerHTML = '';
      }
    }

    return { init, selectPlaylist };
  })();
})();