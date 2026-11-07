/* Бенчмарк продуктивності застосунку «Розпізнавання серцевого ритму» (ЛР3).
   Час вимірюється функцією performance.now() навколо викликів коду самого
   застосунку: генерації набору (generator.js), навчання й оцінювання мережі
   (model.js), розпізнавання ковзним вікном, побудови зображення результату
   (ecg-render.js) і його збереження (image-export.js). */
(function (HR, BENCH) {
  'use strict';

  const now = () => performance.now();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const $ = (sel) => document.querySelector(sel);

  // ---------------------------------------------------------------- Параметри

  // Типові значення з форм застосунку; зерна фіксовані, тому кожен запуск
  // обробляє ті самі дані й виконує ту саму послідовність обчислень
  const DATA = {
    perClass: 500, length: 4, testPct: 20, normMin: 60, normMax: 100,
    tolerance: 8, arrMin: 50, arrMax: 120, minSpread: 15, seed: 12345,
  };
  const TRAIN = { epochs: 1000, learningRate: 0.3, momentum: 0.1, errorThresh: 0, shuffleSeed: 7 };
  const HIDDEN = [8];
  const WEIGHT_SEED = 2026;
  const SERIES_SEED = 99;

  const PLAN = {
    warmupRuns: 10,
    volume: [125, 500, 2000, 5000], // послідовностей кожного класу: 250 … 10 000 разом
    hidden: [4, 8, 16, 32, 64],
    seqlen: [4, 8, 12],
    epochs: [100, 250, 500, 1000, 2000],
    recognition: [4, 10, 50, 100, 200, 1000, 10000],
    renderMaxN: 10000,
    imageScales: [0.5, 1, 1.5, 2, 3840 / 1400],
    files: [125, 500, 2000, 5000],
    opt: [{ perClass: 500, epochs: 1000 }, { perClass: 5000, epochs: 200 }],
  };

  // ---------------------------------------------------------------- Статистика

  function stats(values) {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    const n = v.length;
    if (!n) return { n: 0, min: NaN, max: NaN, mean: NaN, median: NaN, sd: NaN, cv: NaN };
    const mean = v.reduce((a, b) => a + b, 0) / n;
    const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
    const sd = n > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
    return { n, min: v[0], max: v[n - 1], mean, median, sd, cv: mean ? sd / mean : NaN };
  }

  const nfCache = new Map();
  function nf(digits) {
    if (!nfCache.has(digits)) {
      nfCache.set(digits, new Intl.NumberFormat('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
    }
    return nfCache.get(digits);
  }
  // Кількість знаків після коми залежить від величини: 1 234; 56,7; 8,90; 0,123
  function fmtMs(ms) {
    if (!Number.isFinite(ms)) return '—';
    const a = Math.abs(ms);
    const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 3 : 4;
    return nf(d).format(ms);
  }
  const fmtInt = (n) => (Number.isFinite(n) ? nf(0).format(n) : '—');
  const fmtNum = (n, d) => (Number.isFinite(n) ? nf(d).format(n) : '—');
  function fmtBytes(b) {
    if (!Number.isFinite(b)) return '—';
    if (b < 1024) return `${b} Б`;
    if (b < 1024 * 1024) return `${nf(1).format(b / 1024)} КБ`;
    return `${nf(2).format(b / 1024 / 1024)} МБ`;
  }
  const bytesOf = (text) => new Blob([text]).size;

  // ---------------------------------------------------------------- Допоміжне

  // Між запусками: збирання сміття (якщо браузер запущено з --js-flags=--expose-gc)
  // і коротка пауза, щоб сторінка оновила хід виконання
  async function settle() {
    if (typeof window.gc === 'function') window.gc();
    await sleep(15);
  }

  // brain.js ініціалізує ваги через Math.random(); на час ініціалізації
  // підставляється генератор із зерном, тож початкові ваги в усіх запусках однакові
  function withSeededRandom(seed, fn) {
    const original = Math.random;
    Math.random = new HR.Random(seed).next;
    try {
      return fn();
    } finally {
      Math.random = original;
    }
  }

  // Те саме, що робить app.js перед навчанням, плюс відтворювані початкові ваги
  function createModel(train, windowSize, hiddenLayers) {
    const { encoding, trainRange } = HR.RhythmModel.encodingFor(train);
    const model = new HR.RhythmModel({ windowSize, hiddenLayers, encoding, trainRange });
    model.net.sizes = [windowSize, ...hiddenLayers, HR.data.CLASSES.length];
    withSeededRandom(WEIGHT_SEED, () => model.net.initialize());
    return model;
  }

  // Швидкі операції (мікросекунди) коротші за роздільну здатність таймера
  // (у браузері 0,1 мс), тому один «запуск» — серія з reps викликів, а
  // результат — середній час одного виклику
  let sink = 0;
  function calibrate(fn, targetMs = 25) {
    let reps = 1;
    for (;;) {
      const t0 = now();
      for (let i = 0; i < reps; i++) sink += fn() ? 1 : 0;
      const ms = now() - t0;
      if (ms >= targetMs || reps >= 1e7) return reps;
      reps = ms < 1 ? reps * 10 : Math.ceil((reps * targetMs * 1.2) / ms);
    }
  }
  function timeRepeated(fn, reps) {
    const t0 = now();
    for (let i = 0; i < reps; i++) sink += fn() ? 1 : 0;
    return (now() - t0) / reps;
  }

  // Canvas 2D малює відкладено: команди записуються, а растеризуються під час
  // читання пікселів або показу кадру. Читання одного пікселя примушує
  // браузер виконати всю відкладену растеризацію
  function flushCanvas(canvas) {
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
  }

  function timerResolution() {
    const deltas = [];
    let last = now();
    while (deltas.length < 60) {
      const t = now();
      if (t !== last) {
        deltas.push(t - last);
        last = t;
      }
    }
    return stats(deltas).median;
  }

  function webglRenderer() {
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch (err) {
      return null;
    }
  }

  function frameInterval(frames = 61) {
    return new Promise((resolve) => {
      const times = [];
      const tick = (t) => {
        times.push(t);
        if (times.length < frames) requestAnimationFrame(tick);
        else resolve(stats(times.slice(1).map((v, i) => v - times[i])).median);
      };
      requestAnimationFrame(tick);
    });
  }

  async function collectEnvironment() {
    const env = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory ?? null,
      language: navigator.language,
      screen: `${screen.width}×${screen.height}`,
      devicePixelRatio: window.devicePixelRatio,
      protocol: location.protocol,
      crossOriginIsolated: Boolean(window.crossOriginIsolated),
      gcExposed: typeof window.gc === 'function',
      webgl: webglRenderer(),
      timerResolutionMs: timerResolution(),
      brainVersion: '2.0.0-beta.24',
    };
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      try {
        env.uaData = await navigator.userAgentData.getHighEntropyValues(['fullVersionList', 'platformVersion', 'architecture', 'bitness']);
      } catch (err) {
        env.uaData = null;
      }
    }
    return env;
  }

  function browserName(env) {
    const list = env.uaData && env.uaData.fullVersionList;
    if (list) {
      const brand = list.find((b) => /Edge|Chrome|Opera|Brave/i.test(b.brand) && !/Not/i.test(b.brand) && b.brand !== 'Chromium')
        || list.find((b) => b.brand === 'Chromium');
      const engine = list.find((b) => b.brand === 'Chromium');
      if (brand) return `${brand.brand} ${brand.version}${engine && brand !== engine ? ` (Chromium ${engine.version})` : ''}`;
    }
    return env.userAgent;
  }

  // ---------------------------------------------------------------- Етапи алгоритму

  async function generate(perClass = DATA.perClass, length = DATA.length) {
    const t0 = now();
    const ds = await HR.data.buildDataset({ ...DATA, perClass, length });
    return { ds, ms: now() - t0 };
  }

  async function train(ds, hidden = HIDDEN, epochs = TRAIN.epochs) {
    const t0 = now();
    const model = createModel(ds.train, ds.windowSize, hidden);
    const training = await model.train(ds.train, ds.test, { ...TRAIN, epochs });
    return { model, training, ms: now() - t0 };
  }

  async function evaluate(model, ds) {
    const t0 = now();
    const ev = await model.evaluate(ds.test);
    return { ev, ms: now() - t0 };
  }

  async function pipeline(perClass = DATA.perClass) {
    const g = await generate(perClass);
    const t = await train(g.ds);
    const e = await evaluate(t.model, g.ds);
    return { ds: g.ds, model: t.model, training: t.training, ev: e.ev, gen: g.ms, train: t.ms, eval: e.ms };
  }

  function renderData(model, bpm, result) {
    return {
      bpm,
      inputCount: bpm.length,
      units: 'bpm',
      result,
      model,
      warnings: [],
      normalRange: { min: DATA.normMin, max: DATA.normMax },
      createdAt: new Date(2026, 10, 7, 12, 0, 0),
    };
  }

  // Оптимізований прототип кодувальника BMP (розділ «Аналіз покращень»):
  // непрозорі пікселі копіюються без множень і Math.round()
  function encodeBmpFast(canvas) {
    const { width, height } = canvas;
    const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const fileSize = 54 + rowSize * height;
    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);
    view.setUint8(0, 0x42);
    view.setUint8(1, 0x4d);
    view.setUint32(2, fileSize, true);
    view.setUint32(10, 54, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    view.setUint32(30, 0, true);
    view.setUint32(34, rowSize * height, true);
    view.setInt32(38, 2835, true);
    view.setInt32(42, 2835, true);
    const bytes = new Uint8Array(buffer);
    for (let y = 0; y < height; y++) {
      let src = (height - 1 - y) * width * 4;
      let dst = 54 + y * rowSize;
      for (let x = 0; x < width; x++, src += 4, dst += 3) {
        const a = data[src + 3];
        if (a === 255) {
          bytes[dst] = data[src + 2];
          bytes[dst + 1] = data[src + 1];
          bytes[dst + 2] = data[src];
        } else {
          const k = a / 255;
          const w = 255 * (1 - k);
          bytes[dst] = (data[src + 2] * k + w + 0.5) | 0;
          bytes[dst + 1] = (data[src + 1] * k + w + 0.5) | 0;
          bytes[dst + 2] = (data[src] * k + w + 0.5) | 0;
        }
      }
    }
    return new Blob([buffer], { type: 'image/bmp' });
  }

  async function sameBytes(a, b) {
    const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
    if (x.byteLength !== y.byteLength) return false;
    const u = new Uint8Array(x);
    const v = new Uint8Array(y);
    for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
    return true;
  }

  // ---------------------------------------------------------------- Набори вимірювань

  // 1. Перші запуски одразу після завантаження сторінки: JIT-компіляція
  async function suiteWarmup(ctx) {
    const rows = [];
    for (let i = 1; i <= PLAN.warmupRuns; i++) {
      ctx.progress(`запуск ${i} з ${PLAN.warmupRuns}`);
      const r = await pipeline();
      rows.push({ run: i, gen: r.gen, train: r.train, eval: r.eval, total: r.gen + r.train + r.eval });
      await settle();
    }
    return { rows };
  }

  // 2. Обсяг вхідних даних: 250 … 10 000 послідовностей
  async function suiteVolume(ctx) {
    const rows = [];
    for (const perClass of PLAN.volume) {
      const row = { perClass, sequences: perClass * 2, gen: [], train: [], eval: [], total: [] };
      let last = null;
      for (let i = 1; i <= ctx.runs; i++) {
        ctx.progress(`${fmtInt(perClass * 2)} послідовностей, запуск ${i} з ${ctx.runs}`);
        const r = await pipeline(perClass);
        row.gen.push(r.gen);
        row.train.push(r.train);
        row.eval.push(r.eval);
        row.total.push(r.gen + r.train + r.eval);
        last = r;
        await settle();
      }
      const { ds, model, training, ev } = last;
      row.k = ds.windowSize;
      row.values = ds.samples.length * ds.windowSize;
      row.trainSamples = ds.train.length;
      row.testSamples = ds.test.length;
      row.csvBytes = bytesOf(HR.data.datasetToCsv(ds));
      row.jsonBytes = bytesOf(HR.data.datasetToJson(ds));
      row.rejected = ds.rejected;
      row.epochs = training.epochsDone;
      row.finalError = training.finalError;
      row.testAccuracy = ev.accuracy;
      row.parameters = model.parameterCount;
      // складові часу навчання: запис точності (≈101 раз) і підготовка
      // даних усередині net.train() (форматування й перевірка — щоепохи)
      ctx.progress(`${fmtInt(perClass * 2)} послідовностей: складові часу навчання`);
      const records = model.history.evalEpoch.length;
      const accReps = calibrate(() => model.accuracy(ds.train) + model.accuracy(ds.test));
      row.accuracyRecordMs = timeRepeated(() => model.accuracy(ds.train) + model.accuracy(ds.test), accReps);
      row.accuracyRecords = records;
      const data = ds.train.map((s) => ({ input: model.encode(s.bpm), output: model.target(s.label) }));
      const net = model.net;
      const prepFn = () => {
        const prepared = net.formatData(data);
        net.validateData(prepared);
        return prepared.length;
      };
      row.prepPerEpochMs = timeRepeated(prepFn, calibrate(prepFn));
      rows.push(row);
    }
    return { rows };
  }

  // 3. Розмір прихованого шару
  async function suiteHidden(ctx) {
    const { ds } = await generate();
    const rows = [];
    for (const h of PLAN.hidden) {
      const row = { hidden: h, train: [] };
      let last = null;
      for (let i = 1; i <= ctx.runs; i++) {
        ctx.progress(`мережа 4–${h}–2, запуск ${i} з ${ctx.runs}`);
        last = await train(ds, [h]);
        row.train.push(last.ms);
        await settle();
      }
      row.architecture = last.model.architecture;
      row.parameters = last.model.parameterCount;
      row.testAccuracy = last.model.accuracy(ds.test);
      row.finalError = last.training.finalError;
      rows.push(row);
    }
    return { rows, trainSamples: ds.train.length };
  }

  // 4. Довжина послідовності K (кількість входів мережі)
  async function suiteSeqLen(ctx) {
    const rows = [];
    for (const k of PLAN.seqlen) {
      const row = { k, gen: [], train: [] };
      let last = null;
      for (let i = 1; i <= ctx.runs; i++) {
        ctx.progress(`K = ${k}, запуск ${i} з ${ctx.runs}`);
        const g = await generate(DATA.perClass, k);
        const t = await train(g.ds);
        row.gen.push(g.ms);
        row.train.push(t.ms);
        last = { ...g, ...t };
        await settle();
      }
      row.values = last.ds.samples.length * k;
      row.rejected = last.ds.rejected;
      row.parameters = last.model.parameterCount;
      row.architecture = last.model.architecture;
      row.testAccuracy = last.model.accuracy(last.ds.test);
      rows.push(row);
    }
    return { rows };
  }

  // 5. Кількість епох
  async function suiteEpochs(ctx) {
    const { ds } = await generate();
    const rows = [];
    for (const e of PLAN.epochs) {
      const row = { epochs: e, train: [] };
      let last = null;
      for (let i = 1; i <= ctx.runs; i++) {
        ctx.progress(`${fmtInt(e)} епох, запуск ${i} з ${ctx.runs}`);
        last = await train(ds, HIDDEN, e);
        row.train.push(last.ms);
        await settle();
      }
      row.testAccuracy = last.model.accuracy(ds.test);
      row.finalError = last.training.finalError;
      rows.push(row);
    }
    return { rows, trainSamples: ds.train.length };
  }

  // 6. Розпізнавання ковзним вікном і зображення результату для різної довжини n
  async function suiteRecognition(ctx) {
    const { ds } = await generate();
    const { model } = await train(ds);
    const rows = [];
    for (const n of PLAN.recognition) {
      const series = HR.data.exampleSeries(new HR.Random(SERIES_SEED), DATA, 'arrhythmia', n, model.windowSize);
      const row = { n, windows: n - model.windowSize + 1, predict: [], render: [], inAppLimit: n <= 200 };
      ctx.progress(`n = ${fmtInt(n)}: калібрування`);
      const fn = () => model.predictSeries(series).windows.length;
      row.reps = calibrate(fn);
      for (let i = 1; i <= ctx.runs; i++) {
        ctx.progress(`n = ${fmtInt(n)}, розпізнавання, запуск ${i} з ${ctx.runs}`);
        row.predict.push(timeRepeated(fn, row.reps));
        await settle();
      }
      const result = model.predictSeries(series);
      row.label = result.label;
      row.confidence = result.confidence;
      if (n <= PLAN.renderMaxN) {
        const data = renderData(model, series, result);
        for (let i = 1; i <= ctx.runs; i++) {
          ctx.progress(`n = ${fmtInt(n)}, зображення, запуск ${i} з ${ctx.runs}`);
          const canvas = document.createElement('canvas');
          const t0 = now();
          HR.ecg.renderResult(canvas, data, 1);
          flushCanvas(canvas);
          row.render.push(now() - t0);
          await settle();
        }
      }
      rows.push(row);
    }
    return { rows, architecture: model.architecture };
  }

  // 7. Зображення результату різної роздільної здатності: побудова і збереження
  async function suiteImage(ctx) {
    const { ds } = await generate();
    const { model } = await train(ds);
    const values = HR.data.ARTICLE_EXAMPLES.irregular.values;
    const data = renderData(model, values, model.predictSeries(values));
    const fresh = (scale) => {
      const canvas = document.createElement('canvas');
      HR.ecg.renderResult(canvas, data, scale);
      flushCanvas(canvas);
      return canvas;
    };
    const rows = [];
    for (const scale of PLAN.imageScales) {
      const probe = fresh(scale);
      const row = {
        scale, width: probe.width, height: probe.height, pixels: probe.width * probe.height,
        renderJs: [], render: [], png: [], jpg: [], bmp: [], bmpFast: [], readback: [],
      };
      const label = `${probe.width}×${probe.height}`;
      // кожна операція — на щойно намальованому полотні: після кількох читань
      // пікселів Chrome може перевести полотно з GPU у програмний режим
      for (let i = 1; i <= ctx.runs; i++) {
        ctx.progress(`${label}, запуск ${i} з ${ctx.runs}`);
        let canvas = document.createElement('canvas');
        let t0 = now();
        HR.ecg.renderResult(canvas, data, scale);
        row.renderJs.push(now() - t0);
        flushCanvas(canvas);
        row.render.push(now() - t0);

        for (const format of ['png', 'jpg', 'bmp']) {
          canvas = fresh(scale);
          t0 = now();
          const blob = await HR.imageExport.canvasToBlob(canvas, format);
          row[format].push(now() - t0);
          row[`${format}Bytes`] = blob.size;
        }
        canvas = fresh(scale);
        t0 = now();
        encodeBmpFast(canvas);
        row.bmpFast.push(now() - t0);

        canvas = fresh(scale);
        t0 = now();
        canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        row.readback.push(now() - t0);
        await settle();
      }
      const check = fresh(scale);
      row.bmpFastIdentical = await sameBytes(await HR.imageExport.canvasToBlob(check, 'bmp'), encodeBmpFast(check));
      rows.push(row);
    }
    return { rows, sequence: values };
  }

  // 8. Формат файлу набору даних: CSV і JSON (серіалізація і розбір)
  async function suiteFiles(ctx) {
    const rows = [];
    for (const perClass of PLAN.files) {
      const { ds } = await generate(perClass);
      const variants = [
        { format: 'CSV', name: 'dataset.csv', save: () => HR.data.datasetToCsv(ds) },
        { format: 'JSON', name: 'dataset.json', save: () => HR.data.datasetToJson(ds) },
      ];
      for (const v of variants) {
        const text = v.save();
        const row = { sequences: perClass * 2, format: v.format, bytes: bytesOf(text), serialize: [], parse: [] };
        for (let i = 1; i <= ctx.runs; i++) {
          ctx.progress(`${v.format}, ${fmtInt(perClass * 2)} послідовностей, запуск ${i} з ${ctx.runs}`);
          let t0 = now();
          v.save();
          row.serialize.push(now() - t0);
          t0 = now();
          HR.data.parseDatasetFile(text, v.name, DATA.testPct / 100);
          row.parse.push(now() - t0);
          await settle();
        }
        rows.push(row);
      }
    }
    return { rows };
  }

  // 9. Режим інтерфейсу: ті самі етапи з паузами для перемальовування сторінки
  async function suiteUiMode(ctx) {
    const frameMs = await frameInterval();
    const rows = [];
    BENCH.yieldMode = 'app';
    try {
      for (let i = 1; i <= ctx.runs; i++) {
        ctx.progress(`запуск ${i} з ${ctx.runs} (з паузами, як в інтерфейсі)`);
        let y0 = BENCH.yieldCount;
        const ds = await HR.data.buildDataset({ ...DATA });
        const genYields = BENCH.yieldCount - y0;
        const model = createModel(ds.train, ds.windowSize, HIDDEN);
        y0 = BENCH.yieldCount;
        const t = await model.train(ds.train, ds.test, { ...TRAIN });
        const trainYields = BENCH.yieldCount - y0;
        y0 = BENCH.yieldCount;
        const t0 = now();
        await model.evaluate(ds.test);
        const evalElapsed = now() - t0;
        rows.push({
          run: i,
          genCompute: ds.computeMs, genElapsed: ds.elapsedMs, genYields,
          trainCompute: t.computeMs, trainElapsed: t.elapsedMs, trainYields,
          evalElapsed, evalYields: BENCH.yieldCount - y0,
        });
        await settle();
      }
    } finally {
      BENCH.yieldMode = 'none';
    }
    return { rows, frameMs, visibility: document.visibilityState };
  }

  // 10. Прототипи оптимізацій циклу навчання (ті самі дані, ваги й порядок прикладів)
  async function trainVariant(variant, ds, epochs) {
    const t0 = now();
    const model = createModel(ds.train, ds.windowSize, HIDDEN);
    if (variant === 'current') {
      const t = await model.train(ds.train, ds.test, { ...TRAIN, epochs });
      return { ms: now() - t0, error: t.finalError, model };
    }
    const net = model.net;
    const rng = new HR.Random(TRAIN.shuffleSeed);
    const data = ds.train.map((s) => ({ input: model.encode(s.bpm), output: model.target(s.label) }));
    const brainOptions = {
      iterations: 1, learningRate: TRAIN.learningRate, momentum: TRAIN.momentum,
      errorThresh: 1e-12, log: false, activation: 'sigmoid',
    };
    const record = variant === 'prepared';
    const evalEvery = Math.max(1, Math.round(epochs / 100));
    let error = NaN;
    if (variant === 'noAccuracy') {
      for (let epoch = 1; epoch <= epochs; epoch++) {
        rng.shuffle(data);
        error = net.train(data, brainOptions).error;
      }
    } else {
      // дані форматуються у Float32Array один раз, а не на кожній епосі
      net.updateTrainingOptions(brainOptions);
      const prepared = net.formatData(data);
      net.validateData(prepared);
      for (let epoch = 1; epoch <= epochs; epoch++) {
        rng.shuffle(prepared);
        error = net.calculateTrainingError(prepared);
        if (record && (epoch === 1 || epoch % evalEvery === 0 || epoch === epochs)) {
          model.accuracy(ds.train);
          model.accuracy(ds.test);
        }
      }
    }
    return { ms: now() - t0, error, model };
  }

  const VARIANTS = [
    { id: 'current', title: 'Поточна реалізація (model.train)' },
    { id: 'noAccuracy', title: 'Без запису точності через кожен 1 % епох' },
    { id: 'prepared', title: 'Дані форматуються один раз (із записом точності)' },
    { id: 'preparedNoAcc', title: 'Обидві зміни разом' },
  ];

  async function suiteOpt(ctx) {
    const rows = [];
    for (const cfg of PLAN.opt) {
      const { ds } = await generate(cfg.perClass);
      for (const v of VARIANTS) {
        const row = { sequences: cfg.perClass * 2, trainSamples: ds.train.length, epochs: cfg.epochs, variant: v.id, title: v.title, train: [] };
        let last = null;
        for (let i = 1; i <= ctx.runs; i++) {
          ctx.progress(`${fmtInt(cfg.perClass * 2)} послідовностей × ${fmtInt(cfg.epochs)} епох: ${v.title}, запуск ${i} з ${ctx.runs}`);
          last = await trainVariant(v.id, ds, cfg.epochs);
          row.train.push(last.ms);
          await settle();
        }
        row.finalError = last.error;
        row.testAccuracy = last.model.accuracy(ds.test);
        rows.push(row);
      }
    }
    // однакові дані, ваги й порядок прикладів → однакова підсумкова помилка
    const groups = PLAN.opt.map((cfg) => rows.filter((r) => r.sequences === cfg.perClass * 2));
    const identical = groups.every((g) => g.every((r) => r.finalError === g[0].finalError));
    return { rows, identical };
  }

  const SUITES = [
    { id: 'warmup', title: 'Перші запуски після завантаження сторінки', run: suiteWarmup,
      about: `${PLAN.warmupRuns} запусків повного конвеєра (1 000 послідовностей, K = 4, мережа 4–8–2, 1 000 епох) одразу після відкриття сторінки: видно вплив JIT-компіляції.` },
    { id: 'volume', title: 'Обсяг вхідних даних', run: suiteVolume,
      about: 'Генерація, навчання (1 000 епох) і оцінювання для наборів з 250, 1 000, 4 000 і 10 000 послідовностей (K = 4).' },
    { id: 'hidden', title: 'Розмір прихованого шару', run: suiteHidden,
      about: 'Час навчання мережі 4–H–2 на 800 прикладах, 1 000 епох.' },
    { id: 'seqlen', title: 'Довжина послідовності K', run: suiteSeqLen,
      about: 'Генерація і навчання для K = 4, 8, 12 (1 000 послідовностей, 1 000 епох).' },
    { id: 'epochs', title: 'Кількість епох', run: suiteEpochs,
      about: 'Час навчання мережі 4–8–2 на 800 прикладах залежно від кількості епох.' },
    { id: 'recognition', title: 'Розпізнавання і зображення результату', run: suiteRecognition,
      about: 'predictSeries() і побудова зображення 1400 × 800 для послідовностей довжиною n (в інтерфейсі n ≤ 200).' },
    { id: 'image', title: 'Роздільна здатність зображення результату', run: suiteImage,
      about: 'Побудова зображення результату і збереження в PNG, JPG, BMP для роздільної здатності від 700 × 400 до 3840 × 2194.' },
    { id: 'files', title: 'Формат файлу набору даних', run: suiteFiles,
      about: 'Серіалізація і розбір файлів CSV та JSON для наборів різного обсягу.' },
    { id: 'uimode', title: 'Режим інтерфейсу (з паузами для перемальовування)', run: suiteUiMode,
      about: 'Той самий конвеєр з оригінальною функцією nextFrame(): час обчислень і загальний час, який бачить користувач.' },
    { id: 'opt', title: 'Прототипи оптимізацій навчання', run: suiteOpt,
      about: 'Поточний цикл навчання порівняно з варіантами без щоепохового форматування даних і без частого запису точності.' },
  ];

  // ---------------------------------------------------------------- Таблиці

  const runCols = (runs) => Array.from({ length: runs }, (_, i) => `Запуск ${i + 1}`);
  const statCols = ['Мін.', 'Макс.', 'Середнє', 'Медіана'];
  function statCells(values) {
    const s = stats(values);
    return [...values.map(fmtMs), fmtMs(s.min), fmtMs(s.max), fmtMs(s.mean), fmtMs(s.median)];
  }

  const TABLES = {
    warmup: (r) => [{
      caption: 'Час етапів, мс',
      head: ['Запуск', 'Генерація', 'Навчання', 'Оцінювання', 'Разом'],
      rows: r.rows.map((x) => [x.run, fmtMs(x.gen), fmtMs(x.train), fmtMs(x.eval), fmtMs(x.total)]),
    }],
    volume: (r, runs) => [{
      caption: 'Навчання (1 000 епох), мс',
      head: ['Послідовностей', 'Значень (2N·K)', 'Файл CSV', ...runCols(runs), ...statCols],
      rows: r.rows.map((x) => [fmtInt(x.sequences), fmtInt(x.values), fmtBytes(x.csvBytes), ...statCells(x.train)]),
    }, {
      caption: 'Медіани етапів, мс',
      head: ['Послідовностей', 'Генерація', 'Навчання', 'Оцінювання', 'Разом', 'Запис точності ×N', 'Підготовка даних ×епох', 'Точність'],
      rows: r.rows.map((x) => [fmtInt(x.sequences), fmtMs(stats(x.gen).median), fmtMs(stats(x.train).median), fmtMs(stats(x.eval).median),
        fmtMs(stats(x.total).median), `${fmtMs(x.accuracyRecordMs * x.accuracyRecords)} (${x.accuracyRecords}×)`,
        fmtMs(x.prepPerEpochMs * x.epochs), `${fmtNum(x.testAccuracy * 100, 1)} %`]),
    }],
    hidden: (r, runs) => [{
      caption: 'Навчання, мс',
      head: ['Мережа', 'Параметрів', ...runCols(runs), ...statCols],
      rows: r.rows.map((x) => [x.architecture, fmtInt(x.parameters), ...statCells(x.train)]),
    }],
    seqlen: (r, runs) => [{
      caption: 'Навчання, мс',
      head: ['K', 'Значень', 'Мережа', ...runCols(runs), ...statCols],
      rows: r.rows.map((x) => [x.k, fmtInt(x.values), x.architecture, ...statCells(x.train)]),
    }, {
      caption: 'Генерація, мс',
      head: ['K', 'Відкинуто кандидатів', ...runCols(runs), ...statCols],
      rows: r.rows.map((x) => [x.k, fmtInt(x.rejected), ...statCells(x.gen)]),
    }],
    epochs: (r, runs) => [{
      caption: 'Навчання, мс',
      head: ['Епох', ...runCols(runs), ...statCols, 'Мс на епоху'],
      rows: r.rows.map((x) => [fmtInt(x.epochs), ...statCells(x.train), fmtMs(stats(x.train).median / x.epochs)]),
    }],
    recognition: (r, runs) => [{
      caption: 'predictSeries(), мс на виклик',
      head: ['n', 'Вікон', 'Викликів у серії', ...runCols(runs), ...statCols],
      rows: r.rows.map((x) => [fmtInt(x.n), fmtInt(x.windows), fmtInt(x.reps), ...statCells(x.predict)]),
    }, {
      caption: 'Побудова зображення 1400 × 800 (з растеризацією), мс',
      head: ['n', ...runCols(runs), ...statCols],
      rows: r.rows.filter((x) => x.render.length).map((x) => [fmtInt(x.n), ...statCells(x.render)]),
    }],
    image: (r, runs) => [{
      caption: 'Побудова зображення (з растеризацією), мс',
      head: ['Роздільна здатність', 'Пікселів', ...runCols(runs), ...statCols],
      rows: r.rows.map((x) => [`${x.width} × ${x.height}`, fmtInt(x.pixels), ...statCells(x.render)]),
    }, {
      caption: 'Медіани, мс; розмір файлу',
      head: ['Роздільна здатність', 'JS-частина', 'Побудова', 'PNG', 'JPG', 'BMP', 'BMP (оптим.)', 'getImageData', 'PNG, розмір', 'JPG, розмір', 'BMP, розмір'],
      rows: r.rows.map((x) => [`${x.width} × ${x.height}`, fmtMs(stats(x.renderJs).median), fmtMs(stats(x.render).median),
        fmtMs(stats(x.png).median), fmtMs(stats(x.jpg).median), fmtMs(stats(x.bmp).median), fmtMs(stats(x.bmpFast).median),
        fmtMs(stats(x.readback).median), fmtBytes(x.pngBytes), fmtBytes(x.jpgBytes), fmtBytes(x.bmpBytes)]),
    }],
    files: (r, runs) => [{
      caption: 'Розбір файлу (parseDatasetFile), мс',
      head: ['Послідовностей', 'Формат', 'Розмір', ...runCols(runs), ...statCols],
      rows: r.rows.map((x) => [fmtInt(x.sequences), x.format, fmtBytes(x.bytes), ...statCells(x.parse)]),
    }, {
      caption: 'Серіалізація (datasetToCsv / datasetToJson), мс',
      head: ['Послідовностей', 'Формат', ...runCols(runs), ...statCols],
      rows: r.rows.map((x) => [fmtInt(x.sequences), x.format, ...statCells(x.serialize)]),
    }],
    uimode: (r) => [{
      caption: `Час, мс (інтервал кадру ${fmtMs(r.frameMs)} мс)`,
      head: ['Запуск', 'Генерація: обчислення', 'Генерація: усього', 'Навчання: обчислення', 'Навчання: усього', 'Оцінювання: усього', 'Пауз (ген./навч./оцін.)'],
      rows: r.rows.map((x) => [x.run, fmtMs(x.genCompute), fmtMs(x.genElapsed), fmtMs(x.trainCompute), fmtMs(x.trainElapsed),
        fmtMs(x.evalElapsed), `${x.genYields} / ${x.trainYields} / ${x.evalYields}`]),
    }],
    opt: (r, runs) => [{
      caption: `Навчання, мс${r.identical ? ' (підсумкова помилка в усіх варіантах однакова)' : ''}`,
      head: ['Дані', 'Варіант', ...runCols(runs), ...statCols, 'Прискорення'],
      rows: r.rows.map((x) => {
        const base = r.rows.find((b) => b.sequences === x.sequences && b.variant === 'current');
        const speedup = stats(base.train).median / stats(x.train).median;
        return [`${fmtInt(x.trainSamples)} прикл. × ${fmtInt(x.epochs)} епох`, x.title, ...statCells(x.train), `${fmtNum(speedup, 2)}×`];
      }),
    }],
  };

  function renderTable(spec) {
    const table = document.createElement('table');
    const cap = document.createElement('caption');
    cap.textContent = spec.caption;
    table.appendChild(cap);
    const thead = table.createTHead();
    const hr = thead.insertRow();
    for (const h of spec.head) {
      const th = document.createElement('th');
      th.textContent = h;
      hr.appendChild(th);
    }
    const tbody = table.createTBody();
    for (const row of spec.rows) {
      const tr = tbody.insertRow();
      row.forEach((cell) => { tr.insertCell().textContent = String(cell); });
    }
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.appendChild(table);
    return wrap;
  }

  function renderSuite(suite, result, runs) {
    let section = document.getElementById(`suite-${suite.id}`);
    if (!section) {
      section = document.createElement('section');
      section.id = `suite-${suite.id}`;
      section.className = 'suite';
      $('#results').appendChild(section);
    }
    section.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = suite.title;
    const p = document.createElement('p');
    p.className = 'about';
    p.textContent = `${suite.about} Тривалість набору: ${fmtNum(result.durationMs / 1000, 1)} с.`;
    section.append(h, p);
    for (const spec of TABLES[suite.id](result, runs)) section.appendChild(renderTable(spec));
  }

  function renderEnvironment(env) {
    const items = [
      ['Браузер', browserName(env)],
      ['Платформа', `${env.platform}${env.uaData ? `, ${env.uaData.architecture}-${env.uaData.bitness}, platformVersion ${env.uaData.platformVersion}` : ''}`],
      ['Логічних процесорів', String(env.hardwareConcurrency)],
      ['Графічний процесор (WebGL)', env.webgl || '—'],
      ['Екран', `${env.screen}, devicePixelRatio ${env.devicePixelRatio}`],
      ['Роздільна здатність таймера', `${fmtMs(env.timerResolutionMs)} мс (crossOriginIsolated: ${env.crossOriginIsolated ? 'так' : 'ні'})`],
      ['Сторінку відкрито через', env.protocol],
      ['Збирання сміття між запусками', env.gcExposed ? 'так (window.gc)' : 'ні'],
      ['Brain.js', env.brainVersion],
    ];
    const dl = $('#env');
    dl.innerHTML = '';
    for (const [k, v] of items) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
  }

  // ---------------------------------------------------------------- Запуск

  const state = { results: null, running: false };

  function setStatus(text, kind = '') {
    const el = $('#status');
    el.textContent = text;
    el.dataset.kind = kind;
  }

  async function runSuites(ids, runs) {
    if (state.running) return state.results;
    state.running = true;
    $('#run').disabled = true;
    const started = new Date();
    const env = await collectEnvironment();
    renderEnvironment(env);
    state.results = { meta: { startedAt: started.toISOString(), runs, env, data: DATA, train: TRAIN, hidden: HIDDEN, plan: PLAN }, suites: {} };
    BENCH.results = state.results;
    try {
      for (const suite of SUITES.filter((s) => ids.includes(s.id))) {
        const t0 = now();
        const ctx = { runs, progress: (text) => setStatus(`${suite.title}: ${text}`) };
        ctx.progress('підготовка');
        await settle();
        const result = await suite.run(ctx);
        result.durationMs = now() - t0;
        state.results.suites[suite.id] = result;
        renderSuite(suite, result, runs);
      }
      state.results.meta.finishedAt = new Date().toISOString();
      state.results.meta.durationMs = Date.now() - started.getTime();
      setStatus(`Готово за ${fmtNum(state.results.meta.durationMs / 1000, 1)} с. Результати можна зберегти у JSON або CSV.`, 'ok');
      if (BENCH.charts) BENCH.charts.renderAll(state.results);
    } catch (err) {
      setStatus(`Помилка: ${err.message}`, 'error');
      state.results.error = String(err && err.stack ? err.stack : err);
      console.error(err);
    } finally {
      state.running = false;
      $('#run').disabled = false;
      $('#save-json').disabled = !state.results;
      $('#save-csv').disabled = !state.results;
      BENCH.done = true;
    }
    return state.results;
  }

  // Показ раніше збережених результатів (JSON) без повторних вимірювань
  function showResults(results) {
    if (!results || !results.suites || !results.meta) throw new Error('Це не файл результатів бенчмарку.');
    state.results = results;
    BENCH.results = results;
    $('#results').innerHTML = '';
    if (results.meta.env) renderEnvironment(results.meta.env);
    for (const suite of SUITES) {
      if (results.suites[suite.id]) renderSuite(suite, results.suites[suite.id], results.meta.runs);
    }
    if (BENCH.charts) BENCH.charts.renderAll(results);
    $('#save-json').disabled = false;
    $('#save-csv').disabled = false;
    setStatus(`Показано збережені результати від ${new Date(results.meta.startedAt).toLocaleString('uk-UA')} (${results.meta.runs} запусків кожного варіанта).`, 'ok');
  }

  function toCsv(results) {
    const lines = ['suite;row;metric;runs;min;max;mean;median'];
    for (const [id, r] of Object.entries(results.suites)) {
      for (const row of r.rows || []) {
        const label = row.sequences ?? row.hidden ?? row.k ?? row.epochs ?? row.n ?? (row.width ? `${row.width}x${row.height}` : row.run);
        const extra = row.format || row.variant || '';
        for (const [metric, values] of Object.entries(row)) {
          if (!Array.isArray(values) || !values.length || typeof values[0] !== 'number') continue;
          const s = stats(values);
          lines.push([id, `${label}${extra ? ` ${extra}` : ''}`, metric, values.map((v) => v.toFixed(4)).join(' '),
            s.min.toFixed(4), s.max.toFixed(4), s.mean.toFixed(4), s.median.toFixed(4)].join(';'));
        }
      }
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  function download(text, name, type) {
    HR.util.downloadBlob(new Blob([text], { type }), name);
  }

  function init() {
    const box = $('#suites');
    for (const s of SUITES) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = s.id;
      input.checked = true;
      label.append(input, ` ${s.title}`);
      label.title = s.about;
      box.appendChild(label);
    }
    $('#run').addEventListener('click', () => {
      const ids = Array.from(box.querySelectorAll('input:checked')).map((i) => i.value);
      const runs = Math.max(3, Math.min(20, Number($('#runs').value) || 5));
      runSuites(ids, runs);
    });
    $('#save-json').addEventListener('click', () => download(JSON.stringify(state.results, null, 1), `benchmark_${HR.util.fileStamp()}.json`, 'application/json'));
    $('#save-csv').addEventListener('click', () => download(toCsv(state.results), `benchmark_${HR.util.fileStamp()}.csv`, 'text/csv'));
    $('#open-json').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file || state.running) return;
      try {
        showResults(JSON.parse(await file.text()));
      } catch (err) {
        setStatus(`Не вдалося відкрити ${file.name}: ${err.message}`, 'error');
      }
    });
    collectEnvironment().then((env) => { if (!state.results) renderEnvironment(env); });

    // ?auto=1 — запуск без натискань (для автоматизованого вимірювання);
    // ?suites=volume,image — лише вибрані набори; ?runs=7 — кількість запусків
    const q = new URLSearchParams(location.search);
    if (q.get('quick') === '1') {
      // швидка перевірка сторінки: менші набори, результати не для звіту
      Object.assign(PLAN, {
        warmupRuns: 3, volume: [125, 500], hidden: [4, 8], seqlen: [4, 8], epochs: [100, 250],
        recognition: [4, 10, 1000], renderMaxN: 1000, imageScales: [0.5, 1], files: [125], opt: [{ perClass: 125, epochs: 100 }],
      });
    }
    if (q.get('runs')) $('#runs').value = q.get('runs');
    if (q.get('suites')) {
      const wanted = q.get('suites').split(',');
      box.querySelectorAll('input').forEach((i) => { i.checked = wanted.includes(i.value); });
    }
    if (q.get('auto') === '1') setTimeout(() => $('#run').click(), 1500);
  }

  Object.assign(BENCH, { SUITES, PLAN, DATA, TRAIN, stats, runSuites, showResults, toCsv, fmtMs, fmtInt, fmtNum, fmtBytes, encodeBmpFast, done: false });
  document.addEventListener('DOMContentLoaded', init);
})(window.HR, window.BENCH);
