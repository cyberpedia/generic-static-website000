<?php
declare(strict_types=1);

if (PHP_SESSION_NONE === session_status()) {
    @session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Lax'
    ]);
    @session_start();
}
header('X-Content-Type-Options: nosniff');

define('DATA_DIR', __DIR__ . '/../data');
define('MUSIC_DIR', __DIR__ . '/../assets/music');

if (!is_dir(DATA_DIR)) @mkdir(DATA_DIR, 0755, true);
if (!is_dir(MUSIC_DIR)) @mkdir(MUSIC_DIR, 0755, true);

if (!isset($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

const ALLOWED_EXTENSIONS = ['mp3','wav','ogg','oga','m4a','aac','webm','opus','flac'];

function send_json($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function get_csrf_token(): string {
    return (string)($_SESSION['csrf'] ?? '');
}

function verify_csrf(): bool {
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf'] ?? '');
    $sess = $_SESSION['csrf'] ?? '';
    return is_string($token) && is_string($sess) && hash_equals($sess, $token);
}

function method_is(string $method): bool {
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? '') === strtoupper($method);
}

function require_post_csrf(): void {
    if (!method_is('POST') || !verify_csrf()) {
        send_json(['error' => 'Invalid CSRF or method'], 403);
    }
}

function ext_allowed(string $ext): bool {
    return in_array(strtolower($ext), ALLOWED_EXTENSIONS, true);
}

function sanitize_basename(string $name): string {
    $base = basename($name);
    $base = preg_replace('/[^A-Za-z0-9._\\- ]/', '_', $base);
    return $base ?: 'file';
}

function sanitize_relpath(string $path): string {
    // allow safe subdirectories: a-z, 0-9, / . _ -
    $path = str_replace('\\', '/', $path);
    $path = preg_replace('#[^A-Za-z0-9/._\\-]#', '_', $path);
    // prevent traversal
    while (str_contains($path, '../')) {
        $path = str_replace('../', '', $path);
    }
    $path = ltrim($path, '/');
    return $path;
}

function json_input(): array {
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ct, 'application/json') !== false) {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }
    return $_POST;
}

function read_json_file(string $file, $default) {
    $path = DATA_DIR . '/' . $file;
    if (!file_exists($path)) return $default;
    $fp = @fopen($path, 'r');
    if (!$fp) return $default;
    $content = '';
    if (flock($fp, LOCK_SH)) {
        $content = stream_get_contents($fp);
        flock($fp, LOCK_UN);
    }
    fclose($fp);
    $data = json_decode($content, true);
    return (is_array($data) || is_object($data)) ? $data : $default;
}

function write_json_file(string $file, $data): bool {
    $path = DATA_DIR . '/' . $file;
    $tmp = $path . '.tmp';
    $fp = @fopen($tmp, 'w');
    if (!$fp) return false;
    $ok = fwrite($fp, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)) !== false;
    fclose($fp);
    if ($ok) {
        @rename($tmp, $path);
        return true;
    }
    @unlink($tmp);
    return false;
}

function list_music_files(): array {
    $items = [];
    $flags = \FilesystemIterator::SKIP_DOTS;
    $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(MUSIC_DIR, $flags));
    foreach ($it as $file) {
        if (!$file->isFile()) continue;
        /** @var \SplFileInfo $file */
        $ext = strtolower($file->getExtension());
        if (!ext_allowed($ext)) continue;
        $path = $file->getPathname();
        $rel = substr($path, strlen(MUSIC_DIR) + 1);
        $items[] = [
            'id' => sha1($rel . '|' . $file->getMTime()),
            'path' => str_replace('\\', '/', $rel),
            'name' => $file->getBasename(),
            'ext' => $ext,
            'size' => $file->getSize(),
            'mtime' => $file->getMTime()
        ];
    }
    usort($items, function ($a, $b) {
        return strcasecmp($a['name'], $b['name']);
    });
    return $items;
}