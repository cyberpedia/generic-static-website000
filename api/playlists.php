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

if (method_is('GET')) {
    $data = load_playlists();
    $id = $_GET['id'] ?? '';
    if ($id) {
        foreach ($data['playlists'] as $pl) {
            if (($pl['id'] ?? '') === $id) {
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
        $pl = ['id' => $id, 'name' => $name, 'tracks' => [], 'created' => time()];
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

    if ($action === 'remove_track') {
        $id = $payload['id'] ?? '';
        $idx = (int)($payload['index'] ?? -1);
        if (!$id || $idx < 0) send_json(['error' => 'Invalid'], 422);
        foreach ($data['playlists'] as &$pl) {
            if (($pl['id'] ?? '') === $id) {
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