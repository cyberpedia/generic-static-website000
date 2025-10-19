<?php
require __DIR__ . '/config.php';

function load_settings(): array {
    $data = read_json_file('settings.json', ['viz_presets' => [], 'eq_presets' => []]);
    if (!isset($data['viz_presets']) || !is_array($data['viz_presets'])) $data['viz_presets'] = [];
    if (!isset($data['eq_presets']) || !is_array($data['eq_presets'])) $data['eq_presets'] = [];
    return $data;
}

function save_settings(array $data): bool {
    return write_json_file('settings.json', $data);
}

if (method_is('GET')) {
    $data = load_settings();
    send_json($data);
}

if (method_is('POST')) {
    require_post_csrf();
    $payload = json_input();
    $action = $payload['action'] ?? '';
    $data = load_settings();

    if ($action === 'save_viz') {
        $name = trim($payload['name'] ?? '');
        $preset = $payload['preset'] ?? null;
        if ($name === '' || !is_array($preset)) send_json(['error' => 'Invalid'], 422);
        $data['viz_presets'][$name] = [
            'style' => sanitize_basename($preset['style'] ?? 'bars'),
            'color1' => (string)($preset['color1'] ?? '#19d3ae'),
            'color2' => (string)($preset['color2'] ?? '#1e90ff'),
        ];
        save_settings($data);
        send_json(['ok' => true]);
    }

    if ($action === 'save_eq') {
        $name = trim($payload['name'] ?? '');
        $gains = $payload['gains'] ?? null;
        if ($name === '' || !is_array($gains)) send_json(['error' => 'Invalid'], 422);
        $clean = [];
        for ($i = 0; $i < 10; $i++) {
            $clean[$i] = (float)($gains[$i] ?? 0);
        }
        $data['eq_presets'][$name] = $clean;
        save_settings($data);
        send_json(['ok' => true]);
    }

    if ($action === 'delete') {
        $type = $payload['type'] ?? '';
        $name = trim($payload['name'] ?? '');
        if (!in_array($type, ['viz', 'eq'], true) || $name === '') send_json(['error' => 'Invalid'], 422);
        if ($type === 'viz') unset($data['viz_presets'][$name]);
        else unset($data['eq_presets'][$name]);
        save_settings($data);
        send_json(['ok' => true]);
    }

    send_json(['error' => 'Unknown action'], 400);
}

send_json(['error' => 'Method not allowed'], 405);