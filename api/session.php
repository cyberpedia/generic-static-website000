<?php
require __DIR__ . '/config.php';

send_json([
    'csrf' => get_csrf_token(),
    'allowed_extensions' => ALLOWED_EXTENSIONS,
    'max_upload_mb' => ini_get('upload_max_filesize')
]);