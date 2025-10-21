<?php
require __DIR__ . '/config.php';

function load_playlists(): array {
    $data = read_json_file('playlists.json', ['playlists' => []]);
    if (!isset($data['playlists']) || !is_array($data['playlists'])) {
        $data['playlists'] = [];
    }
    return $data;
}

function save_playlists(array $data): bool {
    return write_json_file('playlists.json', $data);
}

function resolve_smart_tracks(array $rules): array {
    $index = read_json_file('music_index.json', []);
    $items = [];
    if (isset($index['items']) && is_array($index['items'])) {
        $items = $index['items'];
    } elseif (is_array($index)) {
        $items = $index; // plain array format
    }
    $contains = strtolower($rules['contains'] ?? '');
    $exts = array_map('strtolower', is_array($rules['exts'] ?? []) ? $rules['exts'] : []);
    $folder = strtolower($rules['folder'] ?? '');
    $min = (int)($rules['minBytes'] ?? 0);
    $max = (int)($rules['maxBytes'] ?? 0);
    $out = [];
    foreach ($items as $it) {
        $name = $it['name'] ?? '';
        $path = strtolower($it['path'] ?? '');
        $ext = strtolower($it['ext'] ?? pathinfo($name, PATHINFO_EXTENSION));
        $size = (int)($it['size'] ?? 0);
        if ($contains && strpos(strtolower($name), $contains) === false) continue;
        if (!empty($exts) && !in_array($ext, $exts, true)) continue;
        if ($folder && strpos($path, strtolower($folder)) !== 0) continue;
        if ($min && $size < $min) continue;
        if ($max && $size > $max) continue;
        $out[] = ['path' => $it['path'], 'name' => $name];
    }
    return $out;
}

if (method_is('GET')) {
    $data = load_playlists();
    $id = $_GET['id'] ?? '';
    if ($id) {
        foreach ($data['playlists'] as $pl) {
            if (($pl['id'] ?? '') === $id) {
                if (($pl['type'] ?? '') === 'smart') {
                    $pl['tracks'] = resolve_smart_tracks($pl['rules'] ?? []);
                }
                send_json($pl);
            }
        }
        send_json(['error' => 'Not found'], 404);
    }
    send_json($data);
}

