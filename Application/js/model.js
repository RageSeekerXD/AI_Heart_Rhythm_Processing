/* Нейронна мережа для класифікації ритму — обгортка над brain.NeuralNetwork.
   Вхід: K значень ЧСС, нормованих у [0; 1]. Вихід: 2 нейрони (норма, аритмія). */
(function (HR) {
  'use strict';

  const { clamp, mean, argmax, nextFrame, countOf } = HR.util;
  const { CLASSES } = HR.data;

  const MODEL_FORMAT = 'hr-rhythm-model';

  class RhythmModel {
    constructor({ windowSize, hiddenLayers, encoding, trainRange = null }) {
      this.windowSize = windowSize;
      this.hiddenLayers = hiddenLayers.slice();
      this.encoding = { min: encoding.min, max: encoding.max };
      this.trainRange = trainRange ? { min: trainRange.min, max: trainRange.max } : null;
      this.classes = CLASSES.slice();
      this.net = new brain.NeuralNetwork({ hiddenLayers: this.hiddenLayers, activation: 'sigmoid' });
      this.training = null;    // підсумок навчання
      this.history = null;     // помилка та точність за епохами
      this.evaluation = null;  // результат перевірки на тестовій вибірці
      this.source = 'trained'; // 'trained' або 'file'
      this.fileName = null;
    }

    // Межі нормування беруться з навчальних даних із запасом 10 уд/хв
    static encodingFor(samples) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const s of samples) {
        for (const v of s.bpm) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      return {
        encoding: { min: Math.floor((lo - 10) / 10) * 10, max: Math.ceil((hi + 10) / 10) * 10 },
        trainRange: { min: lo, max: hi },
      };
    }

    get sizes() {
      return [this.windowSize, ...this.hiddenLayers, this.classes.length];
    }

    get architecture() {
      return this.sizes.join('–');
    }

    // Кількість ваг і зсувів мережі
    get parameterCount() {
      const s = this.sizes;
      let n = 0;
      for (let i = 1; i < s.length; i++) n += s[i] * (s[i - 1] + 1);
      return n;
    }

    // Мін-макс нормування: x = (ЧСС − min) / (max − min)
    encode(bpm) {
      const { min, max } = this.encoding;
      return bpm.map((v) => clamp((v - min) / (max - min), 0, 1));
    }

    // Унітарне кодування класу: норма → [1, 0], аритмія → [0, 1]
    target(label) {
      return this.classes.map((c) => (c === label ? 1 : 0));
    }

    // Класифікація одного вікна з K значень
    predictWindow(bpm) {
      const raw = Array.from(this.net.run(this.encode(bpm)));
      const total = raw.reduce((acc, v) => acc + v, 0);
      const probs = total > 0 ? raw.map((v) => v / total) : raw.map(() => 1 / raw.length);
      const index = argmax(probs);
      return { raw, probs, index, label: this.classes[index], confidence: probs[index] };
    }

    // Довша послідовність: ковзне вікно з кроком 1, ймовірності усереднюються
    predictSeries(bpm) {
      const k = this.windowSize;
      if (bpm.length < k) {
        throw new Error(`Потрібно щонайменше ${countOf(k, 'значення', 'значення', 'значень')} — стільки входів має мережа.`);
      }
      const windows = [];
      for (let start = 0; start + k <= bpm.length; start++) {
        const values = bpm.slice(start, start + k);
        windows.push({ start, values, ...this.predictWindow(values) });
      }
      const probs = this.classes.map((_, c) => mean(windows.map((w) => w.probs[c])));
      const index = argmax(probs);
      return {
        windows,
        probs,
        index,
        label: this.classes[index],
        confidence: probs[index],
        arrhythmicWindows: windows.filter((w) => w.label === 'arrhythmia').length,
      };
    }

    accuracy(samples) {
      if (!samples.length) return NaN;
      let correct = 0;
      for (const s of samples) {
        if (this.predictWindow(s.bpm).label === s.label) correct++;
      }
      return correct / samples.length;
    }

    // Навчання по одній епосі за виклик net.train(), щоб після кожної епохи
    // оновлювати прогрес-бар і графіки та мати змогу зупинити навчання.
    async train(trainSet, testSet, options, hooks = {}) {
      const { epochs, learningRate, momentum, errorThresh = 0 } = options;
      const rng = new HR.Random(options.shuffleSeed);
      const data = trainSet.map((s) => ({ input: this.encode(s.bpm), output: this.target(s.label) }));
      // errorThresh тут — лише формальність: brain.js вимагає значення в (0; 1),
      // а рання зупинка реалізована нижче власною перевіркою
      const brainOptions = { iterations: 1, learningRate, momentum, errorThresh: 1e-12, log: false, activation: 'sigmoid' };
      const evalEvery = Math.max(1, Math.round(epochs / 100));
      const history = { epoch: [], error: [], evalEpoch: [], trainAcc: [], testAcc: [] };

      const started = performance.now();
      let computeMs = 0;
      let sliceStart = performance.now();
      let epoch = 0;
      let error = NaN;
      let stopReason = 'completed';

      const recordAccuracy = () => {
        history.evalEpoch.push(epoch);
        history.trainAcc.push(this.accuracy(trainSet));
        history.testAcc.push(testSet.length ? this.accuracy(testSet) : NaN);
      };

      while (epoch < epochs) {
        rng.shuffle(data); // нове перемішування перед кожною епохою
        error = this.net.train(data, brainOptions).error;
        epoch++;
        history.epoch.push(epoch);
        history.error.push(error);
        if (epoch === 1 || epoch % evalEvery === 0 || epoch === epochs) recordAccuracy();
        if (hooks.onEpoch) hooks.onEpoch(epoch, error, history);

        if (errorThresh > 0 && error <= errorThresh) {
          stopReason = 'threshold';
          break;
        }
        if (hooks.shouldStop && hooks.shouldStop()) {
          stopReason = 'stopped';
          break;
        }
        // приблизно раз на кадр віддаємо керування браузеру
        if (performance.now() - sliceStart >= 16) {
          computeMs += performance.now() - sliceStart;
          if (hooks.onFrame) hooks.onFrame({ epoch, epochs, error, history });
          await nextFrame();
          sliceStart = performance.now();
        }
      }
      computeMs += performance.now() - sliceStart;
      if (history.evalEpoch[history.evalEpoch.length - 1] !== epoch) recordAccuracy();
      if (hooks.onFrame) hooks.onFrame({ epoch, epochs, error, history });

      this.history = history;
      this.training = {
        epochsRequested: epochs,
        epochsDone: epoch,
        learningRate,
        momentum,
        errorThresh,
        finalError: error,
        stopReason,
        trainAccuracy: history.trainAcc[history.trainAcc.length - 1],
        testAccuracy: history.testAcc[history.testAcc.length - 1],
        trainSamples: trainSet.length,
        testSamples: testSet.length,
        computeMs,
        elapsedMs: performance.now() - started,
        finishedAt: new Date().toISOString(),
      };
      return this.training;
    }

    // Перевірка на тестовій вибірці; позитивний клас — аритмія
    async evaluate(samples, hooks = {}) {
      if (!samples.length) throw new Error('Тестова вибірка порожня.');
      if (samples[0].bpm.length !== this.windowSize) {
        throw new Error(`Довжина послідовностей набору (${samples[0].bpm.length}) не збігається з кількістю входів мережі (${this.windowSize}).`);
      }
      const cm = { tp: 0, tn: 0, fp: 0, fn: 0 };
      const misclassified = [];
      let crossEntropy = 0;
      const step = Math.max(1, Math.ceil(samples.length / 40));
      const started = performance.now();

      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const p = this.predictWindow(s.bpm);
        const actual = s.label === 'arrhythmia';
        const predicted = p.label === 'arrhythmia';
        if (actual && predicted) cm.tp++;
        else if (!actual && !predicted) cm.tn++;
        else if (predicted) cm.fp++;
        else cm.fn++;
        if (p.label !== s.label) misclassified.push({ sample: s, prediction: p });
        crossEntropy -= Math.log(Math.max(1e-12, p.probs[this.classes.indexOf(s.label)]));

        if ((i + 1) % step === 0 || i + 1 === samples.length) {
          if (hooks.onProgress) hooks.onProgress(i + 1, samples.length);
          await nextFrame();
        }
      }

      const n = samples.length;
      const precision = cm.tp + cm.fp ? cm.tp / (cm.tp + cm.fp) : NaN;
      const recall = cm.tp + cm.fn ? cm.tp / (cm.tp + cm.fn) : NaN;
      const specificity = cm.tn + cm.fp ? cm.tn / (cm.tn + cm.fp) : NaN;
      const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : NaN;
      this.evaluation = {
        total: n,
        ...cm,
        accuracy: (cm.tp + cm.tn) / n, // (TP + TN) / (TP + TN + FP + FN)
        precision,
        recall,
        specificity,
        f1,
        crossEntropy: crossEntropy / n,
        misclassified,
        elapsedMs: performance.now() - started,
        at: new Date().toISOString(),
      };
      return this.evaluation;
    }

    toJSON() {
      let evaluation = null;
      if (this.evaluation) {
        const { misclassified, ...rest } = this.evaluation;
        evaluation = { ...rest, misclassifiedCount: misclassified ? misclassified.length : 0 };
      }
      return {
        format: MODEL_FORMAT,
        version: 1,
        savedAt: new Date().toISOString(),
        classes: this.classes,
        windowSize: this.windowSize,
        hiddenLayers: this.hiddenLayers,
        activation: 'sigmoid',
        encoding: this.encoding,
        trainRange: this.trainRange,
        training: this.training,
        evaluation,
        history: this.history,
        network: this.net.toJSON(),
      };
    }

    static fromJSON(json, fileName = null) {
      if (!json || json.format !== MODEL_FORMAT) {
        throw new Error('Це не файл моделі цього застосунку (очікується "format": "hr-rhythm-model").');
      }
      const net = json.network;
      if (!net || net.type !== 'NeuralNetwork' || !Array.isArray(net.sizes)) {
        throw new Error('У файлі немає мережі brain.js NeuralNetwork.');
      }
      if (net.sizes[0] !== json.windowSize || net.sizes[net.sizes.length - 1] !== CLASSES.length) {
        throw new Error(`Розміри шарів мережі (${net.sizes.join('–')}) не відповідають опису моделі.`);
      }
      const enc = json.encoding;
      if (!enc || !Number.isFinite(enc.min) || !Number.isFinite(enc.max) || enc.min >= enc.max) {
        throw new Error('У файлі моделі некоректні межі нормування входів.');
      }
      const model = new RhythmModel({
        windowSize: json.windowSize,
        hiddenLayers: Array.isArray(json.hiddenLayers) ? json.hiddenLayers : net.sizes.slice(1, -1),
        encoding: enc,
        trainRange: json.trainRange,
      });
      model.net.fromJSON(net);
      model.training = json.training || null;
      model.history = json.history && Array.isArray(json.history.epoch) ? json.history : null;
      model.evaluation = json.evaluation || null;
      model.source = 'file';
      model.fileName = fileName;
      return model;
    }
  }

  HR.RhythmModel = RhythmModel;
})(window.HR = window.HR || {});
