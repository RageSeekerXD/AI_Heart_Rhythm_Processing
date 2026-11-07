# AI_Heart_Rhythm_Processing
Browser app that generates synthetic heart-rate sequences (normal rhythm vs. arrhythmia) and trains a Brain.js neural network to tell them apart. Configurable epochs and learning rate, live training charts, sliding-window recognition, and export to PNG/JPG/BMP. Runs offline, no installation needed.

## Benchmark (Lab 3)

`benchmark/index.html` runs the app's own modules from `Application/` and measures dataset generation, training, evaluation, sliding-window recognition, and building/saving the result image (`performance.now()`, 5 runs per variant, fixed seeds). Open it by double-click and press «Запустити»; «Відкрити JSON» shows saved results without re-measuring.

Automated run in Microsoft Edge (or `-Browser chrome`), exporting JSON, CSV, charts and page screenshots to `benchmark/results/`:

```
powershell -ExecutionPolicy Bypass -File benchmark\run-benchmark.ps1
```

`benchmark/results/` holds the measurements used in the Lab 3 report (Edge 157, AMD Ryzen 5 7500F). For the benchmark, `renderResult()` in `Application/js/ecg-render.js` takes an optional `scale` (default 1) to render the result image at higher resolution.

## Tests (Lab 4)

- `tests/index.html` - 149 unit and 22 integration tests (Mocha 10.8.2 + Chai 4.5.0, vendored in `tests/lib`). They load the same `Application/js` files as the app and call them directly. Open by double-click; filter with `?grep=text`.
- `tests/e2e/` - 37 end-to-end scenarios in the real app (`Application/index.html`). A PowerShell client drives the browser over the Chrome DevTools Protocol with real mouse clicks, keyboard input, file selection and file downloads; test files are in `tests/e2e/fixtures/`.

Run everything in headless Microsoft Edge (results, screenshots and V8 code coverage go to `tests/results/<browser>_<date>/`):

```
powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1
```

Options: `-Browser chrome`, `-Suite unit|e2e`, `-Grep "E2E-0[1-3]"`, `-Headed`, `-KeepDownloads`. `tests/results/` holds the runs used in the Lab 4 report: 208 of 208 tests pass in Edge 157 and Chrome 156, 99.6 % of `Application/js` lines covered.

The tests found and this commit fixes: impossible heart rates (below 20 bpm) generated when min normal rate minus Tol(r) < 20; the recognition result disappearing when Enter is pressed right after typing; datasets loaded from file with an empty training split; unchecked test share when loading a file; unit/rounding edge cases in size and duration formatting; overlapping labels on the ECG strip for long sequences.