if (method_is('POST')) {
    require_post_csrf();
    $payload = json_input();
    $action = $payload['action'] ?? '';
    $data = load_playlists();

    if ($action === 'create') {
        $name = trim($payload['name'] ?? '');
        if ($name === '') send_json(['error' => 'Name required'], 422);
        $id = bin2hex(random_bytes(8));
        $pl = ['id' => $id, 'name' => $name, 'tracks' => [], 'created' => time(), 'type' => 'static'];
        $data['playlists'][] = $pl;
        save_playlists($data);
        send_json(['ok' => true, 'playlist' => $pl]);
    }

    if ($action === 'create_smart') {
        $name = trim($payload['name'] ?? '');
        $rules = $payload['rules'] ?? null;
        if ($name === '' || !is_array($rules)) send_json(['error' => 'Invalid'], 422);
        $id = bin2hex(random_bytes(8));
        $pl = ['id' => $id, 'name' => $name, 'type' => 'smart', 'rules' => $rules, 'created' => time()];
        $data['playlists'][] = $pl;
        save_playlists($data);
        send_json(['ok' => true, 'playlist' => $pl]);
    }

    if ($action === 'rename') {
        $id = $payload['id'] ?? '';
        $name = trim($payload['name'] ?? '');
        if (!$id || $name === '') send_json(['error' => 'Invalid'], 422);
        foreach ($data['playlists'] as &$pl) {
            if (($pl['id'] ?? '') === $id) {
                $pl['name'] = $name;
                save_playlists($data);
                send_json(['ok' => true]);
            }
        }
        send_json(['error' => 'Not found'], 404);
    }

    if ($action === 'delete') {
        $id = $payload['id'] ?? '';
        if (!$id) send_json(['error' => 'Invalid'], 422);
        $data['playlists'] = array_values(array_filter($data['playlists'], function ($pl) use ($id) {
            return ($pl['id'] ?? '') !== $id;
        }));
        save_playlists($data);
        send_json(['ok' => true]);
    }

    if ($action === 'add_track') {
        $id = $payload['id'] ?? '';
        $track = $payload['track'] ?? null;
        if (!$id || !is_array($track)) send_json(['error' => 'Invalid'], 422);
        foreach ($data['playlists'] as &$pl) {
            if (($pl['id'] ?? '') === $id) {
                if (($pl['type'] ?? 'static') === 'smart') {
                    send_json(['error' => 'Smart playlists are generated automatically'], 400);
                }
                $pl['tracks'][] = [
                    'path' => sanitize_relpath($track['path'] ?? ''),
                    'name' => sanitize_basename($track['name'] ?? '')
                ];
                save_playlists($data);
                send_json(['ok' => true]);
            }
        }
        send_json(['error' => 'Not found'], 404);
    }

    // Bulk add tracks to a static playlist
    if ($action === 'add_tracks_bulk') {
        $id = $payload['id'] ?? '';
        $tracks = $payload['tracks'] ?? null;
        if (!$id || !is_array($tracks)) send_json(['error' => 'Invalid'], 422);
        foreach ($data['playlists'] as &$pl) {
            if (($pl['id'] ?? '') === $id) {
                if (($pl['type'] ?? 'static') === 'smart') {
                    send_json(['error' => 'Smart playlists are generated automatically'], 400);
                }
                foreach ($tracks as $t) {
                    if (!is_array($t)) continue;
                    $path = sanitize_relpath($t['path'] ?? '');
                    $name = sanitize_basename($t['name'] ?? '');
                    if ($path === '' || $name === '') continue;
                    $pl['tracks'][] = ['path' => $path, 'name' => $name];
                }
                save_playlists($data);
                send_json(['ok' => true, 'count' => count($tracks)]);
            }
        }
        send_json(['error' => 'Not found'], 404);
    }

    if ($action === 'remove_track') {
        $id = $payload['id'] ?? '';
        $idx = (int)($payload['index'] ?? -1);
        if (!$id || $idx < 0) send_json(['error' => 'Invalid'], 422);
        foreach ($data['playlists'] as &$pl) {
            if (($pl['id'] ?? '') === $id) {
                if (($pl['type'] ?? 'static') === 'smart') {
                    send_json(['error' => 'Smart playlists are generated automatically'], 400);
                }
                if ($idx >= 0 && $idx < count($pl['tracks'])) {
                    array_splice($pl['tracks'], $idx, 1);
                    save_playlists($data);
                    send_json(['ok' => true]);
                }
            }
        }
        send_json(['error' => 'Not found'], 404);
    }

    if ($action === 'reorder') {
        $id = $payload['id'] ?? '';
        $from = (int)($payload['from'] ?? -1);
        $to = (int)($payload['to'] ?? -1);
        if (!$id || $from < 0 || $to < 0) send_json(['error' => 'Invalid'], 422);
        foreach ($data['playlists'] as &$pl) {
            if (($pl['id'] ?? '') === $id) {
                if (($pl['type'] ?? 'static') === 'smart') {
                    send_json(['error' => 'Smart playlists are generated automatically'], 400);
                }
                if ($from < count($pl['tracks']) && $to < count($pl['tracks'])) {
                    $item = $pl['tracks'][$from];
                    array_splice($pl['tracks'], $from, 1);
                    array_splice($pl['tracks'], $to, 0, [$item]);
                    save_playlists($data);
                    send_json(['ok' => true]);
                }
            }
        }
        send_json(['error' => 'Not found'], 404);
    }

    send_json(['error' => 'Unknown action'], 400);
}

send_json(['error' => 'Method not allowed'], 405);