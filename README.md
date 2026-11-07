# AI_Heart_Rhythm_Processing
Browser app that generates synthetic heart-rate sequences (normal rhythm vs. arrhythmia) and trains a Brain.js neural network to tell them apart. Configurable epochs and learning rate, live training charts, sliding-window recognition, and export to PNG/JPG/BMP. Runs offline, no installation needed.

## Benchmark (Lab 3)

`benchmark/index.html` runs the app's own modules from `Application/` and measures dataset generation, training, evaluation, sliding-window recognition, and building/saving the result image (`performance.now()`, 5 runs per variant, fixed seeds). Open it by double-click and press «Запустити»; «Відкрити JSON» shows saved results without re-measuring.

Automated run in Microsoft Edge (or `-Browser chrome`), exporting JSON, CSV, charts and page screenshots to `benchmark/results/`:

```
powershell -ExecutionPolicy Bypass -File benchmark\run-benchmark.ps1
```

`benchmark/results/` holds the measurements used in the Lab 3 report (Edge 157, AMD Ryzen 5 7500F). For the benchmark, `renderResult()` in `Application/js/ecg-render.js` takes an optional `scale` (default 1) to render the result image at higher resolution.
