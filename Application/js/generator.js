/* Генерація послідовностей серцевого ритму (нормальний ритм / аритмія)
   за формулами (4) і (5) зі статті «Генерування ритмів», розбиття на
   навчальну/тестову вибірки, імпорт та експорт набору даних. */
(function (HR) {
  'use strict';

  const { spread, mean, bpmToMs, msToBpm, nextFrame, fileExtension, countOf } = HR.util;

  const CLASSES = ['normal', 'arrhythmia'];
  const CLASS_NAMES = { normal: 'Нормальний ритм', arrhythmia: 'Аритмія' };

  // Приклади зі статті (дані в уд/хв)
  const ARTICLE_EXAMPLES = {
    normal: { name: 'Нормальний ритм (стаття)', values: [72, 68, 75, 71, 69, 73, 70, 68, 74] },
    irregular: { name: 'Аритмія (стаття)', values: [74, 57, 62, 103, 66, 75, 57, 87, 113, 91] },
    brady: { name: 'Брадикардія (стаття)', values: [50, 49, 49, 51, 51] },
    tachy: { name: 'Тахікардія (стаття)', values: [95, 100, 104, 104, 102, 104, 104, 101, 96] },
  };

  const MAX_ATTEMPTS = 1000;
  const BPM_LIMITS = { min: 20, max: 300 };

  // ------------------------------------------------------------ Перевірка

  // Повертає помилки (з назвами полів, які треба підсвітити) і попередження
  function validateParams(p) {
    const errors = [];
    const warnings = [];
    const isInt = (v) => Number.isInteger(v);
    const fail = (fields, text) => errors.push({ fields, text });

    if (!isInt(p.perClass) || p.perClass < 10 || p.perClass > 5000) {
      fail(['perClass'], 'Кількість послідовностей кожного класу — ціле число від 10 до 5000.');
    } else if (p.perClass * 2 < 250) {
      warnings.push({ text: `Усього ${countOf(p.perClass * 2, 'зразок', 'зразки', 'зразків')} — менше 250, результати навчання можуть бути нерепрезентативними.` });
    }
    if (!isInt(p.length) || p.length < 3 || p.length > 12) {
      fail(['seqLen'], 'Довжина послідовності K — ціле число від 3 до 12.');
    }
    if (!Number.isFinite(p.testPct) || p.testPct < 5 || p.testPct > 50) {
      fail(['testPct'], 'Частка тестової вибірки — від 5 до 50 %.');
    }
    if (![p.normMin, p.normMax].every(isInt) || p.normMin < 30 || p.normMax > 200) {
      fail(['normMin', 'normMax'], 'Межі ЧСС нормального ритму — цілі числа від 30 до 200 уд/хв.');
    } else if (p.normMin >= p.normMax) {
      fail(['normMin', 'normMax'], 'Для нормального ритму мінімальна ЧСС має бути меншою за максимальну.');
    }
    if (!isInt(p.tolerance) || p.tolerance < 0 || p.tolerance > 30) {
      fail(['tol'], 'Допуск Tol(r) — ціле число від 0 до 30 уд/хв.');
    }
    if (![p.arrMin, p.arrMax].every(isInt) || p.arrMin < 30 || p.arrMax > 220) {
      fail(['arrMin', 'arrMax'], 'Межі ЧСС аритмії — цілі числа від 30 до 220 уд/хв.');
    } else if (p.arrMin >= p.arrMax) {
      fail(['arrMin', 'arrMax'], 'Для аритмії мінімальна ЧСС має бути меншою за максимальну.');
    }
    if (!isInt(p.minSpread) || p.minSpread < 1 || p.minSpread > 100) {
      fail(['minSpread'], 'Мінімальний розкид аритмії — ціле число від 1 до 100 уд/хв.');
    } else if (isInt(p.arrMin) && isInt(p.arrMax) && p.arrMax - p.arrMin < p.minSpread + 5) {
      fail(['arrMin', 'arrMax', 'minSpread'], `Діапазон ЧСС аритмії (${p.arrMin}–${p.arrMax}) занадто вузький для мінімального розкиду ${p.minSpread} уд/хв.`);
    }
    if (isInt(p.minSpread) && isInt(p.tolerance) && p.minSpread <= p.tolerance) {
      warnings.push({ text: `Мінімальний розкид аритмії (${p.minSpread}) не більший за допуск норми (${p.tolerance}): класи перекриваються, точність буде нижчою.` });
    }
    if (p.seed !== null && (!isInt(p.seed) || p.seed < 0 || p.seed > HR.MAX_SEED)) {
      fail(['seed'], `Зерно генератора — ціле число від 0 до ${HR.MAX_SEED} або порожнє поле.`);
    }
    return { errors, warnings };
  }

  // ------------------------------------------------------------ Генерація

  // Формула (4): Tmax(necg(i)) = random(60…100), Tmin(necg(i)) = Tmax − random(Tol(r)).
  // Кожен наступний інтервал випадково дорівнює Tmax або Tmin.
  function normalSequence(rng, p, length = p.length) {
    const hrMax = rng.int(p.normMin, p.normMax);
    const hrMin = hrMax - rng.int(0, p.tolerance);
    const bpm = [];
    for (let i = 0; i < length; i++) {
      bpm.push(rng.next() < 0.5 ? hrMax : hrMin);
    }
    return bpm;
  }

  // Формула (5): Tcurrent = Tmin + random · (Tmax − Tmin), інтервали в мс.
  // Tmin відповідає максимальній ЧСС, Tmax — мінімальній.
  function arrhythmiaValue(rng, p) {
    const tMin = bpmToMs(p.arrMax);
    const tMax = bpmToMs(p.arrMin);
    const tCurrent = tMin + rng.next() * (tMax - tMin);
    return Math.round(msToBpm(tCurrent));
  }

  // Послідовність аритмії з перевіркою: розкид має бути не меншим за minSpread,
  // інакше вона випадково виглядає як норма і відкидається.
  function arrhythmiaSequence(rng, p) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const bpm = [];
      for (let i = 0; i < p.length; i++) bpm.push(arrhythmiaValue(rng, p));
      if (spread(bpm) >= p.minSpread) return { bpm, rejected: attempt - 1 };
    }
    throw new Error(`Не вдалося згенерувати аритмію з розкидом ≥ ${p.minSpread} уд/хв за ${MAX_ATTEMPTS} спроб. Розширте діапазон ЧСС аритмії або зменште мінімальний розкид.`);
  }

  // Довша випадкова послідовність для розпізнавання: для аритмії кожне
  // вікно з K значень має бути нерегулярним.
  function exampleSeries(rng, p, label, count, windowSize) {
    if (label === 'normal') return normalSequence(rng, p, count);
    const values = [];
    for (let i = 0; i < count; i++) {
      let v = arrhythmiaValue(rng, p);
      if (i >= windowSize - 1) {
        const prev = values.slice(i - windowSize + 1);
        for (let tries = 0; tries < 200 && spread(prev.concat(v)) < p.minSpread; tries++) {
          v = arrhythmiaValue(rng, p);
        }
      }
      values.push(v);
    }
    return values;
  }

  function makeSample(id, label, bpm, split = null) {
    return { id, label, bpm, split, mean: mean(bpm), spread: spread(bpm) };
  }

  // Стратифіковане розбиття: в обох вибірках однакова частка кожного класу
  function stratifiedSplit(samples, testFraction, rng) {
    for (const label of CLASSES) {
      const ofClass = rng.shuffle(samples.filter((s) => s.label === label));
      const testCount = Math.round(ofClass.length * testFraction);
      ofClass.forEach((s, i) => { s.split = i < testCount ? 'test' : 'train'; });
    }
  }

  function computeStats(samples) {
    const byClass = {};
    for (const label of CLASSES) {
      const ofClass = samples.filter((s) => s.label === label);
      const values = ofClass.flatMap((s) => s.bpm);
      byClass[label] = {
        count: ofClass.length,
        train: ofClass.filter((s) => s.split === 'train').length,
        test: ofClass.filter((s) => s.split === 'test').length,
        meanBpm: mean(values),
        meanSpread: mean(ofClass.map((s) => s.spread)),
        minBpm: values.length ? Math.min(...values) : NaN,
        maxBpm: values.length ? Math.max(...values) : NaN,
      };
    }
    const all = samples.flatMap((s) => s.bpm);
    return {
      total: samples.length,
      train: samples.filter((s) => s.split === 'train').length,
      test: samples.filter((s) => s.split === 'test').length,
      minBpm: Math.min(...all),
      maxBpm: Math.max(...all),
      byClass,
    };
  }

  function assembleDataset(samples, extra, rng) {
    const train = rng.shuffle(samples.filter((s) => s.split === 'train'));
    const test = rng.shuffle(samples.filter((s) => s.split === 'test'));
    return {
      createdAt: new Date(),
      windowSize: samples[0].bpm.length,
      samples,
      train,
      test,
      stats: computeStats(samples),
      ...extra,
    };
  }

  // Генерує набір покроково: після кожних ~2 % зразків оновлює прогрес-бар
  async function buildDataset(params, { onProgress } = {}) {
    const seed = params.seed === null ? HR.randomSeed() : params.seed;
    const rng = new HR.Random(seed);
    const total = params.perClass * 2;
    const step = Math.max(1, Math.ceil(total / 50));
    const samples = [];
    let rejected = 0;
    let computeMs = 0;
    const started = performance.now();
    let chunkStart = performance.now();

    for (let i = 0; i < total; i++) {
      // класи чергуються, тому прогрес рівномірно охоплює обидва
      const label = i % 2 === 0 ? 'normal' : 'arrhythmia';
      let bpm;
      if (label === 'normal') {
        bpm = normalSequence(rng, params);
      } else {
        const result = arrhythmiaSequence(rng, params);
        bpm = result.bpm;
        rejected += result.rejected;
      }
      samples.push(makeSample(i + 1, label, bpm));

      if ((i + 1) % step === 0 || i + 1 === total) {
        computeMs += performance.now() - chunkStart;
        if (onProgress) onProgress(i + 1, total);
        await nextFrame();
        chunkStart = performance.now();
      }
    }

    stratifiedSplit(samples, params.testPct / 100, rng);
    return assembleDataset(samples, {
      source: 'generated',
      params: { ...params, seed },
      seed,
      rejected,
      computeMs,
      elapsedMs: performance.now() - started,
    }, rng);
  }

  // ------------------------------------------------------------ Експорт

  function datasetToCsv(ds) {
    const k = ds.windowSize;
    const header = ['id', 'label', 'split'];
    for (let i = 1; i <= k; i++) header.push(`bpm_${i}`);
    const lines = [header.join(',')];
    for (const s of ds.samples) {
      lines.push([s.id, s.label, s.split, ...s.bpm].join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }

  function datasetToJson(ds) {
    return JSON.stringify({
      format: 'hr-rhythm-dataset',
      version: 1,
      createdAt: ds.createdAt.toISOString(),
      units: 'bpm',
      windowSize: ds.windowSize,
      seed: ds.seed ?? null,
      params: ds.params ?? null,
      classes: CLASSES,
      samples: ds.samples.map((s) => ({ id: s.id, label: s.label, split: s.split, bpm: s.bpm })),
    }, null, 1);
  }

  // ------------------------------------------------------------ Імпорт

  const LABEL_ALIASES = {
    normal: 'normal', norm: 'normal', n: 'normal', 'норма': 'normal', 'нормальний': 'normal', 'нормальний ритм': 'normal', '0': 'normal',
    arrhythmia: 'arrhythmia', arrhythmic: 'arrhythmia', irregular: 'arrhythmia', arr: 'arrhythmia', a: 'arrhythmia', 'аритмія': 'arrhythmia', '1': 'arrhythmia',
  };
  const SPLIT_ALIASES = { train: 'train', training: 'train', 'навчальна': 'train', test: 'test', testing: 'test', 'тестова': 'test' };

  const normalizeLabel = (v) => LABEL_ALIASES[String(v).trim().toLowerCase()] || null;
  const normalizeSplit = (v) => SPLIT_ALIASES[String(v).trim().toLowerCase()] || null;

  function parseCsvRows(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/)
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      .filter((l) => l.line && !l.line.startsWith('#'));
    if (!lines.length) throw new Error('Файл порожній.');
    const first = lines[0].line;
    const delimiter = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
    const rows = lines.map((l) => ({ no: l.no, cells: l.line.split(delimiter).map((c) => c.trim().replace(/^"(.*)"$/, '$1')) }));
    const hasHeader = rows[0].cells.every((c) => c === '' || !Number.isFinite(Number(c)));
    const header = hasHeader ? rows.shift().cells.map((h) => h.toLowerCase()) : null;

    let labelCol = -1;
    let splitCol = -1;
    let idCol = -1;
    if (header) {
      labelCol = header.findIndex((h) => /^(label|class|клас|мітка|type|тип)$/.test(h));
      splitCol = header.findIndex((h) => /^(split|set|subset|вибірка)$/.test(h));
      idCol = header.findIndex((h) => /^(id|№|n)$/.test(h));
    } else if (rows.length) {
      labelCol = rows[0].cells.findIndex((c) => !Number.isFinite(Number(c)) && normalizeLabel(c));
      splitCol = rows[0].cells.findIndex((c) => normalizeSplit(c));
    }
    if (labelCol < 0) throw new Error('Не знайдено стовпця з класом (label: normal / arrhythmia).');

    return rows.map((r) => ({
      no: r.no,
      label: r.cells[labelCol],
      split: splitCol >= 0 ? r.cells[splitCol] : null,
      values: r.cells.filter((c, i) => i !== labelCol && i !== splitCol && i !== idCol && c !== ''),
    }));
  }

  function parseJsonRows(text) {
    let data;
    try {
      data = JSON.parse(text.replace(/^﻿/, ''));
    } catch (err) {
      throw new Error(`Некоректний JSON: ${err.message}`);
    }
    const list = Array.isArray(data) ? data : data && Array.isArray(data.samples) ? data.samples : null;
    if (!list) throw new Error('JSON має містити масив samples з об’єктами { label, bpm }.');
    return {
      meta: Array.isArray(data) ? null : data,
      rows: list.map((s, i) => ({
        no: i + 1,
        label: s.label ?? s.class,
        split: s.split ?? null,
        values: s.bpm ?? s.values ?? s.sequence ?? [],
      })),
    };
  }

  // Перетворює рядки файлу на набір даних; кидає помилку з номерами рядків
  function parseDatasetFile(text, fileName, testFraction) {
    const isJson = fileExtension(fileName) === 'json' || /^\s*[[{]/.test(text);
    let rows;
    let meta = null;
    if (isJson) {
      ({ rows, meta } = parseJsonRows(text));
    } else {
      rows = parseCsvRows(text);
    }
    if (!rows.length) throw new Error('У файлі немає жодного зразка.');

    const problems = [];
    const samples = [];
    let k = null;
    let hasSplit = rows.every((r) => r.split !== null && r.split !== undefined && r.split !== '');
    for (const r of rows) {
      const label = normalizeLabel(r.label);
      const values = (Array.isArray(r.values) ? r.values : []).map(Number);
      const where = isJson ? `зразок ${r.no}` : `рядок ${r.no}`;
      if (!label) { problems.push(`${where}: невідомий клас «${r.label}»`); continue; }
      if (!values.length || values.some((v) => !Number.isFinite(v))) { problems.push(`${where}: значення мають бути числами`); continue; }
      if (values.some((v) => v < BPM_LIMITS.min || v > BPM_LIMITS.max)) { problems.push(`${where}: ЧСС поза межами ${BPM_LIMITS.min}–${BPM_LIMITS.max} уд/хв`); continue; }
      if (k === null) k = values.length;
      if (values.length !== k) { problems.push(`${where}: ${countOf(values.length, 'значення', 'значення', 'значень')} замість ${k}`); continue; }
      const split = hasSplit ? normalizeSplit(r.split) : null;
      if (hasSplit && !split) hasSplit = false;
      samples.push(makeSample(samples.length + 1, label, values, split));
    }
    if (problems.length) {
      const shown = problems.slice(0, 5).join('; ');
      throw new Error(`Знайдено помилок: ${problems.length}. ${shown}${problems.length > 5 ? '; …' : ''}`);
    }
    if (k < 3 || k > 30) throw new Error(`Довжина послідовностей ${k} не підтримується (потрібно від 3 до 30).`);
    for (const label of CLASSES) {
      if (samples.filter((s) => s.label === label).length < 5) {
        throw new Error(`Замало зразків класу «${CLASS_NAMES[label]}» (потрібно щонайменше 5).`);
      }
    }

    const rng = new HR.Random();
    if (!hasSplit) stratifiedSplit(samples, testFraction, rng);
    if (!samples.some((s) => s.split === 'test')) stratifiedSplit(samples, testFraction, rng);

    return assembleDataset(samples, {
      source: 'file',
      params: meta && meta.params ? meta.params : null,
      seed: meta && Number.isInteger(meta.seed) ? meta.seed : null,
      rejected: null,
      splitFromFile: hasSplit,
    }, rng);
  }

  HR.data = {
    CLASSES, CLASS_NAMES, ARTICLE_EXAMPLES, BPM_LIMITS,
    validateParams, normalSequence, arrhythmiaSequence, exampleSeries,
    buildDataset, datasetToCsv, datasetToJson, parseDatasetFile, computeStats,
  };
})(window.HR = window.HR || {});
