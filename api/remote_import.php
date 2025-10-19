<?php
require __DIR__ . '/config.php';

if (!method_is('POST')) send_json(['error' => 'Method not allowed'], 405);
if (!verify_csrf()) send_json(['error' => 'Invalid CSRF'], 403);

$payload = json_input();
$url = $payload['url'] ?? '';
if (!is_string($url) || trim($url) === '') send_json(['error' => 'No URL'], 422);

$res = download_remote_to_music($url);
if (!$res['ok']) send_json($res, 400);

send_json($res);