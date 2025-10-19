<?php
require __DIR__ . '/cloud_config.php';

$state = $_GET['state'] ?? '';
$code = $_GET['code'] ?? '';
$provider = $_SESSION['oauth_provider'] ?? '';
$expected = $_SESSION['oauth_state'] ?? '';

if (!$state || !$code || !$provider || $state !== $expected) {
    http_response_code(400);
    echo '<html><body><h3>OAuth error</h3><p>Invalid state or missing data.</p><a href="/">Back</a></body></html>';
    exit;
}

unset($_SESSION['oauth_state']);
unset($_SESSION['oauth_provider']);

$redirect = oauth_callback_url();
$tokens = load_tokens();

if ($provider === 'dropbox') {
    $data = [
        'code' => $code,
        'grant_type' => 'authorization_code',
        'client_id' => DROPBOX_CLIENT_ID,
        'client_secret' => DROPBOX_CLIENT_SECRET,
        'redirect_uri' => $redirect
    ];
    $ch = curl_init('https://api.dropboxapi.com/oauth2/token');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $data,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false
    ]);
    $resp = curl_exec($ch);
    if ($resp === false) {
        $err = curl_error($ch);
        curl_close($ch);
        echo '<html><body><h3>Dropbox token error</h3><p>' . htmlspecialchars($err) . '</p><a href="/">Back</a></body></html>';
        exit;
    }
    $json = json_decode($resp, true);
    curl_close($ch);
    if (!isset($json['access_token'])) {
        echo '<html><body><h3>Dropbox token error</h3><pre>' . htmlspecialchars($resp) . '</pre><a href="/">Back</a></body></html>';
        exit;
    }
    $tokens['dropbox'] = [
        'access_token' => $json['access_token'],
        'refresh_token' => $json['refresh_token'] ?? null,
        'token_type' => $json['token_type'] ?? 'bearer',
        'scope' => $json['scope'] ?? ''
    ];
    save_tokens($tokens);
    echo '<html><body><h3>Dropbox connected</h3><a href="/">Return to player</a></body></html>';
    exit;
}

if ($provider === 'google') {
    $data = [
        'code' => $code,
        'grant_type' => 'authorization_code',
        'client_id' => GOOGLE_CLIENT_ID,
        'client_secret' => GOOGLE_CLIENT_SECRET,
        'redirect_uri' => $redirect
    ];
    $ch = curl_init('https://oauth2.googleapis.com/token');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $data,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false
    ]);
    $resp = curl_exec($ch);
    if ($resp === false) {
        $err = curl_error($ch);
        curl_close($ch);
        echo '<html><body><h3>Google token error</h3><p>' . htmlspecialchars($err) . '</p><a href="/">Back</a></body></html>';
        exit;
    }
    $json = json_decode($resp, true);
    curl_close($ch);
    if (!isset($json['access_token'])) {
        echo '<html><body><h3>Google token error</h3><pre>' . htmlspecialchars($resp) . '</pre><a href="/">Back</a></body></html>';
        exit;
    }
    $tokens['google'] = [
        'access_token' => $json['access_token'],
        'refresh_token' => $json['refresh_token'] ?? null,
        'token_type' => $json['token_type'] ?? 'bearer',
        'expires_in' => $json['expires_in'] ?? null,
        'obtained_at' => time()
    ];
    save_tokens($tokens);
    echo '<html><body><h3>Google Drive connected</h3><a href="/">Return to player</a></body></html>';
    exit;
}