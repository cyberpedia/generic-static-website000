<?php
require __DIR__ . '/config.php';

// Configure your OAuth credentials here
const DROPBOX_CLIENT_ID = 'YOUR_DROPBOX_APP_KEY';
const DROPBOX_CLIENT_SECRET = 'YOUR_DROPBOX_APP_SECRET';

const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID';
const GOOGLE_CLIENT_SECRET = 'YOUR_GOOGLE_CLIENT_SECRET';

// Compute callback URL dynamically
function base_url(): string {
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $script = $_SERVER['SCRIPT_NAME'] ?? '';
    $dir = rtrim(str_replace('\\', '/', dirname($script)), '/');
    return $scheme . '://' . $host . $dir;
}

function oauth_callback_url(): string {
    // expects .../api/cloud_callback.php
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $path = '/api/cloud_callback.php';
    return $scheme . '://' . $host . $path;
}

function load_tokens(): array {
    $data = read_json_file('tokens.json', ['dropbox' => [], 'google' => []]);
    if (!isset($data['dropbox'])) $data['dropbox'] = [];
    if (!isset($data['google'])) $data['google'] = [];
    return $data;
}

function save_tokens(array $data): bool {
    return write_json_file('tokens.json', $data);
}