<?php
require __DIR__ . '/config.php';

if (!method_is('POST')) send_json(['error' => 'Method not allowed'], 405);
if (!verify_csrf()) send_json(['error' => 'Invalid CSRF'], 403);

if (empty($_FILES['file'])) send_json(['error' => 'No file'], 422);

$file = $_FILES['file'];
if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
    send_json(['error' => 'Upload error'], 400);
}

$original = sanitize_basename((string)$file['name']);
$ext = strtolower(pathinfo($original, PATHINFO_EXTENSION));

if (!ext_allowed($ext)) {
    send_json(['error' => 'File type not allowed'], 422);
}

$target = MUSIC_DIR . '/' . $original;
$base = pathinfo($original, PATHINFO_FILENAME);
$counter = 1;
while (file_exists($target)) {
    $target = MUSIC_DIR . '/' . $base . '_' . $counter . '.' . $ext;
    $counter++;
    if ($counter > 1000) send_json(['error' => 'Too many duplicates'], 500);
}

if (!move_uploaded_file($file['tmp_name'], $target)) {
    send_json(['error' => 'Failed to save'], 500);
}

$index = list_music_files();
write_json_file('music_index.json', $index);

send_json(['ok' => true, 'file' => basename($target)]);