<?php
require __DIR__ . '/cloud_config.php';

if (!method_is('POST')) send_json(['error' => 'Method not allowed'], 405);
if (!verify_csrf()) send_json(['error' => 'Invalid CSRF'], 403);

$payload = json_input();
$provider = $payload['provider'] ?? '';
$id = $payload['id'] ?? '';
$path = $payload['path'] ?? '';
$name = sanitize_basename($payload['name'] ?? '');

if (!in_array($provider, ['dropbox', 'google'], true)) send_json(['error' => 'Unknown provider'], 400);

$tokens = load_tokens();
if (empty($tokens[$provider]) || empty($tokens[$provider]['access_token'])) {
    send_json(['error' => 'Not connected'], 401);
}

if ($provider === 'dropbox') {
    $ch = curl_init('https://api.dropboxapi.com/2/files/get_temporary_link');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['path' => $path ?: $id]),
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $tokens['dropbox']['access_token'],
            'Content-Type: application/json'
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false
    ]);
    $resp = curl_exec($ch);
    curl_close($ch);
    $json = json_decode($resp, true);
    $link = $json['link'] ?? null;
    if (!$link) send_json(['error' => 'Failed to get temporary link'], 500);

    $res = download_remote_to_music($link);
    if (!$res['ok']) send_json($res, 400);
    send_json(['ok' => true, 'file' => $res['file']]);
}

if ($provider === 'google') {
    // Download via Drive API
    // Get metadata for filename if missing
    if (!$name) {
        $metaUrl = 'https://www.googleapis.com/drive/v3/files/' . urlencode($id) . '?fields=name';
        $chm = curl_init($metaUrl);
        curl_setopt_array($chm, [
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $tokens['google']['access_token']],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_SSL_VERIFYPEER => false
        ]);
        $metaResp = curl_exec($chm);
        curl_close($chm);
        $meta = json_decode($metaResp, true);
        $name = sanitize_basename($meta['name'] ?? ('drive_' . $id));
    }
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!ext_allowed($ext)) {
        // Force mp3 fallback
        $ext = 'mp3';
        $name = pathinfo($name, PATHINFO_FILENAME) . '.mp3';
    }
    $target = MUSIC_DIR . '/' . $name;
    $base = pathinfo($name, PATHINFO_FILENAME);
    $counter = 1;
    while (file_exists($target)) {
        $target = MUSIC_DIR . '/' . $base . '_' . $counter . '.' . $ext;
        $counter++;
    }
    $url = 'https://www.googleapis.com/drive/v3/files/' . urlencode($id) . '?alt=media';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $tokens['google']['access_token']],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    if (!is_string($body) || $body === '') send_json(['error' => 'Download failed'], 500);
    $ok = @file_put_contents($target, $body) !== false;
    if (!$ok) send_json(['error' => 'Save failed'], 500);

    // Optional transcode if needed
    if (!in_array($ext, BROWSER_PLAYABLE_EXTS, true) && has_ffmpeg()) {
        $mp3 = MUSIC_DIR . '/' . $base . '.mp3';
        $ctr = 1;
        while (file_exists($mp3)) {
            $mp3 = MUSIC_DIR . '/' . $base . '_' . $ctr . '.mp3';
            $ctr++;
        }
        transcode_to_mp3($target, $mp3);
    }

    $index = list_music_files();
    write_json_file('music_index.json', $index);
    send_json(['ok' => true, 'file' => basename($target)]);
}