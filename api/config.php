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
const BROWSER_PLAYABLE_EXTS = ['mp3','wav','ogg','oga','m4a','aac','webm','opus']; // flac may not play in browsers

// Feature flags
const ENABLE_TRANSCODE = true; // transcode unsupported formats to mp3 if ffmpeg available
const FFMPEG_BIN = 'ffmpeg';   // path to ffmpeg binary, adjust if needed

const ENABLE_REMOTE_IMPORT = true; // allow importing audio via URL
const ALLOWED_REMOTE_HOSTS = ['dl.dropboxusercontent.com','dropboxusercontent.com','raw.githubusercontent.com'];
const MAX_REMOTE_IMPORT_MB = 50;

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

function has_ffmpeg(): bool {
    if (!ENABLE_TRANSCODE) return false;
    $cmd = strtoupper(substr(PHP_OS, 0, 3)) === 'WIN' ? 'where ' . FFMPEG_BIN : 'which ' . FFMPEG_BIN;
    $out = @shell_exec($cmd . ' 2>&1');
    return is_string($out) && trim($out) !== '';
}

function transcode_to_mp3(string $sourcePath, string $destPath): bool {
    if (!has_ffmpeg()) return false;
    $sp = escapeshellarg($sourcePath);
    $dp = escapeshellarg($destPath);
    $bin = FFMPEG_BIN;
    $cmd = "$bin -y -i $sp -vn -codec:a libmp3lame -q:a 2 $dp";
    $out = @shell_exec($cmd . ' 2>&1');
    return file_exists($destPath) && filesize($destPath) > 0;
}

function is_host_allowed(string $url): bool {
    $parts = @parse_url($url);
    if (!$parts || !isset($parts['host'])) return false;
    $host = strtolower($parts['host']);
    foreach (ALLOWED_REMOTE_HOSTS as $allowed) {
        if (substr($host, -strlen($allowed)) === strtolower($allowed)) return true;
    }
    return false;
}

function download_remote_to_music(string $url): array {
    if (!ENABLE_REMOTE_IMPORT) return ['ok' => false, 'error' => 'Remote import disabled'];
    if (!is_host_allowed($url)) return ['ok' => false, 'error' => 'Host not allowed'];
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_HEADER => true
    ]);
    $resp = curl_exec($ch);
    if ($resp === false) {
        $err = curl_error($ch);
        curl_close($ch);
        return ['ok' => false, 'error' => 'cURL error: ' . $err];
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $headers = substr($resp, 0, $headerSize);
    $body = substr($resp, $headerSize);
    $size = strlen($body);
    curl_close($ch);

    if ($status < 200 || $status >= 300) return ['ok' => false, 'error' => 'HTTP ' . $status];
    if ($size > MAX_REMOTE_IMPORT_MB * 1024 * 1024) return ['ok' => false, 'error' => 'File too large'];

    // Determine filename and extension
    $name = 'remote_' . bin2hex(random_bytes(6));
    if (preg_match('/filename=\"?([^\";]+)\"?/i', $headers, $m)) {
        $name = sanitize_basename($m[1]);
    } else {
        $path = parse_url($url, PHP_URL_PATH) ?? '';
        $base = basename($path);
        if ($base) $name = sanitize_basename($base);
    }
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!$ext) $ext = 'mp3'; // default
    if (!ext_allowed($ext)) return ['ok' => false, 'error' => 'Extension not allowed'];

    $target = MUSIC_DIR . '/' . $name;
    $base = pathinfo($name, PATHINFO_FILENAME);
    $counter = 1;
    while (file_exists($target)) {
        $target = MUSIC_DIR . '/' . $base . '_' . $counter . '.' . $ext;
        $counter++;
    }

    $ok = @file_put_contents($target, $body) !== false;
    if (!$ok) return ['ok' => false, 'error' => 'Failed to save file'];

    // Optional transcode if not browser-playable
    if (!in_array($ext, BROWSER_PLAYABLE_EXTS, true) && has_ffmpeg()) {
        $mp3 = MUSIC_DIR . '/' . $base . '.mp3';
        $ctr = 1;
        while (file_exists($mp3)) {
            $mp3 = MUSIC_DIR . '/' . $base . '_' . $ctr . '.mp3';
            $ctr++;
        }
        if (transcode_to_mp3($target, $mp3)) {
            // keep original, add mp3 to library
        }
    }

    $index = list_music_files();
    write_json_file('music_index.json', $index);

    return ['ok' => true, 'file' => basename($target)];
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