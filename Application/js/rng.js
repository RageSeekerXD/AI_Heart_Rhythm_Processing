/* Відтворюваний генератор псевдовипадкових чисел (алгоритм mulberry32).
   Однакове зерно (seed) дає однакову послідовність чисел, тож набір даних
   можна відтворити. */
(function (HR) {
  'use strict';

  const MAX_SEED = 4294967295;

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

  function randomSeed() {
    if (window.crypto && window.crypto.getRandomValues) {
      return window.crypto.getRandomValues(new Uint32Array(1))[0] % 1000000000;
    }
    return Math.floor(Math.random() * 1000000000);
  }

  class Random {
    constructor(seed = randomSeed()) {
      this.seed = seed >>> 0;
      this.next = mulberry32(this.seed);
    }

    // Дійсне число в [min; max)
    float(min = 0, max = 1) {
      return min + (max - min) * this.next();
    }

    // Ціле число в [min; max] включно
    int(min, max) {
      return min + Math.floor(this.next() * (max - min + 1));
    }

    // Перемішування Фішера–Єйтса на місці
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    }
  }

  HR.Random = Random;
  HR.randomSeed = randomSeed;
  HR.MAX_SEED = MAX_SEED;
})(window.HR = window.HR || {});
