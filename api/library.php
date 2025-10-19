<?php
require __DIR__ . '/config.php';

if (method_is('GET')) {
    $rescan = isset($_GET['rescan']);
    $page = max(0, (int)($_GET['page'] ?? 0));
    $size = min(500, max(10, (int)($_GET['size'] ?? 100)));

    $index = read_json_file('music_index.json', []);
    if ($rescan || empty($index)) {
        $index = list_music_files();
        write_json_file('music_index.json', $index);
    }

    $total = count($index);
    $start = $page * $size;
    $items = array_slice($index, $start, $size);

    send_json([
        'total' => $total,
        'page' => $page,
        'size' => $size,
        'items' => $items
    ]);
}

if (method_is('POST')) {
    require_post_csrf();
    $payload = json_input();
    $action = $payload['action'] ?? '';

    if ($action === 'rescan') {
        $index = list_music_files();
        write_json_file('music_index.json', $index);
        send_json(['ok' => true, 'total' => count($index)]);
    }

    send_json(['error' => 'Unknown action'], 400);
}

send_json(['error' => 'Method not allowed'], 405);