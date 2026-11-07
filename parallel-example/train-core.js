/* Навчання однієї мережі brain.js без інтерфейсу. Спільний код:
   виконується і в основному потоці, і всередині Web Worker. */
(function (root) {
  'use strict';

  // mulberry32 — той самий генератор, що й у застосунку (js/rng.js)
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, next) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function accuracy(net, samples) {
    let correct = 0;
    for (const s of samples) {
      const out = net.run(s.input);
      if ((out[1] > out[0]) === (s.output[1] > s.output[0])) correct++;
    }
    return correct / samples.length;
  }

  // brain.js задає початкові ваги через Math.random(); тут їх задано тим самим
  // законом (рівномірно в [−0,2; 0,2)), але з зерном — щоб результат не
  // залежав від того, у якому потоці виконується навчання
  function seedWeights(net, next) {
    for (let layer = 1; layer <= net.outputLayer; layer++) {
      const biases = net.biases[layer];
      for (let node = 0; node < biases.length; node++) {
        biases[node] = next() * 0.4 - 0.2;
        const weights = net.weights[layer][node];
        for (let k = 0; k < weights.length; k++) weights[k] = next() * 0.4 - 0.2;
      }
    }
  }

  // Те саме, що RhythmModel.train() у js/model.js: по одній епосі за виклик
  // net.train(), перед кожною епохою — нове перемішування
  function trainOne(task, data) {
    const started = performance.now();
    const net = new brain.NeuralNetwork({
      inputSize: data.train[0].input.length,
      hiddenLayers: task.hiddenLayers,
      outputSize: data.train[0].output.length,
      activation: 'sigmoid',
    });
    const train = data.train.slice();
    const next = mulberry32(task.seed);
    net.initialize();
    seedWeights(net, next);
    const options = { iterations: 1, learningRate: task.learningRate, momentum: task.momentum, errorThresh: 1e-12, log: false };
    let error = NaN;
    for (let epoch = 0; epoch < task.epochs; epoch++) {
      shuffle(train, next);
      error = net.train(train, options).error;
    }
    return {
      id: task.id,
      learningRate: task.learningRate,
      hiddenLayers: task.hiddenLayers,
      epochs: task.epochs,
      error,
      testAccuracy: accuracy(net, data.test),
      ms: performance.now() - started,
    };
  }

  root.ParallelExample = { trainOne };
})(self);
