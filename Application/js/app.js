/* Головний модуль: зв'язує інтерфейс з генератором даних, моделлю,
   графіками, журналом операцій і збереженням файлів. */
(function (HR) {
  'use strict';

  const {
    $, $$, fmtNum, fmtPct, fmtDec, fmtError, countOf, formatBytes, formatDuration, formatDateTime,
    fileStamp, fileExtension, downloadBlob, mean, msToBpm,
  } = HR.util;

  // Узгоджені з числом іменники, що часто трапляються в повідомленнях
  const seqCount = (n) => countOf(n, 'послідовність', 'послідовності', 'послідовностей');
  const valueCount = (n) => countOf(n, 'значення', 'значення', 'значень');
  const inputCount = (n) => countOf(n, 'вхід', 'входи', 'входів');
  const { CLASS_NAMES, ARTICLE_EXAMPLES } = HR.data;
  const { FORMATS } = HR.imageExport;

  const BRAIN_VERSION = '2.0.0-beta.24';
  const DEFAULT_NORMAL_RANGE = { min: 60, max: 100 };
  const RANDOM_EXAMPLE_LENGTH = 8;

  // ------------------------------------------------------------ Елементи

  const ids = [
    'btnHelp', 'btnInfo', 'libError', 'stateData', 'stateModel', 'stateResult',
    'formData', 'errData', 'perClass', 'seqLen', 'testPct', 'normMin', 'normMax', 'tol',
    'arrMin', 'arrMax', 'minSpread', 'seed', 'btnGenerate', 'dataFormat', 'btnSaveData',
    'lblFileData', 'fileData', 'progData', 'btnDataInfo', 'dataKpis', 'scatterCanvas',
    'scatterEmpty', 'scatterTip', 'gallery',
    'formTrain', 'errTrain', 'epochs', 'lr', 'momentum', 'hidden', 'earlyStop', 'errThresh',
    'btnTrain', 'btnStop', 'trainHint', 'btnEvaluate', 'btnSaveModel', 'lblFileModel', 'fileModel',
    'progTrain', 'chartFormat', 'btnSaveCharts', 'btnModelInfo', 'errorCanvas', 'errorEmpty',
    'errorTip', 'accCanvas', 'accEmpty', 'accTip', 'historyBody', 'progEval', 'metrics',
    'formRecognize', 'errRecognize', 'seqInput', 'btnRecognize', 'lblFileSeq', 'fileSeq',
    'recognizeHint', 'imgFormat', 'btnSaveImage', 'btnSaveResult', 'btnImageInfo',
    'resultWrap', 'resultCanvas', 'resultEmpty', 'resultSummary',
    'logList', 'logCount', 'logEmpty', 'btnSaveLog', 'btnClearLog',
    'dlgInfo', 'infoBody', 'dlgHelp', 'srLive',
  ];
  const el = {};
  for (const id of ids) el[id] = document.getElementById(id);

  const dataInputs = ['perClass', 'seqLen', 'testPct', 'normMin', 'normMax', 'tol', 'arrMin', 'arrMax', 'minSpread', 'seed'].map((id) => el[id]);
  const trainInputs = ['epochs', 'lr', 'momentum', 'hidden', 'earlyStop', 'errThresh'].map((id) => el[id]);

  // ------------------------------------------------------------ Стан

  const state = {
    brainLoaded: typeof window.brain !== 'undefined' && typeof window.brain.NeuralNetwork === 'function',
    dataset: null,
    model: null,
    busy: null, // 'generate' | 'train' | 'evaluate' | null
    stopRequested: false,
    preview: null, // { values, units, bpm } — послідовність, показана на зображенні
    lastResult: null, // результат останнього розпізнавання
    lastFile: null, // відомості про останній завантажений файл
    lastSave: null, // відомості про останній збережений файл
  };

  const log = new HR.OperationLog({
    list: el.logList,
    count: el.logCount,
    empty: el.logEmpty,
    onChange: () => updateControls(),
  });

  const charts = new HR.charts.TrainingCharts({
    errorCanvas: el.errorCanvas,
    accCanvas: el.accCanvas,
    errorTip: el.errorTip,
    accTip: el.accTip,
    errorEmpty: el.errorEmpty,
    accEmpty: el.accEmpty,
  });

  const scatter = new HR.charts.ScatterPlot({
    canvas: el.scatterCanvas,
    tip: el.scatterTip,
    empty: el.scatterEmpty,
    onPick: (sample) => useSequence(sample.bpm, 'bpm', `зразок №${sample.id} з набору (${CLASS_NAMES[sample.label]})`),
  });

  // ------------------------------------------------------------ Допоміжне

  function announce(text) {
    el.srLive.textContent = text;
  }

  function setProgress(block, fraction, text, status = 'running') {
    const f = Math.max(0, Math.min(1, fraction));
    block.dataset.state = status;
    block.querySelector('.progress-fill').style.width = `${(f * 100).toFixed(1)}%`;
    const track = block.querySelector('.progress-track');
    track.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    track.setAttribute('aria-valuetext', text);
    block.querySelector('.progress-text').textContent = text;
  }

  const pct = (done, total) => `${Math.floor((done / total) * 100)} %`;

  function num(input) {
    const raw = String(input.value).trim().replace(',', '.');
    return raw === '' ? NaN : Number(raw);
  }

  function showFormErrors(box, inputs, errors) {
    inputs.forEach((input) => input.removeAttribute('aria-invalid'));
    box.replaceChildren();
    if (!errors.length) {
      box.hidden = true;
      return;
    }
    const title = document.createElement('strong');
    title.textContent = 'Перевірте введені дані:';
    const list = document.createElement('ul');
    let first = null;
    for (const err of errors) {
      const item = document.createElement('li');
      item.textContent = err.text;
      list.appendChild(item);
      for (const field of err.fields || []) {
        if (el[field]) {
          el[field].setAttribute('aria-invalid', 'true');
          if (!first) first = el[field];
        }
      }
    }
    box.append(title, list);
    box.hidden = false;
    if (first) first.focus();
  }

  function setFileDisabled(label, input, disabled) {
    input.disabled = disabled;
    label.classList.toggle('is-disabled', disabled);
    label.setAttribute('aria-disabled', String(disabled));
  }

  function rememberFile(file, purpose, details) {
    state.lastFile = {
      name: file.name,
      ext: fileExtension(file.name) || '—',
      size: file.size,
      type: file.type || 'не визначено браузером',
      lastModified: file.lastModified ? new Date(file.lastModified) : null,
      purpose,
      details,
      loadedAt: new Date(),
    };
  }

  function saveBlob(blob, name, kind, extra = '') {
    downloadBlob(blob, name);
    state.lastSave = { name, size: blob.size, kind, at: new Date(), extra };
    log.success(`Збережено ${kind}: ${name} (${formatBytes(blob.size)}${extra ? `, ${extra}` : ''}).`);
  }

  function normalRange() {
    const p = state.dataset && state.dataset.params;
    if (p && Number.isFinite(p.normMin) && Number.isFinite(p.normMax)) return { min: p.normMin, max: p.normMax };
    return DEFAULT_NORMAL_RANGE;
  }

  // ------------------------------------------------------------ Стан елементів керування

  function updateControls() {
    const busy = state.busy !== null;
    const { dataset, model } = state;
    const kMismatch = Boolean(dataset && model && dataset.windowSize !== model.windowSize);

    dataInputs.forEach((input) => { input.disabled = busy; });
    trainInputs.forEach((input) => { input.disabled = busy; });
    if (!busy) el.errThresh.disabled = !el.earlyStop.checked;

    el.btnGenerate.disabled = busy;
    el.btnSaveData.disabled = !dataset || busy;
    el.dataFormat.disabled = busy;
    setFileDisabled(el.lblFileData, el.fileData, busy);

    el.btnTrain.disabled = !dataset || busy || !state.brainLoaded;
    el.btnStop.disabled = state.busy !== 'train' || state.stopRequested;
    el.btnEvaluate.disabled = !dataset || !model || busy || kMismatch;
    el.btnSaveModel.disabled = !model || busy;
    setFileDisabled(el.lblFileModel, el.fileModel, busy || !state.brainLoaded);
    el.btnSaveCharts.disabled = !charts.hasData || busy;

    el.btnRecognize.disabled = !model || state.busy === 'train';
    el.btnSaveImage.disabled = !state.preview;
    el.btnSaveResult.disabled = !state.lastResult;
    el.btnSaveLog.disabled = log.entries.length === 0;
    el.btnClearLog.disabled = log.entries.length === 0;

    if (!state.brainLoaded) {
      el.trainHint.textContent = 'Бібліотека brain.js не завантажилася — навчання недоступне.';
    } else if (state.busy === 'train') {
      el.trainHint.textContent = 'Триває навчання. Його можна перервати кнопкою «Зупинити».';
    } else if (!dataset) {
      el.trainHint.textContent = 'Спочатку згенеруйте або завантажте набір даних (крок 1).';
    } else if (kMismatch) {
      el.trainHint.textContent = `Увага: модель має ${inputCount(model.windowSize)}, а набір — послідовності по ${valueCount(dataset.windowSize)}. Навчіть нову модель.`;
    } else {
      el.trainHint.textContent = `Навчання на ${fmtNum(dataset.train.length)} прикладах, перевірка на ${fmtNum(dataset.test.length)}.`;
    }

    if (!model) {
      el.recognizeHint.textContent = 'Щоб розпізнати ритм, спочатку навчіть або завантажте модель (крок 2). Візуалізацію введеної послідовності видно одразу.';
    } else {
      el.recognizeHint.textContent = `Модель ${model.architecture}: потрібно щонайменше ${valueCount(model.windowSize)}. Довша послідовність аналізується ковзним вікном.`;
    }
    updateStepper();
  }

  function setStep(li, done, text) {
    li.dataset.done = String(done);
    li.querySelector('.step-state').textContent = text;
  }

  function updateStepper() {
    const { dataset, model, lastResult } = state;
    if (state.busy === 'generate') setStep(el.stateData, false, 'генерація…');
    else if (dataset) setStep(el.stateData, true, `${countOf(dataset.stats.total, 'зразок', 'зразки', 'зразків')}, K = ${dataset.windowSize}`);
    else setStep(el.stateData, false, 'не згенеровано');

    if (state.busy === 'train') setStep(el.stateModel, false, 'навчання…');
    else if (model) {
      const acc = model.evaluation ? model.evaluation.accuracy : model.training && model.training.testAccuracy;
      const how = model.source === 'file' ? 'завантажена' : 'навчена';
      setStep(el.stateModel, true, Number.isFinite(acc) ? `${how}, точність ${fmtPct(acc)}` : how);
    } else setStep(el.stateModel, false, 'не навчена');

    if (lastResult) {
      setStep(el.stateResult, true, `${CLASS_NAMES[lastResult.result.label]}, ${fmtPct(lastResult.result.confidence)}`);
    } else setStep(el.stateResult, false, 'не виконано');
  }

  function setBusy(kind) {
    state.busy = kind;
    updateControls();
  }

  // ============================================================ КРОК 1. ДАНІ

  function readDataParams() {
    const seedText = el.seed.value.trim();
    return {
      perClass: num(el.perClass),
      length: num(el.seqLen),
      testPct: num(el.testPct),
      normMin: num(el.normMin),
      normMax: num(el.normMax),
      tolerance: num(el.tol),
      arrMin: num(el.arrMin),
      arrMax: num(el.arrMax),
      minSpread: num(el.minSpread),
      seed: seedText === '' ? null : /^\d+$/.test(seedText) ? Number(seedText) : NaN,
    };
  }

  async function onGenerate(ev) {
    ev.preventDefault();
    if (state.busy) return;
    const params = readDataParams();
    const { errors, warnings } = HR.data.validateParams(params);
    showFormErrors(el.errData, dataInputs, errors);
    if (errors.length) {
      log.error(`Генерацію не запущено: ${errors.map((e) => e.text).join(' ')}`);
      return;
    }
    warnings.forEach((w) => log.warn(w.text));

    setBusy('generate');
    const total = params.perClass * 2;
    log.info(`Генерація даних: ${seqCount(total)} (по ${fmtNum(params.perClass)} у класі), K = ${params.length}; `
      + `норма ${params.normMin}–${params.normMax} уд/хв, Tol = ${params.tolerance}; `
      + `аритмія ${params.arrMin}–${params.arrMax} уд/хв, мін. розкид ${params.minSpread}; `
      + `тестова вибірка ${params.testPct} %; seed: ${params.seed === null ? 'випадковий' : params.seed}.`);
    setProgress(el.progData, 0, `Згенеровано 0 з ${fmtNum(total)}`);
    let quarter = 0;
    try {
      const ds = await HR.data.buildDataset(params, {
        onProgress(done, all) {
          setProgress(el.progData, done / all, `Згенеровано ${fmtNum(done)} з ${fmtNum(all)} (${pct(done, all)})`);
          const q = Math.floor((done / all) * 4);
          if (q > quarter && q < 4) {
            quarter = q;
            log.info(`Генерація: ${q * 25} % (${fmtNum(done)} з ${fmtNum(all)}).`);
          }
        },
      });
      setDataset(ds);
      setProgress(el.progData, 1, `Готово: ${seqCount(ds.stats.total)} (${formatDuration(ds.elapsedMs)})`, 'done');
      log.success(`Набір згенеровано: ${seqCount(ds.stats.total)} — навчальна вибірка ${fmtNum(ds.stats.train)}, тестова ${fmtNum(ds.stats.test)}; `
        + `відкинуто «рівних» кандидатів аритмії: ${fmtNum(ds.rejected)}; seed = ${ds.seed}; `
        + `час обчислень ${formatDuration(ds.computeMs)}, разом з відображенням прогресу ${formatDuration(ds.elapsedMs)}.`);
      announce(`Згенеровано ${seqCount(ds.stats.total)}`);
    } catch (err) {
      setProgress(el.progData, 1, `Помилка: ${err.message}`, 'error');
      log.error(`Помилка генерації: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }

  function setDataset(ds) {
    state.dataset = ds;
    renderDataKpis(ds);
    scatter.setData(ds);
    renderGallery(ds);
    if (state.model && state.model.windowSize !== ds.windowSize) {
      log.warn(`Поточна модель має ${inputCount(state.model.windowSize)}, а новий набір — послідовності по ${valueCount(ds.windowSize)}. Для оцінювання навчіть нову модель.`);
    }
    updateControls();
  }

  function kpi(label, value, note) {
    const box = document.createElement('div');
    box.className = 'kpi';
    const l = document.createElement('div');
    l.className = 'kpi-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'kpi-value';
    v.textContent = value;
    box.append(l, v);
    if (note) {
      const n = document.createElement('div');
      n.className = 'kpi-note';
      n.textContent = note;
      box.appendChild(n);
    }
    return box;
  }

  function renderDataKpis(ds) {
    const s = ds.stats;
    const tiles = [
      kpi('Усього послідовностей', fmtNum(s.total), `норма ${fmtNum(s.byClass.normal.count)} · аритмія ${fmtNum(s.byClass.arrhythmia.count)}`),
      kpi('Навчальна / тестова', `${fmtNum(s.train)} / ${fmtNum(s.test)}`, 'стратифіковане розбиття'),
      kpi('Довжина K', String(ds.windowSize), `ЧСС ${fmtNum(s.minBpm)}–${fmtNum(s.maxBpm)} уд/хв`),
    ];
    if (ds.source === 'generated') {
      tiles.push(kpi('Відкинуто кандидатів', fmtNum(ds.rejected), `аритмія з малим розкидом · seed ${ds.seed}`));
    } else {
      tiles.push(kpi('Джерело', 'файл', ds.fileName));
    }
    el.dataKpis.replaceChildren(...tiles);
  }

  function renderGallery(ds) {
    const examples = [];
    for (const label of HR.data.CLASSES) {
      examples.push(...ds.samples.filter((s) => s.label === label).slice(0, 4));
    }
    const items = examples.map((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `thumb ${s.label}`;
      btn.title = 'Перенести цю послідовність у поле розпізнавання';
      const head = document.createElement('span');
      head.className = 'thumb-label';
      const cls = document.createElement('span');
      cls.textContent = CLASS_NAMES[s.label];
      const id = document.createElement('span');
      id.textContent = `№${s.id}`;
      head.append(cls, id);
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      const values = document.createElement('span');
      values.className = 'thumb-values';
      values.textContent = s.bpm.join(', ');
      btn.append(head, canvas, values);
      btn.addEventListener('click', () => useSequence(s.bpm, 'bpm', `зразок №${s.id} з набору (${CLASS_NAMES[s.label]})`));
      return { btn, canvas, bpm: s.bpm };
    });
    el.gallery.replaceChildren(...items.map((i) => i.btn));
    // малюємо після вставлення в DOM, коли відомі розміри
    requestAnimationFrame(() => items.forEach((i) => HR.charts.drawRhythmThumb(i.canvas, i.bpm)));
  }

  function onSaveData() {
    const ds = state.dataset;
    if (!ds) return;
    const format = el.dataFormat.value;
    const stamp = fileStamp();
    const text = format === 'json' ? HR.data.datasetToJson(ds) : HR.data.datasetToCsv(ds);
    const type = format === 'json' ? 'application/json' : 'text/csv';
    const blob = new Blob([format === 'csv' ? '﻿' + text : text], { type: `${type};charset=utf-8` });
    saveBlob(blob, `rhythm_dataset_K${ds.windowSize}_${stamp}.${format}`, 'набір даних', `${seqCount(ds.stats.total)}, ${format.toUpperCase()}`);
  }

  async function onLoadData() {
    const file = el.fileData.files[0];
    el.fileData.value = '';
    if (!file || state.busy) return;
    log.info(`Завантаження набору даних з файлу ${file.name} (${formatBytes(file.size)})…`);
    try {
      const text = await file.text();
      const testPct = Number.isFinite(num(el.testPct)) ? num(el.testPct) : 20;
      const ds = HR.data.parseDatasetFile(text, file.name, testPct / 100);
      ds.fileName = file.name;
      rememberFile(file, 'набір даних', `${seqCount(ds.stats.total)}, K = ${ds.windowSize}`);
      el.seqLen.value = String(Math.min(12, ds.windowSize));
      setDataset(ds);
      setProgress(el.progData, 1, `Завантажено з файлу: ${seqCount(ds.stats.total)}`, 'done');
      log.success(`Набір даних завантажено: ${file.name} — ${seqCount(ds.stats.total)} (норма ${ds.stats.byClass.normal.count}, аритмія ${ds.stats.byClass.arrhythmia.count}), K = ${ds.windowSize}; `
        + `${ds.splitFromFile ? 'розбиття на вибірки взято з файлу' : `розбиття виконано автоматично (тестова ${testPct} %)`}.`);
    } catch (err) {
      log.error(`Не вдалося завантажити набір даних «${file.name}»: ${err.message}`);
      setProgress(el.progData, 1, 'Помилка завантаження файлу', 'error');
    }
  }

  // ============================================================ КРОК 2. НАВЧАННЯ

  function readTrainOptions() {
    const errors = [];
    const epochs = num(el.epochs);
    const learningRate = num(el.lr);
    const momentum = num(el.momentum);
    const hiddenText = el.hidden.value.trim();
    const hiddenLayers = hiddenText.split(/[\s,;]+/).filter(Boolean).map(Number);
    const earlyStop = el.earlyStop.checked;
    const errorThresh = earlyStop ? num(el.errThresh) : 0;

    if (!Number.isInteger(epochs) || epochs < 1 || epochs > 20000) {
      errors.push({ fields: ['epochs'], text: 'Кількість епох — ціле число від 1 до 20 000.' });
    }
    if (!(learningRate > 0 && learningRate < 1)) {
      errors.push({ fields: ['lr'], text: 'Швидкість навчання має бути більшою за 0 і меншою за 1 (обмеження brain.js).' });
    }
    if (!(momentum > 0 && momentum < 1)) {
      errors.push({ fields: ['momentum'], text: 'Момент має бути більшим за 0 і меншим за 1 (обмеження brain.js).' });
    }
    if (!hiddenLayers.length || hiddenLayers.length > 4 || hiddenLayers.some((n) => !Number.isInteger(n) || n < 1 || n > 128)) {
      errors.push({ fields: ['hidden'], text: 'Приховані шари: від 1 до 4 цілих чисел від 1 до 128 через кому, напр. «8» або «12, 6».' });
    }
    if (earlyStop && !(errorThresh > 0 && errorThresh < 0.5)) {
      errors.push({ fields: ['errThresh'], text: 'Цільова помилка для ранньої зупинки — число від 0 до 0,5.' });
    }
    showFormErrors(el.errTrain, trainInputs, errors);
    if (errors.length) {
      log.error(`Навчання не запущено: ${errors.map((e) => e.text).join(' ')}`);
      return null;
    }
    return { epochs, learningRate, momentum, hiddenLayers, errorThresh };
  }

  function emptyHistory() {
    return { epoch: [], error: [], evalEpoch: [], trainAcc: [], testAcc: [] };
  }

  async function onTrain(ev) {
    ev.preventDefault();
    if (state.busy || !state.dataset || !state.brainLoaded) return;
    const opts = readTrainOptions();
    if (!opts) return;
    const ds = state.dataset;
    const { encoding, trainRange } = HR.RhythmModel.encodingFor(ds.train);
    let model;
    try {
      model = new HR.RhythmModel({ windowSize: ds.windowSize, hiddenLayers: opts.hiddenLayers, encoding, trainRange });
    } catch (err) {
      log.error(`Не вдалося створити мережу: ${err.message}`);
      return;
    }

    state.stopRequested = false;
    setBusy('train');
    resetEvaluationView('Очікує завершення навчання');
    charts.show(emptyHistory(), opts.epochs);
    setProgress(el.progTrain, 0, `Епоха 0 з ${fmtNum(opts.epochs)}`);
    log.info(`Навчання: мережа ${model.architecture} (${countOf(model.parameterCount, 'параметр', 'параметри', 'параметрів')} — ваги та зсуви), епох: ${fmtNum(opts.epochs)}, `
      + `швидкість навчання ${fmtDec(opts.learningRate)}, момент ${fmtDec(opts.momentum)}`
      + `${opts.errorThresh ? `, рання зупинка при помилці ≤ ${fmtDec(opts.errorThresh)}` : ''}; `
      + `навчальна вибірка ${fmtNum(ds.train.length)}, тестова ${fmtNum(ds.test.length)}; нормування входів ${encoding.min}–${encoding.max} уд/хв.`);

    let decile = 0;
    try {
      const t = await model.train(ds.train, ds.test, opts, {
        shouldStop: () => state.stopRequested,
        onEpoch(epoch, error, history) {
          const d = Math.floor((epoch * 10) / opts.epochs);
          if (d > decile && d < 10) {
            decile = d;
            const last = history.testAcc.length - 1;
            log.info(`Епоха ${fmtNum(epoch)} з ${fmtNum(opts.epochs)} (${d * 10} %): помилка ${fmtError(error)}, точність на тесті ${fmtPct(history.testAcc[last])}.`);
          }
        },
        onFrame({ epoch, epochs, error, history }) {
          setProgress(el.progTrain, epoch / epochs, `Епоха ${fmtNum(epoch)} з ${fmtNum(epochs)} (${pct(epoch, epochs)}) · помилка ${fmtError(error)}`);
          charts.update(history, epochs);
        },
      });

      state.model = model;
      state.lastResult = null;
      charts.show(model.history, opts.epochs);
      renderHistoryTable(model.history);
      const reason = {
        completed: 'завершено',
        threshold: `досягнуто цільової помилки ≤ ${fmtDec(opts.errorThresh)}`,
        stopped: 'зупинено користувачем',
      }[t.stopReason];
      const title = {
        completed: 'Навчання завершено',
        threshold: `Навчання зупинено (досягнуто цільової помилки ≤ ${fmtDec(opts.errorThresh)})`,
        stopped: 'Навчання зупинено користувачем',
      }[t.stopReason];
      setProgress(el.progTrain, t.epochsDone / t.epochsRequested,
        `Епоха ${fmtNum(t.epochsDone)} з ${fmtNum(t.epochsRequested)} — ${reason} (${formatDuration(t.elapsedMs)})`,
        t.stopReason === 'stopped' ? 'stopped' : 'done');
      const message = `${title}: виконано епох — ${fmtNum(t.epochsDone)} з ${fmtNum(t.epochsRequested)}, помилка ${fmtError(t.finalError)}, `
        + `точність: навчальна ${fmtPct(t.trainAccuracy)}, тестова ${fmtPct(t.testAccuracy)}; `
        + `час ${formatDuration(t.elapsedMs)} (з них обчислення ${formatDuration(t.computeMs)}).`;
      if (t.stopReason === 'stopped') log.warn(message);
      else log.success(message);
      announce(title);

      await runEvaluation();
      if (state.preview) recognizePreview(false);
    } catch (err) {
      setProgress(el.progTrain, 1, `Помилка: ${err.message}`, 'error');
      log.error(`Помилка навчання: ${err.message}`);
    } finally {
      state.stopRequested = false;
      setBusy(null);
    }
  }

  function onStop() {
    if (state.busy !== 'train' || state.stopRequested) return;
    state.stopRequested = true;
    log.warn('Запит на зупинку навчання — мережа завершить поточну епоху.');
    updateControls();
  }

  function renderHistoryTable(history) {
    const rows = [];
    if (history && history.epoch.length) {
      const total = history.epoch.length;
      const marks = new Set([1, total]);
      for (let d = 1; d < 10; d++) marks.add(Math.max(1, Math.round((total * d) / 10)));
      for (const epoch of [...marks].sort((a, b) => a - b)) {
        const i = epoch - 1;
        const j = history.evalEpoch.lastIndexOf(epoch) >= 0
          ? history.evalEpoch.lastIndexOf(epoch)
          : history.evalEpoch.findIndex((e) => e >= epoch);
        const tr = document.createElement('tr');
        const cells = [
          fmtNum(history.epoch[i], 0),
          fmtError(history.error[i]),
          j >= 0 ? fmtNum(history.trainAcc[j] * 100, 1) : '—',
          j >= 0 && Number.isFinite(history.testAcc[j]) ? fmtNum(history.testAcc[j] * 100, 1) : '—',
        ];
        for (const c of cells) {
          const td = document.createElement('td');
          td.textContent = c;
          tr.appendChild(td);
        }
        rows.push(tr);
      }
    }
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.style.textAlign = 'left';
      td.style.color = 'var(--muted)';
      td.textContent = 'Немає даних про навчання';
      tr.appendChild(td);
      rows.push(tr);
    }
    el.historyBody.replaceChildren(...rows);
  }

  function resetEvaluationView(text) {
    setProgress(el.progEval, 0, text, 'idle');
    const ph = document.createElement('div');
    ph.className = 'placeholder';
    ph.style.minHeight = '96px';
    ph.innerHTML = '<span><strong>Результати оцінювання</strong><br>точність, чутливість, специфічність і матриця помилок з\'являться після навчання</span>';
    el.metrics.replaceChildren(ph);
  }

  async function runEvaluation() {
    const { dataset: ds, model } = state;
    if (!ds || !model) return;
    if (ds.windowSize !== model.windowSize) {
      setProgress(el.progEval, 1, 'Довжина послідовностей набору не збігається з входами моделі', 'error');
      log.error(`Оцінювання неможливе: модель має ${inputCount(model.windowSize)}, а послідовності набору — по ${valueCount(ds.windowSize)}.`);
      return;
    }
    const previous = state.busy;
    setBusy('evaluate');
    setProgress(el.progEval, 0, `Перевірено 0 з ${fmtNum(ds.test.length)}`);
    log.info(`Оцінювання на тестовій вибірці: ${seqCount(ds.test.length)}…`);
    try {
      const ev = await model.evaluate(ds.test, {
        onProgress(done, total) {
          setProgress(el.progEval, done / total, `Перевірено ${fmtNum(done)} з ${fmtNum(total)} (${pct(done, total)})`);
        },
      });
      setProgress(el.progEval, 1, `Готово: точність ${fmtPct(ev.accuracy)} на ${fmtNum(ev.total)} прикладах`, 'done');
      renderMetrics(ev);
      log.success(`Оцінювання: точність ${fmtPct(ev.accuracy)} = (TP + TN) / усі = (${ev.tp} + ${ev.tn}) / ${ev.total}; FP = ${ev.fp}, FN = ${ev.fn}; `
        + `чутливість ${fmtPct(ev.recall)}, специфічність ${fmtPct(ev.specificity)}, F1 = ${fmtNum(ev.f1, 3)}, перехресна ентропія ${fmtNum(ev.crossEntropy, 4)}.`);
      if (ev.misclassified.length) {
        const shown = ev.misclassified.slice(0, 5)
          .map((m) => `[${m.sample.bpm.join(', ')}] ${CLASS_NAMES[m.sample.label]} → ${CLASS_NAMES[m.prediction.label]}`)
          .join('; ');
        log.info(`Помилкові класифікації (${ev.misclassified.length}): ${shown}${ev.misclassified.length > 5 ? '; …' : ''}`);
      }
    } catch (err) {
      setProgress(el.progEval, 1, `Помилка: ${err.message}`, 'error');
      log.error(`Помилка оцінювання: ${err.message}`);
    } finally {
      setBusy(previous === 'evaluate' ? null : previous);
    }
  }

  async function onEvaluate() {
    if (state.busy) return;
    await runEvaluation();
    setBusy(null);
  }

  function renderMetrics(ev) {
    const wrap = document.createElement('div');
    wrap.className = 'metrics-grid';

    const tiles = document.createElement('div');
    tiles.className = 'kpis';
    tiles.append(
      kpi('Точність (accuracy)', fmtPct(ev.accuracy), '(TP + TN) / усі'),
      kpi('Чутливість', fmtPct(ev.recall), 'аритмію знайдено'),
      kpi('Специфічність', fmtPct(ev.specificity), 'норму підтверджено'),
      kpi('Влучність', fmtPct(ev.precision), 'прогноз «аритмія» правильний'),
      kpi('F1-міра', fmtNum(ev.f1, 3), `перехр. ентропія ${fmtNum(ev.crossEntropy, 3)}`),
    );

    // матриця помилок: рядки — справжній клас, стовпці — прогноз мережі
    const table = document.createElement('table');
    table.className = 'cm';
    const caption = document.createElement('caption');
    caption.className = 'sr-only';
    caption.textContent = 'Матриця помилок на тестовій вибірці';
    table.appendChild(caption);
    const cells = [
      [['TN', ev.tn, true], ['FP', ev.fp, false]],
      [['FN', ev.fn, false], ['TP', ev.tp, true]],
    ];
    const rowTotals = [ev.tn + ev.fp, ev.fn + ev.tp];
    const head = document.createElement('tr');
    head.innerHTML = '<th></th><th colspan="2" class="axis-title">Прогноз мережі</th>';
    const head2 = document.createElement('tr');
    head2.innerHTML = '<th class="axis-title">Справжній клас</th><th>Норма</th><th>Аритмія</th>';
    table.append(head, head2);
    ['Норма', 'Аритмія'].forEach((name, r) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = name;
      tr.appendChild(th);
      cells[r].forEach(([tag, count]) => {
        const td = document.createElement('td');
        const share = rowTotals[r] ? count / rowTotals[r] : 0;
        const alpha = 0.08 + share * 0.82;
        td.style.background = `rgba(74, 58, 167, ${alpha.toFixed(3)})`;
        td.style.color = alpha > 0.5 ? '#ffffff' : 'var(--ink)';
        td.textContent = fmtNum(count, 0);
        const small = document.createElement('small');
        small.textContent = `${tag} · ${fmtNum(share * 100, 1)} %`;
        td.appendChild(small);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    const cmBox = document.createElement('div');
    const cmTitle = document.createElement('div');
    cmTitle.className = 'kpi-label';
    cmTitle.style.marginBottom = '4px';
    cmTitle.textContent = `Матриця помилок (${fmtNum(ev.total)} тестових прикладів)`;
    cmBox.append(cmTitle, table);

    wrap.append(tiles, cmBox);
    const parts = [wrap];

    if (ev.misclassified && ev.misclassified.length) {
      const det = document.createElement('details');
      det.className = 'more';
      det.style.marginTop = '12px';
      const sum = document.createElement('summary');
      sum.textContent = `Помилково класифіковані приклади (${ev.misclassified.length})`;
      const tw = document.createElement('div');
      tw.className = 'table-wrap';
      const t = document.createElement('table');
      t.className = 'data';
      t.innerHTML = '<thead><tr><th>Послідовність, уд/хв</th><th>Справжній клас</th><th>Прогноз</th><th>Впевненість</th></tr></thead>';
      const body = document.createElement('tbody');
      for (const m of ev.misclassified.slice(0, 50)) {
        const tr = document.createElement('tr');
        for (const c of [m.sample.bpm.join(', '), CLASS_NAMES[m.sample.label], CLASS_NAMES[m.prediction.label], fmtPct(m.prediction.confidence)]) {
          const td = document.createElement('td');
          td.textContent = c;
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
      t.appendChild(body);
      tw.appendChild(t);
      det.append(sum, tw);
      parts.push(det);
    }
    el.metrics.replaceChildren(...parts);
  }

  function onSaveModel() {
    const model = state.model;
    if (!model) return;
    const json = JSON.stringify(model.toJSON());
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    saveBlob(blob, `rhythm_model_${model.architecture.replace(/–/g, '-')}_${fileStamp()}.json`, 'модель', `мережа ${model.architecture}`);
  }

  async function onLoadModel() {
    const file = el.fileModel.files[0];
    el.fileModel.value = '';
    if (!file || state.busy) return;
    log.info(`Завантаження моделі з файлу ${file.name} (${formatBytes(file.size)})…`);
    try {
      const text = await file.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        throw new Error(`файл не є коректним JSON (${err.message})`);
      }
      const model = HR.RhythmModel.fromJSON(json, file.name);
      state.model = model;
      state.lastResult = null;
      rememberFile(file, 'модель', `мережа ${model.architecture}, K = ${model.windowSize}`);
      const t = model.training;
      if (model.history) {
        charts.show(model.history, t ? t.epochsRequested : model.history.epoch.length);
        renderHistoryTable(model.history);
      } else {
        charts.clear();
        renderHistoryTable(null);
      }
      setProgress(el.progTrain, 1, `Модель завантажено з файлу${t ? ` (виконано епох навчання: ${fmtNum(t.epochsDone)})` : ''}`, 'done');
      if (model.evaluation) {
        renderMetrics({ ...model.evaluation, misclassified: [] });
        setProgress(el.progEval, 1, `Збережений результат: точність ${fmtPct(model.evaluation.accuracy)}`, 'done');
      } else {
        resetEvaluationView('Немає збереженого результату');
      }
      log.success(`Модель завантажено: ${file.name} — мережа ${model.architecture}, ${countOf(model.parameterCount, 'параметр', 'параметри', 'параметрів')}, `
        + `нормування ${model.encoding.min}–${model.encoding.max} уд/хв${t ? `; виконано епох навчання: ${fmtNum(t.epochsDone)}, швидкість навчання ${fmtDec(t.learningRate)}` : ''}.`);
      updateControls();
      if (state.dataset && state.dataset.windowSize === model.windowSize) {
        log.info('Набір даних сумісний з моделлю — можна натиснути «Оцінити на тестовій вибірці».');
      }
      if (state.preview) recognizePreview(false);
    } catch (err) {
      log.error(`Не вдалося завантажити модель «${file.name}»: ${err.message}`);
    }
  }

  async function onSaveCharts() {
    const model = state.model;
    if (!charts.hasData) return;
    const t = model && model.training;
    const subtitle = model
      ? `Мережа ${model.architecture} · епох: ${t ? fmtNum(t.epochsDone) : '—'} · швидкість навчання ${t ? fmtDec(t.learningRate) : '—'} · момент ${t ? fmtDec(t.momentum) : '—'} · ${formatDateTime(new Date())}`
      : formatDateTime(new Date());
    const canvas = HR.charts.composeTrainingImage({
      history: charts.history,
      totalEpochs: charts.totalEpochs,
      title: 'Динаміка навчання нейронної мережі',
      subtitle,
    });
    const format = el.chartFormat.value;
    try {
      const blob = await HR.imageExport.canvasToBlob(canvas, format);
      saveBlob(blob, `rhythm_training_${fileStamp()}.${FORMATS[format].ext}`, 'графіки навчання', `${FORMATS[format].label}, ${canvas.width}×${canvas.height} px`);
    } catch (err) {
      log.error(`Не вдалося зберегти графіки: ${err.message}`);
    }
  }

  // ============================================================ КРОК 3. РОЗПІЗНАВАННЯ

  function currentUnits() {
    const checked = $('input[name="units"]:checked');
    return checked ? checked.value : 'bpm';
  }

  function setUnits(units) {
    const radio = $(`input[name="units"][value="${units}"]`);
    if (radio) radio.checked = true;
  }

  function parseSequence(text, units) {
    const tokens = text.split(/[\s,;]+/).filter(Boolean);
    if (!tokens.length) return { error: 'Введіть послідовність чисел, напр.: 72, 68, 75, 71.' };
    const bad = tokens.filter((t) => !/^\d+(\.\d+)?$/.test(t));
    if (bad.length) {
      return { error: `Це не додатні числа: ${bad.slice(0, 5).join(' ')}. Числа розділяйте комою або пробілом, дробову частину — крапкою.` };
    }
    const values = tokens.map(Number);
    if (values.length < 2) return { error: 'Потрібно щонайменше 2 значення.' };
    if (values.length > 200) return { error: 'Забагато значень: максимум 200.' };
    if (units === 'bpm') {
      if (values.some((v) => v < 20 || v > 300)) {
        return { error: 'ЧСС має бути в межах 20–300 уд/хв. Якщо це RR-інтервали в мілісекундах — оберіть одиниці «RR, мс».' };
      }
      return { values, bpm: values };
    }
    if (values.some((v) => v < 200 || v > 3000)) {
      return { error: 'RR-інтервали мають бути в межах 200–3000 мс. Якщо це ЧСС — оберіть одиниці «ЧСС, уд/хв».' };
    }
    return { values, bpm: values.map((v) => msToBpm(v)) };
  }

  function buildWarnings(bpm, result, model) {
    const warnings = [];
    const range = model.trainRange;
    if (range) {
      const outside = bpm.filter((v) => v < range.min || v > range.max);
      if (outside.length) {
        warnings.push({
          short: `Є значення поза діапазоном навчальних даних (${fmtNum(range.min)}–${fmtNum(range.max)} уд/хв)`,
          long: `Значення поза діапазоном навчальних даних (${fmtNum(range.min)}–${fmtNum(range.max)} уд/хв): ${outside.map((v) => fmtNum(v, 0)).join(', ')}. Результат може бути ненадійним.`,
        });
      }
    }
    const avg = mean(bpm);
    const nr = normalRange();
    if (result.label === 'normal' && (avg < nr.min || avg > nr.max)) {
      const kind = avg < nr.min ? 'брадикардія' : 'тахікардія';
      warnings.push({
        short: `Інтервали рівні, але середня ЧСС ${fmtNum(avg, 0)} уд/хв поза нормою — можлива ${kind}`,
        long: `Інтервали рівні, але середня ЧСС ${fmtNum(avg, 0)} уд/хв поза межами норми ${nr.min}–${nr.max} уд/хв — можлива ${kind}, яку двокласова модель (норма / аритмія) не розрізняє.`,
      });
    }
    return warnings;
  }

  function drawResultImage() {
    const p = state.preview;
    if (!p) return;
    const r = state.lastResult;
    HR.ecg.renderResult(el.resultCanvas, {
      bpm: p.bpm,
      inputCount: p.values.length,
      units: p.units,
      result: r ? r.result : null,
      model: state.model,
      warnings: r ? r.warnings : [],
      normalRange: normalRange(),
      createdAt: r ? r.createdAt : new Date(),
    });
    setResultEmpty(false);
  }

  function setResultEmpty(isEmpty) {
    el.resultWrap.classList.toggle('is-empty', isEmpty);
    el.resultEmpty.hidden = !isEmpty;
  }

  // Показує введену послідовність на зображенні без класифікації
  function updatePreview({ quiet = true } = {}) {
    const text = el.seqInput.value;
    state.lastResult = null;
    renderSummary();
    if (!text.trim()) {
      state.preview = null;
      setResultEmpty(true);
      showFormErrors(el.errRecognize, [el.seqInput], []);
      updateControls();
      return null;
    }
    const units = currentUnits();
    const parsed = parseSequence(text, units);
    if (parsed.error) {
      if (!quiet) showFormErrors(el.errRecognize, [el.seqInput], [{ fields: ['seqInput'], text: parsed.error }]);
      updateControls();
      return parsed;
    }
    showFormErrors(el.errRecognize, [el.seqInput], []);
    state.preview = { values: parsed.values, units, bpm: parsed.bpm };
    drawResultImage();
    updateControls();
    return parsed;
  }

  // Класифікує показану послідовність; logErrors=false — тихий перерахунок
  function recognizePreview(logErrors = true) {
    const parsed = updatePreview({ quiet: !logErrors });
    if (!parsed) {
      if (logErrors) {
        showFormErrors(el.errRecognize, [el.seqInput], [{ fields: ['seqInput'], text: 'Введіть послідовність чисел, напр.: 72, 68, 75, 71.' }]);
        log.error('Розпізнавання: поле послідовності порожнє.');
      }
      return;
    }
    if (parsed.error) {
      if (logErrors) log.error(`Розпізнавання: ${parsed.error}`);
      return;
    }
    const model = state.model;
    if (!model) {
      if (logErrors) log.error('Розпізнавання неможливе: модель ще не навчена і не завантажена (крок 2).');
      return;
    }
    if (parsed.bpm.length < model.windowSize) {
      const text = `Потрібно щонайменше ${valueCount(model.windowSize)} — стільки входів має мережа (введено ${parsed.bpm.length}).`;
      showFormErrors(el.errRecognize, [el.seqInput], [{ fields: ['seqInput'], text }]);
      if (logErrors) log.error(`Розпізнавання: ${text}`);
      return;
    }
    const result = model.predictSeries(parsed.bpm);
    const warnings = buildWarnings(parsed.bpm, result, model);
    state.lastResult = {
      createdAt: new Date(),
      values: parsed.values,
      units: state.preview.units,
      bpm: parsed.bpm,
      result,
      warnings,
    };
    drawResultImage();
    renderSummary();
    updateControls();
    const unitText = state.preview.units === 'ms' ? 'мс' : 'уд/хв';
    log.success(`Розпізнавання [${parsed.values.join(', ')} ${unitText}]: ${CLASS_NAMES[result.label]} — ${fmtPct(result.confidence)} `
      + `(норма ${fmtPct(result.probs[0])}, аритмія ${fmtPct(result.probs[1])}); вікон: ${result.windows.length}, з них аритмічних: ${result.arrhythmicWindows}.`);
    warnings.forEach((w) => log.warn(w.long));
    announce(`Результат: ${CLASS_NAMES[result.label]}, ${fmtPct(result.confidence)}`);
  }

  function renderSummary() {
    const r = state.lastResult;
    if (!r) {
      el.resultSummary.replaceChildren();
      return;
    }
    const parts = [];
    const verdict = document.createElement('div');
    verdict.className = 'verdict';
    const badge = document.createElement('span');
    badge.className = `verdict-badge ${r.result.label}`;
    badge.textContent = `${CLASS_NAMES[r.result.label]} · ${fmtPct(r.result.confidence)}`;
    const text = document.createElement('span');
    text.className = 'verdict-text';
    const strong = document.createElement('strong');
    strong.textContent = `${countOf(r.result.windows.length, 'вікно', 'вікна', 'вікон')} по ${valueCount(state.model.windowSize)}`;
    text.append(strong, document.createTextNode(` · середні ймовірності: норма ${fmtPct(r.result.probs[0])}, аритмія ${fmtPct(r.result.probs[1])} · аритмічних вікон: ${r.result.arrhythmicWindows}`));
    verdict.append(badge, text);
    parts.push(verdict);

    for (const w of r.warnings) {
      const n = document.createElement('div');
      n.className = 'notice notice-warn';
      n.setAttribute('role', 'note');
      n.innerHTML = '<svg aria-hidden="true"><use href="#i-warn"/></svg>';
      const span = document.createElement('span');
      span.textContent = w.long;
      n.appendChild(span);
      parts.push(n);
    }

    const det = document.createElement('details');
    det.className = 'more';
    const sum = document.createElement('summary');
    sum.textContent = 'Результат по кожному вікну';
    const tw = document.createElement('div');
    tw.className = 'table-wrap';
    const t = document.createElement('table');
    t.className = 'data';
    t.innerHTML = '<thead><tr><th>Вікно</th><th>Значення, уд/хв</th><th>Норма</th><th>Аритмія</th><th>Виходи мережі</th><th>Клас</th></tr></thead>';
    const body = document.createElement('tbody');
    r.result.windows.forEach((w, i) => {
      const tr = document.createElement('tr');
      const cells = [
        String(i + 1),
        w.values.map((v) => fmtNum(v, 0)).join(', '),
        fmtPct(w.probs[0]),
        fmtPct(w.probs[1]),
        w.raw.map((v) => v.toFixed(3)).join(' / '),
        CLASS_NAMES[w.label],
      ];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    });
    t.appendChild(body);
    tw.appendChild(t);
    det.append(sum, tw);
    parts.push(det);
    el.resultSummary.replaceChildren(...parts);
    el.resultSummary.style.display = 'grid';
    el.resultSummary.style.gap = '10px';
  }

  // Заповнює поле послідовністю (з прикладу, галереї, файлу) і, якщо є модель, розпізнає
  function useSequence(values, units, source) {
    el.seqInput.value = values.map((v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10))).join(', ');
    setUnits(units);
    log.info(`Послідовність для розпізнавання: ${source}.`);
    if (state.model && state.busy !== 'train') recognizePreview(true);
    else updatePreview({ quiet: false });
  }

  function onExampleClick(ev) {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.example) {
      const ex = ARTICLE_EXAMPLES[chip.dataset.example];
      useSequence(ex.values, 'bpm', `приклад зі статті — ${ex.name} (N = ${ex.values.length})`);
      return;
    }
    if (chip.dataset.random) {
      const params = readDataParams();
      const { errors } = HR.data.validateParams({ ...params, perClass: 500, seed: null });
      if (errors.length) {
        showFormErrors(el.errData, dataInputs, errors);
        log.error(`Випадковий приклад не створено: параметри генерації (крок 1) некоректні — ${errors[0].text}`);
        return;
      }
      const k = state.model ? state.model.windowSize : params.length;
      const count = Math.max(k, RANDOM_EXAMPLE_LENGTH);
      const rng = new HR.Random();
      const values = HR.data.exampleSeries(rng, params, chip.dataset.random, count, k);
      useSequence(values, 'bpm', `випадкова послідовність класу «${CLASS_NAMES[chip.dataset.random]}» (N = ${count}, seed ${rng.seed})`);
    }
  }

  async function onLoadSequence() {
    const file = el.fileSeq.files[0];
    el.fileSeq.value = '';
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('файл більший за 1 МБ');
      const text = await file.text();
      const tokens = text.replace(/^﻿/, '').match(/\d+(?:\.\d+)?/g) || [];
      if (!tokens.length) throw new Error('у файлі не знайдено чисел');
      const values = tokens.map(Number).slice(0, 200);
      const units = values.every((v) => v >= 200) ? 'ms' : 'bpm';
      const numbers = countOf(values.length, 'число', 'числа', 'чисел');
      rememberFile(file, 'послідовність для розпізнавання', `${numbers}${tokens.length > 200 ? ` (з ${tokens.length}, взято перші 200)` : ''}, одиниці: ${units === 'ms' ? 'мс' : 'уд/хв'}`);
      log.info(`Файл послідовності ${file.name} (${formatBytes(file.size)}): прочитано ${numbers}; одиниці визначено як ${units === 'ms' ? 'RR-інтервали, мс' : 'ЧСС, уд/хв'}.`);
      useSequence(values, units, `файл ${file.name}`);
    } catch (err) {
      log.error(`Не вдалося прочитати послідовність з файлу «${file.name}»: ${err.message}.`);
    }
  }

  async function onSaveImage() {
    if (!state.preview) return;
    const format = el.imgFormat.value;
    try {
      const blob = await HR.imageExport.canvasToBlob(el.resultCanvas, format);
      const label = state.lastResult ? state.lastResult.result.label : 'preview';
      saveBlob(blob, `rhythm_${label}_${fileStamp()}.${FORMATS[format].ext}`, 'зображення', `${FORMATS[format].label}, ${el.resultCanvas.width}×${el.resultCanvas.height} px`);
    } catch (err) {
      log.error(`Не вдалося зберегти зображення: ${err.message}`);
    }
  }

  function onSaveResult() {
    const r = state.lastResult;
    const model = state.model;
    if (!r || !model) return;
    const unitText = r.units === 'ms' ? 'RR-інтервали, мс' : 'ЧСС, уд/хв';
    const t = model.training;
    const acc = model.evaluation ? model.evaluation.accuracy : t && t.testAccuracy;
    const lines = [
      'Результат розпізнавання серцевого ритму',
      '='.repeat(60),
      `Дата: ${formatDateTime(r.createdAt)}`,
      `Вхідна послідовність (${unitText}): ${r.values.join(', ')}`,
      `ЧСС, уд/хв: ${r.bpm.map((v) => fmtNum(v, 1)).join('; ')}`,
      `Кількість значень: ${r.values.length}; R-зубців: ${r.values.length + 1}`,
      '',
      `ПІДСУМОК: ${CLASS_NAMES[r.result.label]} — ${fmtPct(r.result.confidence)}`,
      `  ${CLASS_NAMES.normal}: ${fmtPct(r.result.probs[0])}`,
      `  ${CLASS_NAMES.arrhythmia}: ${fmtPct(r.result.probs[1])}`,
      '',
      `Вікна по K = ${model.windowSize} (зсув на 1 значення): ${r.result.windows.length}, з них аритмічних: ${r.result.arrhythmicWindows}`,
    ];
    r.result.windows.forEach((w, i) => {
      lines.push(`  ${String(i + 1).padStart(3)}. [${w.values.map((v) => fmtNum(v, 0)).join(', ')}]  норма ${fmtPct(w.probs[0]).padStart(8)}  аритмія ${fmtPct(w.probs[1]).padStart(8)}  → ${CLASS_NAMES[w.label]}`);
    });
    if (r.warnings.length) {
      lines.push('', 'Попередження:');
      r.warnings.forEach((w) => lines.push(`  - ${w.long}`));
    }
    lines.push('', 'Модель:',
      `  архітектура ${model.architecture}, активація — сигмоїда, ${model.parameterCount} ваг і зсувів`,
      `  нормування входів: ${model.encoding.min}–${model.encoding.max} уд/хв`);
    if (t) lines.push(`  навчання: виконано епох — ${t.epochsDone}, швидкість навчання ${fmtDec(t.learningRate)}, момент ${fmtDec(t.momentum)}, помилка ${fmtError(t.finalError)}`);
    if (Number.isFinite(acc)) lines.push(`  точність на тестовій вибірці: ${fmtPct(acc)}`);
    if (model.source === 'file') lines.push(`  джерело: файл ${model.fileName}`);
    const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8' });
    saveBlob(blob, `rhythm_result_${fileStamp()}.txt`, 'результат розпізнавання', 'TXT');
  }

  // ============================================================ ЖУРНАЛ

  function onSaveLog() {
    if (!log.entries.length) return;
    const name = `rhythm_log_${fileStamp()}.txt`;
    // запис про збереження додаємо до формування файлу, щоб він потрапив у журнал
    log.info(`Збереження журналу у файл ${name}…`);
    const blob = new Blob(['﻿' + log.toText()], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, name);
    state.lastSave = { name, size: blob.size, kind: 'журнал операцій', at: new Date(), extra: `${log.entries.length} записів` };
  }

  function onClearLog() {
    if (!log.entries.length) return;
    if (!window.confirm('Очистити журнал операцій? Незбережені записи буде втрачено.')) return;
    const count = log.entries.length;
    log.clear();
    log.info(`Журнал очищено (видалено записів: ${count}).`);
  }

  // ============================================================ ДІАЛОГ «ІНФОРМАЦІЯ»

  function kvList(pairs) {
    const dl = document.createElement('dl');
    dl.className = 'kv';
    for (const [k, v] of pairs) {
      if (v === null || v === undefined || v === '') continue;
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
    return dl;
  }

  function infoSection(id, title, content) {
    const sec = document.createElement('section');
    sec.className = 'info-section';
    sec.id = id;
    const h = document.createElement('h3');
    h.textContent = title;
    sec.appendChild(h);
    if (typeof content === 'string') {
      const p = document.createElement('p');
      p.className = 'info-empty';
      p.textContent = content;
      sec.appendChild(p);
    } else {
      sec.appendChild(content);
    }
    return sec;
  }

  function buildInfo() {
    const sections = [];
    const ds = state.dataset;
    if (ds) {
      const s = ds.stats;
      const p = ds.params;
      const pairs = [
        ['Джерело', ds.source === 'generated' ? 'згенеровано в застосунку' : `файл ${ds.fileName}`],
        ['Створено', formatDateTime(ds.createdAt)],
        ['Кількість послідовностей', `${fmtNum(s.total)} (норма ${fmtNum(s.byClass.normal.count)}, аритмія ${fmtNum(s.byClass.arrhythmia.count)})`],
        ['Навчальна / тестова вибірки', `${fmtNum(s.train)} / ${fmtNum(s.test)}`],
        ['Довжина послідовності K', String(ds.windowSize)],
        ['ЧСС у наборі', `${fmtNum(s.minBpm)}–${fmtNum(s.maxBpm)} уд/хв`],
        ['Норма: середня ЧСС / розкид', `${fmtNum(s.byClass.normal.meanBpm, 1)} / ${fmtNum(s.byClass.normal.meanSpread, 1)} уд/хв`],
        ['Аритмія: середня ЧСС / розкид', `${fmtNum(s.byClass.arrhythmia.meanBpm, 1)} / ${fmtNum(s.byClass.arrhythmia.meanSpread, 1)} уд/хв`],
      ];
      if (p) {
        pairs.push(['Параметри норми (4)', `ЧСС ${p.normMin}–${p.normMax} уд/хв, Tol(r) = ${p.tolerance}`]);
        pairs.push(['Параметри аритмії (5)', `ЧСС ${p.arrMin}–${p.arrMax} уд/хв, мін. розкид ${p.minSpread}`]);
      }
      if (ds.seed !== null && ds.seed !== undefined) pairs.push(['Зерно генератора (seed)', String(ds.seed)]);
      if (ds.rejected !== null && ds.rejected !== undefined) pairs.push(['Відкинуто кандидатів аритмії', fmtNum(ds.rejected)]);
      if (Number.isFinite(ds.computeMs)) pairs.push(['Час генерації', `${formatDuration(ds.computeMs)} (з відображенням прогресу ${formatDuration(ds.elapsedMs)})`]);
      sections.push(infoSection('infoData', 'Набір даних', kvList(pairs)));
    } else {
      sections.push(infoSection('infoData', 'Набір даних', 'Набір ще не згенеровано і не завантажено.'));
    }

    const m = state.model;
    if (m) {
      const t = m.training;
      const ev = m.evaluation;
      const pairs = [
        ['Джерело', m.source === 'file' ? `файл ${m.fileName}` : 'навчена в цьому сеансі'],
        ['Архітектура', `${m.architecture} (входи – приховані шари – виходи)`],
        ['Параметрів (ваг і зсувів)', fmtNum(m.parameterCount)],
        ['Активація', 'сигмоїда 1 / (1 + e^(−x))'],
        ['Нормування входів', `${m.encoding.min}–${m.encoding.max} уд/хв → [0; 1]`],
        ['Діапазон навчальних даних', m.trainRange ? `${fmtNum(m.trainRange.min)}–${fmtNum(m.trainRange.max)} уд/хв` : null],
      ];
      if (t) {
        pairs.push(['Епох виконано', `${fmtNum(t.epochsDone)} з ${fmtNum(t.epochsRequested)}`]);
        pairs.push(['Швидкість навчання / момент', `${fmtDec(t.learningRate)} / ${fmtDec(t.momentum)}`]);
        pairs.push(['Підсумкова помилка (MSE)', fmtError(t.finalError)]);
        pairs.push(['Час навчання', `${formatDuration(t.elapsedMs)} (обчислення ${formatDuration(t.computeMs)})`]);
        pairs.push(['Приклади: навчальні / тестові', `${fmtNum(t.trainSamples)} / ${fmtNum(t.testSamples)}`]);
      }
      if (ev) {
        pairs.push(['Точність на тесті', `${fmtPct(ev.accuracy)} (TP ${ev.tp}, TN ${ev.tn}, FP ${ev.fp}, FN ${ev.fn})`]);
        pairs.push(['Чутливість / специфічність', `${fmtPct(ev.recall)} / ${fmtPct(ev.specificity)}`]);
      }
      sections.push(infoSection('infoModel', 'Модель (нейронна мережа)', kvList(pairs)));
    } else {
      sections.push(infoSection('infoModel', 'Модель (нейронна мережа)', 'Модель ще не навчена і не завантажена.'));
    }

    if (state.preview) {
      const c = el.resultCanvas;
      const pairs = [
        ['Роздільна здатність', `${c.width} × ${c.height} px`],
        ['Кількість пікселів', `${fmtNum(c.width * c.height)} (${fmtNum((c.width * c.height) / 1e6, 2)} Мпікс)`],
        ['Співвідношення сторін', '7 : 4'],
        ['Відображається на екрані', `${Math.round(c.getBoundingClientRect().width)} × ${Math.round(c.getBoundingClientRect().height)} px (масштаб ${fmtNum((c.getBoundingClientRect().width / c.width) * 100, 0)} %)`],
        ['Вміст', `послідовність: ${valueCount(state.preview.values.length)} (${state.preview.units === 'ms' ? 'RR, мс' : 'ЧСС, уд/хв'}), ${state.lastResult ? 'з результатом класифікації' : 'без класифікації'}`],
        ['Формати збереження', 'PNG (без втрат), JPG (якість 92 %), BMP (24 біти, без стиснення)'],
        ['Розмір файлу PNG', 'обчислюється…'],
        ['Розмір файлу JPG', 'обчислюється…'],
        ['Розмір файлу BMP', formatBytes(HR.imageExport.bmpSize(c.width, c.height))],
      ];
      const dl = kvList(pairs);
      sections.push(infoSection('infoImage', 'Зображення результату', dl));
      // реальні розміри PNG/JPG — кодуванням у пам'яті
      const dds = dl.querySelectorAll('dd');
      Promise.all([HR.imageExport.canvasToBlob(c, 'png'), HR.imageExport.canvasToBlob(c, 'jpg')]).then(([png, jpg]) => {
        dds[6].textContent = formatBytes(png.size);
        dds[7].textContent = formatBytes(jpg.size);
      }).catch(() => {
        dds[6].textContent = '—';
        dds[7].textContent = '—';
      });
    } else {
      sections.push(infoSection('infoImage', 'Зображення результату', 'Зображення з\'явиться після введення послідовності на кроці 3.'));
    }

    const f = state.lastFile;
    if (f) {
      sections.push(infoSection('infoFile', 'Останній завантажений файл', kvList([
        ['Ім\'я файлу', f.name],
        ['Розширення', f.ext ? `.${f.ext}` : '—'],
        ['Розмір', `${formatBytes(f.size)} (${fmtNum(f.size)} Б)`],
        ['Тип (MIME)', f.type],
        ['Змінено', f.lastModified ? formatDateTime(f.lastModified) : '—'],
        ['Призначення', f.purpose],
        ['Вміст', f.details],
        ['Завантажено', formatDateTime(f.loadedAt)],
      ])));
    } else {
      sections.push(infoSection('infoFile', 'Останній завантажений файл', 'Файли ще не завантажувалися (набір даних, модель або послідовність).'));
    }

    const sv = state.lastSave;
    if (sv) {
      sections.push(infoSection('infoSave', 'Останній збережений файл', kvList([
        ['Ім\'я файлу', sv.name],
        ['Що збережено', sv.kind],
        ['Розмір', formatBytes(sv.size)],
        ['Подробиці', sv.extra],
        ['Час', formatDateTime(sv.at)],
      ])));
    }

    sections.push(infoSection('infoEnv', 'Середовище', kvList([
      ['Бібліотека', state.brainLoaded ? `brain.js ${BRAIN_VERSION} (lib/brain-browser.js)` : 'brain.js не завантажено'],
      ['Браузер', navigator.userAgent],
      ['Щільність пікселів екрана', String(window.devicePixelRatio || 1)],
      ['Записів у журналі', fmtNum(log.entries.length)],
    ])));
    el.infoBody.replaceChildren(...sections);
  }

  function openInfo(sectionId) {
    buildInfo();
    el.dlgInfo.showModal();
    if (sectionId) {
      const sec = document.getElementById(sectionId);
      if (sec) {
        sec.scrollIntoView({ block: 'start' });
        sec.classList.remove('flash');
        void sec.offsetWidth;
        sec.classList.add('flash');
      }
    } else {
      el.infoBody.scrollTop = 0;
    }
  }

  // ============================================================ ПОДІЇ

  function bindEvents() {
    el.formData.addEventListener('submit', onGenerate);
    el.btnSaveData.addEventListener('click', onSaveData);
    el.fileData.addEventListener('change', onLoadData);

    el.formTrain.addEventListener('submit', onTrain);
    el.btnStop.addEventListener('click', onStop);
    el.btnEvaluate.addEventListener('click', onEvaluate);
    el.btnSaveModel.addEventListener('click', onSaveModel);
    el.fileModel.addEventListener('change', onLoadModel);
    el.btnSaveCharts.addEventListener('click', onSaveCharts);
    el.earlyStop.addEventListener('change', () => {
      el.errThresh.disabled = !el.earlyStop.checked;
    });

    el.formRecognize.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (state.busy === 'train') return;
      recognizePreview(true);
    });
    let previewTimer = null;
    el.seqInput.addEventListener('input', () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => updatePreview({ quiet: true }), 300);
    });
    $$('input[name="units"]').forEach((radio) => radio.addEventListener('change', () => {
      log.info(`Одиниці введення: ${currentUnits() === 'ms' ? 'RR-інтервали, мс' : 'ЧСС, уд/хв'}.`);
      updatePreview({ quiet: false });
    }));
    $('.chips').addEventListener('click', onExampleClick);
    el.fileSeq.addEventListener('change', onLoadSequence);
    el.btnSaveImage.addEventListener('click', onSaveImage);
    el.btnSaveResult.addEventListener('click', onSaveResult);

    el.btnSaveLog.addEventListener('click', onSaveLog);
    el.btnClearLog.addEventListener('click', onClearLog);

    el.btnInfo.addEventListener('click', () => openInfo(null));
    el.btnDataInfo.addEventListener('click', () => openInfo('infoData'));
    el.btnModelInfo.addEventListener('click', () => openInfo('infoModel'));
    el.btnImageInfo.addEventListener('click', () => openInfo('infoImage'));
    el.btnHelp.addEventListener('click', () => el.dlgHelp.showModal());

    // клік по затемненому фону закриває діалог
    for (const dlg of [el.dlgInfo, el.dlgHelp]) {
      dlg.addEventListener('click', (ev) => {
        if (ev.target === dlg) dlg.close();
      });
    }

    window.addEventListener('error', (ev) => {
      log.error(`Неочікувана помилка: ${ev.message}`);
    });
    window.addEventListener('unhandledrejection', (ev) => {
      log.error(`Неочікувана помилка: ${ev.reason && ev.reason.message ? ev.reason.message : ev.reason}`);
    });
  }

  function init() {
    bindEvents();
    if (state.brainLoaded) {
      log.info(`Застосунок запущено. Бібліотеку brain.js ${BRAIN_VERSION} завантажено.`);
    } else {
      el.libError.hidden = false;
      log.error('Не вдалося завантажити бібліотеку brain.js (lib/brain-browser.js): навчання і розпізнавання недоступні.');
    }
    log.info('Порядок роботи: 1) згенеруйте дані → 2) навчіть мережу → 3) розпізнайте послідовність. Довідка — кнопка «Довідка» вгорі.');
    updateControls();
  }

  init();

  // доступ до стану з консолі браузера (для налагодження і тестів)
  HR.app = { state, log, el };
})(window.HR = window.HR || {});
