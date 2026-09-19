# Profiling Report

## Scope and method

The renderer reports instantaneous FPS and keeps the last 300 frame-rate
samples. The intended P95 is calculated from those samples after a three-minute
optimized build run. Simulation tests use the controlled clock and therefore
must not be used as real-time FPS measurements.

Reproduce a manual run with:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Use a Chromium window at the reference viewport `900x650`, enable `Show FPS`
in Options, start with `/?seed=17`, and record the displayed FPS, P95 frame
interval, and maximum enemy/projectile counts during three minutes. Repeat the
start/play/exit flow five times and inspect the browser Memory panel between
cycles for retained growth. Record browser version, OS, CPU/GPU, resolution and
configuration with the result.

## Repository smoke sample

The reproducible headless smoke run used Chromium at `900x650`, seed `17`, and
the development server on port `4174` because `4173` was already occupied. It
started a real Pixi canvas and returned:

| Observation | Value |
| --- | --- |
| Phase after 1.5 s | `running` |
| Enemies at sample time | 0 |
| Projectiles at sample time | 0 |
| FPS text | not exposed by the test bridge |

Zero enemies is expected before the default five-second spawn interval. This
is a smoke check, not a three-minute performance claim.

## Limitations and ownership

The current test bridge exposes snapshots but not the renderer's FPS sample
array. The UI can display FPS when `showFps` is enabled, but automated P95
collection should expose a read-only telemetry accessor before being treated as
a benchmark. Browser Memory measurements also require a headed DevTools run;
they are not inferred from JavaScript heap snapshots in this repository.

The main known build performance signal is Vite's warning that the minified
application chunk is larger than 500 kB. This is a follow-up optimization item,
not evidence of a gameplay regression. No claim of 60 FPS or absence of memory
growth is made without the hardware and three-minute protocol above.