/* Об'єднання знімків покриття V8 (Profiler.takePreciseCoverage) і підрахунок
   покриття рядків, функцій і коду для кожного файлу Application/js.
   Виконується в браузері сценарієм run-tests.ps1:
   (function)(snapshots, sources) → { набір: { файл: підсумок } }
   snapshots: { назва набору: [знімок, …] }, знімок - [{ url, functions }];
   sources: { 'app.js': текст файлу, … } */
(function computeCoverage(snapshots, sources) {
  'use strict';
  const out = {};
  for (const [bucket, list] of Object.entries(snapshots)) {
    out[bucket] = {};
    for (const [name, text] of Object.entries(sources)) {
      const n = text.length;
      const covered = new Uint8Array(n);
      const functions = new Map(); // зміщення початку функції → чи виконувалася
      let seen = false;
      for (const snapshot of list) {
        for (const entry of snapshot) {
          if (!entry.url.endsWith('/' + name)) continue;
          seen = true;
          const counts = new Int32Array(n);
          const ranges = [];
          for (const fn of entry.functions) {
            fn.ranges.forEach((r) => ranges.push(r));
            const first = fn.ranges[0];
            const isScript = first.startOffset === 0 && !fn.functionName && first.endOffset >= n - 1;
            if (!isScript) functions.set(first.startOffset, Boolean(functions.get(first.startOffset)) || first.count > 0);
          }
          // вкладені діапазони: зовнішні раніше, внутрішні пізніше (перезаписують лічильник)
          ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
          for (const r of ranges) counts.fill(r.count, r.startOffset, Math.min(r.endOffset, n));
          for (let i = 0; i < n; i++) if (counts[i] > 0) covered[i] = 1;
        }
      }
      if (!seen) continue;
      let bytes = 0;
      let bytesCovered = 0;
      let lines = 0;
      let linesCovered = 0;
      let lineHasCode = false;
      let lineCovered = false;
      let lineNo = 1;
      const uncoveredLines = [];
      for (let i = 0; i <= n; i++) {
        const ch = i < n ? text.charCodeAt(i) : 10;
        if (ch === 10) {
          if (lineHasCode) {
            lines++;
            if (lineCovered) linesCovered++;
            else uncoveredLines.push(lineNo);
          }
          lineNo++;
          lineHasCode = false;
          lineCovered = false;
        } else if (ch !== 32 && ch !== 9 && ch !== 13) {
          bytes++;
          lineHasCode = true;
          if (covered[i]) {
            bytesCovered++;
            lineCovered = true;
          }
        }
      }
      const fnValues = [...functions.values()];
      out[bucket][name] = {
        lines, linesCovered,
        functions: fnValues.length, functionsCovered: fnValues.filter(Boolean).length,
        bytes, bytesCovered,
        uncoveredLines, // номери рядків з кодом, жоден символ яких не виконувався
      };
    }
  }
  return out;
})
