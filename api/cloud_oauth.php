<?php
require __DIR__ . '/cloud_config.php';

$provider = $_GET['provider'] ?? '';
if (!in_array($provider, ['dropbox', 'google'], true)) {
    send_json(['error' => 'Unknown provider'], 400);
}

$state = bin2hex(random_bytes(16));
$_SESSION['oauth_state'] = $state;
$_SESSION['oauth_provider'] = $provider;

$redirect = oauth_callback_url();

if ($provider === 'dropbox') {
    $params = http_build_query([
        'response_type' => 'code',
        'client_id' => DROPBOX_CLIENT_ID,
        'redirect_uri' => $redirect,
        'token_access_type' => 'offline',
        'state' => $state
    ]);
    header('Location: https://www.dropbox.com/oauth2/authorize?' . $params);
    exit;
}

if ($provider === 'google') {
    $scope = 'https://www.googleapis.com/auth/drive.readonly';
    $params = http_build_query([
        'response_type' => 'code',
        'client_id' => GOOGLE_CLIENT_ID,
        'redirect_uri' => $redirect,
        'scope' => $scope,
        'access_type' => 'offline',
        'prompt' => 'consent',
        'state' => $state
    ]);
    header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . $params);
    exit;
}