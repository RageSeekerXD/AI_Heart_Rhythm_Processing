/* Перемикач поступок браузеру для бенчмарку.
   Застосунок між частинами довгих обчислень викликає HR.util.nextFrame()
   і чекає наступного кадру (≈16 мс), щоб оновити прогрес-бар. Модулі
   generator.js і model.js беруть цю функцію під час завантаження, тому
   підміна робиться тут — після util.js, але до них.
     'none' — пауз немає (Promise.resolve()): вимірюється чистий час алгоритму;
     'app'  — оригінальна функція: поведінка як в інтерфейсі застосунку. */
(function (HR) {
  'use strict';

  const appNextFrame = HR.util.nextFrame;
  const BENCH = (window.BENCH = window.BENCH || {});
  BENCH.yieldMode = 'none';
  BENCH.yieldCount = 0;

  HR.util.nextFrame = function nextFrame() {
    BENCH.yieldCount++;
    return BENCH.yieldMode === 'app' ? appNextFrame() : Promise.resolve();
  };
})(window.HR);
