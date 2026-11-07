/* Спільні допоміжні функції і тестові дані (fixtures) для модульних та
   інтеграційних тестів. */
(function () {
  'use strict';

  // Типові параметри генерації - ті самі, що в полях кроку 1 застосунку
  const DEFAULT_PARAMS = Object.freeze({
    perClass: 500, length: 4, testPct: 20,
    normMin: 60, normMax: 100, tolerance: 8,
    arrMin: 50, arrMax: 120, minSpread: 15,
    seed: 42,
  });

  const params = (overrides = {}) => ({ ...DEFAULT_PARAMS, ...overrides });

  // Набір даних без очікування кадрів (onProgress не потрібен)
  const datasetCache = new Map();
  async function dataset(overrides = {}) {
    const key = JSON.stringify(params(overrides));
    if (!datasetCache.has(key)) datasetCache.set(key, await HR.data.buildDataset(params(overrides)));
    return datasetCache.get(key);
  }

  // brain.js ініціалізує ваги через Math.random, тож навіть з тим самим набором
  // точність різних навчань різна (див. тест стабільності). Тестам, яким потрібна
  // конкретна навчена модель, Math.random на час навчання підміняється
  // генератором із фіксованим зерном - результат відтворюваний.
  async function withSeededRandom(seed, fn) {
    const original = Math.random;
    const rng = new HR.Random(seed);
    Math.random = () => rng.next();
    try {
      return await fn();
    } finally {
      Math.random = original;
    }
  }

  // Навчання моделі K–H–2 на навчальній вибірці набору
  async function train(ds, { epochs = 1000, hidden = [8], shuffleSeed = 7, weightSeed = 2026 } = {}) {
    const { encoding, trainRange } = HR.RhythmModel.encodingFor(ds.train);
    const model = new HR.RhythmModel({ windowSize: ds.windowSize, hiddenLayers: hidden, encoding, trainRange });
    const run = () => model.train(ds.train, ds.test, { epochs, learningRate: 0.3, momentum: 0.1, shuffleSeed });
    if (weightSeed === null) await run();
    else await withSeededRandom(weightSeed, run);
    return model;
  }

  // Модель, навчена на наборі з типовими параметрами; навчається один раз на всі тести
  let trainedPromise = null;
  function trainedModel() {
    if (!trainedPromise) {
      trainedPromise = (async () => {
        const ds = await dataset();
        const model = await train(ds);
        await model.evaluate(ds.test);
        return { ds, model };
      })();
    }
    return trainedPromise;
  }

  // Рядки CSV -> текст файлу (CRLF, як у Windows)
  const csv = (...lines) => lines.join('\r\n') + '\r\n';

  // Мінімальний коректний CSV: по n зразків кожного класу
  function validCsvLines(n = 5, k = 4) {
    const lines = ['label,' + Array.from({ length: k }, (_, i) => `bpm_${i + 1}`).join(',')];
    for (let i = 0; i < n; i++) {
      lines.push('normal,' + Array.from({ length: k }, (_, j) => (j % 2 ? 72 : 70)).join(','));
      lines.push('arrhythmia,' + Array.from({ length: k }, (_, j) => [60, 95, 70, 110][j % 4]).join(','));
    }
    return lines;
  }

  // Перевірка, що функція кидає помилку з текстом, який містить фрагмент
  function expectThrows(fn, fragment) {
    let error = null;
    try { fn(); } catch (err) { error = err; }
    expect(error, 'очікувалася помилка').to.be.an('error');
    if (fragment) expect(error.message).to.include(fragment);
    return error;
  }

  async function expectRejects(promise, fragment) {
    let error = null;
    try { await promise; } catch (err) { error = err; }
    expect(error, 'очікувалася помилка').to.be.an('error');
    if (fragment) expect(error.message).to.include(fragment);
    return error;
  }

  // Blob -> масив байтів
  async function bytesOf(blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  // Колір пікселя полотна [r, g, b, a]
  function pixel(canvas, x, y) {
    return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
  }

  // '#rrggbb' -> [r, g, b]
  function hexRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  // Частка не білих пікселів у прямокутнику
  function inkShare(canvas, x, y, w, h) {
    const { data } = canvas.getContext('2d').getImageData(x, y, w, h);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) ink++;
    }
    return ink / (w * h);
  }

  // Завантаження Blob як зображення (перевірка, що браузер його декодує)
  function decodeImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('зображення не декодується')); };
      img.src = url;
    });
  }

  // Фактичні значення (точність тощо), які тести записують для звіту
  const facts = {};
  const fact = (key, value) => { facts[key] = value; };

  window.T = {
    DEFAULT_PARAMS, params, dataset, train, trainedModel, withSeededRandom, csv, validCsvLines,
    expectThrows, expectRejects, bytesOf, pixel, hexRgb, inkShare, decodeImage,
    facts, fact,
  };
})();
