# Avee-like Media Player (PHP/XAMPP)

A fully-featured, browser-based media player built with PHP and the Web Audio API, designed to run on XAMPP. It delivers feature parity with Avee Player Pro's core capabilities and adds enhancements like exportable visualizer recordings, crossfade, and secure uploads.

## Features

- Audio playback with:
  - Crossfade between tracks
  - Shuffle and repeat
  - Volume and playback speed control
  - Pitch Lock toggle (preserve pitch while changing speed)
- Customizable visualizers:
  - Styles: bars, waveform, circular spectrum
  - Color gradients
  - Real-time rendering via Web Audio API
  - Record visualizer (WebM) with audio using MediaRecorder
  - Save/Load visualizer presets
- Playlist management:
  - Create, delete, rename (via API)
  - Add/remove tracks
  - Play from playlists
  - Smart playlists (rules-based generation: name contains, extensions, folder prefix, size range)
- Equalizer:
  - 10-band peaking EQ (31 Hz – 16 kHz)
  - Presets: Flat, Pop, Rock, Jazz, Bass Boost, Treble Boost
  - Save/Load custom EQ presets
- PHP integration:
  - Library scanning from `assets/music/`
  - Secure upload endpoint with CSRF protection
  - File-based storage for library index and playlists (JSON)
  - Import audio from remote URLs (Dropbox direct links, GitHub raw)
  - OAuth-based Cloud integrations (Dropbox, Google Drive) to list and import files
- Security:
  - CSRF protection on all POST endpoints
  - Upload directory disables PHP execution via `.htaccess`
  - Input sanitization and extension whitelisting
  - Allowed-hosts restriction and size limits for remote imports
- Performance and scalability:
  - Cached library index (`data/music_index.json`)
  - Pagination-ready endpoints
  - Efficient Web Audio pipeline and lazy UI rendering
  - Optional FFmpeg transcoding to MP3 for broader compatibility

## Directory Structure

```
index.html
assets/
  style.css
  script.js
  js/
    utils.js
    equalizer.js
    visualizer.js
    playlists.js
    settings.js
    cloud.js
    app.js
  music/
    .htaccess
api/
  config.php
  session.php
  library.php
  playlists.php
  upload.php
  remote_import.php
  settings.php
  cloud_config.php
  cloud_oauth.php
  cloud_callback.php
  cloud_list.php
  cloud_import.php
data/
  music_index.json
  playlists.json
  settings.json
  tokens.json
```

## Setup (XAMPP)

1. Copy this project into your XAMPP `htdocs` directory, e.g.:
   - Windows: `C:\xampp\htdocs\avee-player`
   - macOS: `/Applications/XAMPP/htdocs/avee-player`
   - Linux: `/opt/lampp/htdocs/avee-player`
2. Ensure Apache/PHP are running.
3. Visit `http://localhost/avee-player/` in your browser.
4. Optional: FFmpeg for transcoding
   - Install FFmpeg and ensure it's in PATH (`ffmpeg` CLI).
   - Adjust `FFMPEG_BIN` in `api/config.php` if needed.
5. Optional: cURL for remote import + cloud integrations
   - Ensure PHP cURL extension is enabled (`php.ini`: `extension=curl`).
6. Cloud OAuth setup:
   - Open `api/cloud_config.php` and set your credentials:
     - `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`
     - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - Set your OAuth redirect URI to: `http://localhost/api/cloud_callback.php` (adjust host/path if different).
7. Add audio files by:
   - Dropping them into `assets/music/`
   - Using the Upload button (accepted: mp3, wav, ogg/opus, m4a/aac, webm, flac*)
   - Importing from URL (Dropbox direct links or GitHub raw)
   - Using Cloud: Connect Dropbox/Google Drive, list files, and click Import.
   - Note: Remote imports are size-limited and host-restricted; configure in `api/config.php`.

\* Note: Browser support for formats varies. MP3, AAC/M4A, OGG/Opus, WAV, and WebM are widely supported. FLAC may not play natively but is stored and indexed. Unsupported formats (e.g., FLAC in some browsers) are optionally transcoded to MP3 if FFmpeg is available.

## Usage

- Library sidebar:
  - Search, rescan, upload
  - Import via URL
  - Connect Dropbox/Google Drive and import cloud files
  - Click a track to play
- Player core:
  - Visualizer renders real-time spectrum/waveform
  - Controls for play/pause, next/prev, shuffle/repeat, volume, speed, Pitch Lock
  - Advanced time-stretch engine (SoundTouch.js) toggle for higher quality at extreme rates
  - Record to WebM (Canvas + Audio) via MediaRecorder (Chrome/Edge)
- Equalizer and Visualizer presets:
  - Toggle the EQ panel
  - Use presets or adjust individual bands
  - Save/Load presets for EQ and Visualizer
- Playlists:
  - Create/select a playlist
  - Add the current track using "Add Current Track"
  - Remove tracks from the playlist
  - Create Smart playlists via rule builder (name contains, extensions, folder prefix, size range)

## Security Notes

- Uploads are restricted to a safe extension whitelist.
- CSRF tokens are required for all state-changing API calls.
- PHP engine is disabled in `assets/music/` via `.htaccess`.

## Enhancements Roadmap

- Optional FFmpeg integration (server-side transcoding to MP3 for unsupported formats)
- Cloud sync (Dropbox/Google Drive) using API integrations
- Smart playlists (rules-based generation)
- Gapless playback with pre-buffering improvements
- Advanced time-stretching (tempo without pitch shift) via SoundTouch.js

## Export / Download

- Generate a ZIP archive of the project (excluding audio files in `assets/music`) via:
  - HTTP: `http://localhost/avee-player/api/export.php?download=1`
  - The generated file is saved to `data/avee-player.zip`.

## Troubleshooting

- If uploads fail, check `php.ini`:
  - `upload_max_filesize`
  - `post_max_size`
- If audio doesn't play:
  - Ensure format is supported by your browser
  - Try MP3 or OGG/Opus for best compatibility
- If recording fails:
  - Use a Chromium-based browser
  - Ensure autoplay policies allow audio playback after user gesture

Generated by Genie
