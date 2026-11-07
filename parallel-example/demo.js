/* Порівняння: кілька моделей з різними параметрами навчаються
   1) послідовно в основному потоці; 2) паралельно в пулі Web Workers. */
(function () {
  'use strict';

  const out = document.getElementById('out');
  const print = (text) => { out.textContent += `${text}\n`; };

  // Набір даних генерується кодом застосунку (js/generator.js) і кодується
  // так само, як у RhythmModel (мін-макс нормування, унітарний код класу)
  async function prepareData(perClass, seed) {
    const ds = await HR.data.buildDataset({
      perClass, length: 4, testPct: 20, normMin: 60, normMax: 100, tolerance: 8,
      arrMin: 50, arrMax: 120, minSpread: 15, seed,
    });
    const { encoding } = HR.RhythmModel.encodingFor(ds.train);
    const model = new HR.RhythmModel({ windowSize: 4, hiddenLayers: [8], encoding });
    const toPair = (s) => ({ input: model.encode(s.bpm), output: model.target(s.label) });
    return { train: ds.train.map(toPair), test: ds.test.map(toPair) };
  }

  function makeTasks(rates, hidden, epochs) {
    const tasks = [];
    for (const h of hidden) {
      for (const lr of rates) {
        tasks.push({ id: tasks.length + 1, learningRate: lr, momentum: 0.1, hiddenLayers: [h], epochs, seed: 7 });
      }
    }
    return tasks;
  }

  // Найбільша пауза між «ударами» таймера: показує, наскільки довго
  // основний потік не міг обробляти події інтерфейсу
  function heartbeat() {
    let last = performance.now();
    let maxGap = 0;
    const id = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 10);
    return () => {
      clearInterval(id);
      return Math.max(maxGap, performance.now() - last);
    };
  }

  function runSequential(tasks, data) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const results = tasks.map((task) => ParallelExample.trainOne(task, data));
        resolve(results);
      }, 50);
    });
  }

  // Пул воркерів: кожен воркер бере наступне завдання з черги, щойно
  // завершить попереднє; результати збираються в один масив
  function runInWorkers(tasks, data, threads) {
    return new Promise((resolve, reject) => {
      const queue = tasks.slice();
      const results = [];
      let active = 0;

      const startNext = (worker) => {
        const task = queue.shift();
        if (!task) {
          worker.terminate();
          active--;
          if (active === 0) resolve(results.sort((a, b) => a.id - b.id));
          return;
        }
        worker.postMessage({ type: 'task', task });
      };

      for (let i = 0; i < Math.min(threads, tasks.length); i++) {
        const worker = new Worker('train-worker.js');
        active++;
        worker.onmessage = (ev) => {
          if (ev.data.type === 'error') {
            reject(new Error(`Завдання ${ev.data.id}: ${ev.data.message}`));
            return;
          }
          results.push(ev.data.result);
          startNext(worker);
        };
        worker.onerror = (ev) => reject(new Error(ev.message || 'помилка воркера'));
        worker.postMessage({ type: 'data', data }); // дані копіюються у воркер один раз
        startNext(worker);
      }
    });
  }

  function best(results) {
    return results.reduce((a, b) => (b.testAccuracy > a.testAccuracy
      || (b.testAccuracy === a.testAccuracy && b.error < a.error) ? b : a));
  }

  async function runBenchmark({ perClass = 500, epochs = 500, threads = navigator.hardwareConcurrency || 4,
    rates = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7], hidden = [4, 8] } = {}) {
    out.textContent = '';
    const data = await prepareData(perClass, 12345);
    const tasks = makeTasks(rates, hidden, epochs);
    print(`Навчальна вибірка: ${data.train.length}, тестова: ${data.test.length}; моделей: ${tasks.length}, епох: ${epochs}; потоків: ${threads}`);

    let stop = heartbeat();
    let t0 = performance.now();
    const seq = await runSequential(tasks, data);
    const seqMs = performance.now() - t0;
    const seqGap = stop();
    print(`Основний потік: ${seqMs.toFixed(0)} мс, найдовша пауза інтерфейсу ${seqGap.toFixed(0)} мс`);

    stop = heartbeat();
    t0 = performance.now();
    const par = await runInWorkers(tasks, data, threads);
    const parMs = performance.now() - t0;
    const parGap = stop();
    print(`Web Workers:    ${parMs.toFixed(0)} мс, найдовша пауза інтерфейсу ${parGap.toFixed(0)} мс`);
    print(`Прискорення: ${(seqMs / parMs).toFixed(2)}×`);

    const sameResults = seq.every((r, i) => r.error === par[i].error && r.testAccuracy === par[i].testAccuracy);
    print(`Результати в обох режимах ${sameResults ? 'однакові' : 'різні'}`);
    for (const r of par) {
      print(`  #${r.id}: η = ${r.learningRate}, шар ${r.hiddenLayers.join(',')} → помилка ${r.error.toExponential(2)}, точність ${(r.testAccuracy * 100).toFixed(1)} %, ${r.ms.toFixed(0)} мс`);
    }
    const b = best(par);
    print(`Найкраща модель: #${b.id} (η = ${b.learningRate}, ${b.hiddenLayers.join(',')} нейронів), точність ${(b.testAccuracy * 100).toFixed(1)} %`);
    return { threads, tasks: tasks.length, epochs, seqMs, parMs, speedup: seqMs / parMs, seqGap, parGap, sameResults, results: par, best: b };
  }

  document.getElementById('run').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try {
      await runBenchmark({ threads: Number(document.getElementById('threads').value) });
    } catch (err) {
      print(`Помилка: ${err.message}`);
    } finally {
      ev.target.disabled = false;
    }
  });
  document.getElementById('threads').value = String(navigator.hardwareConcurrency || 4);

  window.runBenchmark = runBenchmark;
})();
