<?php
require __DIR__ . '/config.php';

$root = realpath(__DIR__ . '/..');
$outPath = DATA_DIR . '/avee-player.zip';

// Utility: add a single file if it exists
function addFileSafe(ZipArchive $zip, string $root, string $rel): void {
    $full = $root . '/' . $rel;
    if (file_exists($full) && is_file($full)) {
        $zip->addFile($full, str_replace('\\', '/', $rel));
    }
}

// Utility: add a directory recursively with filter
function addDirFiltered(ZipArchive $zip, string $root, string $dirRel, callable $filter): void {
    $dir = $root . '/' . $dirRel;
    if (!is_dir($dir)) return;

    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ($it as $file) {
        $path = $file->getPathname();
        $rel = substr($path, strlen($root) + 1);
        // skip hidden directories like .git or any path containing /.git/
        if (strpos($rel, '/.git/') !== false || preg_match('#/(\\.git|\\.idea|node_modules)/#', $rel)) {
            continue;
        }
        if ($file->isFile()) {
            if (!$filter($rel)) continue;
            $zip->addFile($path, str_replace('\\', '/', $rel));
        }
    }
}

function defaultFilter(string $rel): bool {
    // Exclude binary uploads except .htaccess in assets/music
    if (preg_match('#^assets/music/#', $rel)) {
        return basename($rel) === '.htaccess';
    }
    // Exclude tokens.json
    if (preg_match('#^data/tokens\\.json$#', $rel)) {
        return false;
    }
    // Include everything else
    return true;
}

// Generate ZIP
function generateZip(string $root, string $outPath): bool {
    if (file_exists($outPath)) @unlink($outPath);
    $zip = new ZipArchive();
    if ($zip->open($outPath, ZipArchive::CREATE) !== true) {
        return false;
    }

    // Add top-level files
    addFileSafe($zip, $root, 'index.html');
    addFileSafe($zip, $root, 'README.md');

    // Add directories with filters
    addDirFiltered($zip, $root, 'assets', function ($rel) { return defaultFilter($rel); });
    addDirFiltered($zip, $root, 'api', function ($rel) { return defaultFilter($rel); });
    addDirFiltered($zip, $root, 'data', function ($rel) { return defaultFilter($rel); });

    // Add manifest
    $manifest = [
        'generated_at' => date('c'),
        'source_root' => $root,
        'notes' => 'This archive excludes audio files under assets/music to keep size small. It includes .htaccess there.'
    ];
    $zip->addFromString('manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

    $zip->close();
    return file_exists($outPath) && filesize($outPath) > 0;
}

$download = isset($_GET['download']);
$includeMusic = isset($_GET['include_music']); // optional future flag (currently ignored by filter)

if (!generateZip($root, $outPath)) {
    if ($download) {
        http_response_code(500);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Failed to generate ZIP.';
        exit;
    }
    send_json(['error' => 'Failed to generate ZIP'], 500);
}

if ($download) {
    header('Content-Type: application/zip');
    header('Content-Length: ' . filesize($outPath));
    header('Content-Disposition: attachment; filename="avee-player.zip"');
    readfile($outPath);
    exit;
}

send_json(['ok' => true, 'path' => str_replace($root, '', $outPath)]);