<?php
require __DIR__ . '/config.php';

if (!method_is('POST')) send_json(['error' => 'Method not allowed'], 405);
require_post_csrf();
$payload = json_input();

$rel = sanitize_relpath((string)($payload['path'] ?? ''));
if ($rel === '') send_json(['error' => 'Path required'], 422);

$full = MUSIC_DIR . '/' . $rel;
if (!is_file($full)) {
    send_json(['error' => 'File not found'], 404);
}

$ok = @unlink($full);
if (!$ok) send_json(['error' => 'Delete failed'], 500);

// update index
$index = list_music_files();
write_json_file('music_index.json', $index);

// remove from static playlists if present
$pls = read_json_file('playlists.json', ['playlists' => []]);
if (isset($pls['playlists']) && is_array($pls['playlists'])) {
    foreach ($pls['playlists'] as &$pl) {
        if (($pl['type'] ?? 'static') === 'static' && isset($pl['tracks']) && is_array($pl['tracks'])) {
            $pl['tracks'] = array_values(array_filter($pl['tracks'], function ($t) use ($rel) {
                return isset($t['path']) && sanitize_relpath((string)$t['path']) !== $rel;
            }));
        }
    }
    write_json_file('playlists.json', $pls);
}

send_json(['ok' => true, 'deleted' => $rel]);