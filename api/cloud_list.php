<?php
require __DIR__ . '/cloud_config.php';

$provider = $_GET['provider'] ?? '';
if (!in_array($provider, ['dropbox', 'google'], true)) {
    send_json(['error' => 'Unknown provider'], 400);
}

$tokens = load_tokens();
if (empty($tokens[$provider]) || empty($tokens[$provider]['access_token'])) {
    send_json(['error' => 'Not connected'], 401);
}

$files = [];
if ($provider === 'dropbox') {
    $data = ['path' => '', 'recursive' => false, 'include_media_info' => false];
    $ch = curl_init('https://api.dropboxapi.com/2/files/list_folder');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($data),
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
    foreach (($json['entries'] ?? []) as $e) {
        if (($e['.tag'] ?? '') !== 'file') continue;
        $name = $e['name'] ?? '';
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if (!ext_allowed($ext)) continue;
        $files[] = [
            'id' => $e['id'] ?? $e['path_lower'],
            'path' => $e['path_lower'] ?? $e['path_display'] ?? $name,
            'name' => $name,
            'size' => $e['size'] ?? null
        ];
    }
    send_json(['files' => $files]);
}

if ($provider === 'google') {
    // list audio files from Google Drive
    $q = urlencode("mimeType contains 'audio/' and trashed=false");
    $fields = urlencode('files(id,name,mimeType,size)');
    $url = "https://www.googleapis.com/drive/v3/files?q=$q&fields=$fields";
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $tokens['google']['access_token']
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false
    ]);
    $resp = curl_exec($ch);
    curl_close($ch);
    $json = json_decode($resp, true);
    foreach (($json['files'] ?? []) as $f) {
        $name = $f['name'] ?? '';
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if (!ext_allowed($ext)) continue;
        $files[] = [
            'id' => $f['id'],
            'path' => $f['id'],
            'name' => $name,
            'size' => $f['size'] ?? null
        ];
    }
    send_json(['files' => $files]);
}