# Ramses Studio v1.3.1

Released: 2026-11-26

## Audio & Performance

- Faster stem separation by using all available CPU cores for ONNX inference.
- Improved audio worker performance with shared and transferred buffers, avoiding unnecessary copies.
- Faster waveform rendering with batched canvas drawing and `ImageData`, including sharper rendering on high-resolution displays.
- Reduced repeated work in waveform peak caching, duration lookup, song lists, and dialogs.

## Audio Accuracy & Reliability

- Fixed multi-stem playback timing drift and seeking in short stems.
- Improved DSP normalization and audio quantization to prevent channel-dependent normalization and DC offset.
- Preserved fallback audio data when transferring buffers to workers.
- Waveforms now redraw when returning to a previously hidden tab.

## YouTube, Google Drive & Updates

- Improved YouTube uploader identification and distinction between official music videos and user uploads.
- Failed YouTube downloads now clean up partial files.
- Improved Google Drive sync reliability and cover badge readability.
- The updater now handles missing release metadata and unsupported installation modes more gracefully.

## UI & Library

- Improved song-list presentation, library interactions, and the empty-library welcome experience.
- Added a RAM warning and operating-system language detection, alongside general UI polish and translation improvements.