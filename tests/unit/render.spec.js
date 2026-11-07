/* Модульні тести: зображення результату (Application/js/ecg-render.js)
   і графіки навчання (Application/js/charts.js) */
describe('Модульні тести', () => {
  describe('ecg-render.js - зображення результату розпізнавання', () => {
    const C = HR.charts.COLORS;
    const TRACK = '#efeee9';
    const model = { windowSize: 4, architecture: '4–8–2', training: { epochsDone: 1000, learningRate: 0.3 }, evaluation: { accuracy: 0.995 } };
    const win = (p1) => ({ probs: [1 - p1, p1], label: p1 > 0.5 ? 'arrhythmia' : 'normal' });
    const result = (p1) => ({
      label: p1 > 0.5 ? 'arrhythmia' : 'normal', confidence: Math.max(p1, 1 - p1), probs: [1 - p1, p1],
      windows: [win(p1), win(p1), win(p1)], arrhythmicWindows: p1 > 0.5 ? 3 : 0,
    });
    const render = (r, extra = {}, scale) => {
      const canvas = document.createElement('canvas');
      const size = HR.ecg.renderResult(canvas, {
        bpm: [72, 68, 75, 71, 69, 73], inputCount: 6, units: 'bpm', result: r, model, warnings: [],
        normalRange: { min: 60, max: 100 }, createdAt: new Date(2026, 10, 7, 12, 0, 0), ...extra,
      }, scale);
      return { canvas, size };
    };
    const dark = (canvas, x, y, w, h) => {
      const { data } = canvas.getContext('2d').getImageData(x, y, w, h);
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90) n++;
      return n;
    };

    it('розмір зображення 1400 × 800, параметр scale змінює роздільну здатність (2 → 2800 × 1600)', () => {
      expect(render(null).size).to.deep.equal({ width: 1400, height: 800 });
      const big = render(null, {}, 2);
      expect([big.canvas.width, big.canvas.height]).to.deep.equal([2800, 1600]);
      const small = render(null, {}, 0.5);
      expect([small.canvas.width, small.canvas.height]).to.deep.equal([700, 400]);
    });

    it('без класифікації плашка результату сіра («НЕ КЛАСИФІКОВАНО»)', () => {
      expect(T.pixel(render(null).canvas, 1354, 53).slice(0, 3)).to.deep.equal(T.hexRgb(TRACK));
    });

    it('колір плашки відповідає класу: норма - синій, аритмія - помаранчевий', () => {
      expect(T.pixel(render(result(0.1)).canvas, 1354, 53).slice(0, 3)).to.deep.equal(T.hexRgb(C.normal));
      expect(T.pixel(render(result(0.9)).canvas, 1354, 53).slice(0, 3)).to.deep.equal(T.hexRgb(C.arrhythmia));
    });

    it('довжина смуг ймовірностей відповідає ймовірностям класів (90 % / 10 %)', () => {
      const { canvas } = render(result(0.1)); // норма 90 %
      // смуга «Нормальний ритм»: доріжка x = 914…1272, y = 494…516
      expect(T.pixel(canvas, 914 + 179, 505).slice(0, 3), 'середина смуги норми').to.deep.equal(T.hexRgb(C.normal));
      expect(T.pixel(canvas, 914 + 352, 505).slice(0, 3), 'кінець доріжки норми').to.deep.equal(T.hexRgb(TRACK));
      // смуга «Аритмія»: заповнено лише 10 %
      expect(T.pixel(canvas, 914 + 179, 543).slice(0, 3), 'середина смуги аритмії').to.deep.equal(T.hexRgb(TRACK));
    });

    it('ЕКГ-смужка містить криву (темні пікселі) по всій ширині', () => {
      const { canvas } = render(result(0.1));
      expect(dark(canvas, 36, 150, 440, 250)).to.be.above(300);
      expect(dark(canvas, 476, 150, 440, 250)).to.be.above(300);
      expect(dark(canvas, 916, 150, 440, 250)).to.be.above(300);
    });

    it('послідовність максимальної довжини (200 значень) будується без помилок', () => {
      const bpm = Array.from({ length: 200 }, (_, i) => 60 + (i % 7) * 5);
      const t0 = performance.now();
      const { canvas } = render(result(0.9), { bpm, inputCount: 200 });
      expect(performance.now() - t0).to.be.below(3000);
      expect(dark(canvas, 36, 150, 1328, 250)).to.be.above(1000);
    });

    // Перехоплення fillText: які підписи і де саме намальовано на ЕКГ-смужці
    function drawnLabels(bpm) {
      const calls = [];
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.fillText;
      proto.fillText = function (text, x, y) {
        calls.push({ text: String(text), x, y, w: this.measureText(String(text)).width, align: this.textAlign });
        return original.apply(this, arguments);
      };
      try {
        render(result(0.9), { bpm, inputCount: bpm.length });
      } finally {
        proto.fillText = original;
      }
      const numbers = calls.filter((c) => c.y === 108 + 8 && /^\d+$/.test(c.text));
      const seconds = calls.filter((c) => c.y === 108 + 300 + 6 && /^\d+ с$/.test(c.text));
      return { numbers, seconds };
    }
    const overlaps = (labels) => {
      const sorted = labels.slice().sort((a, b) => a.x - b.x);
      return sorted.filter((c, i) => i > 0 && c.x - c.w / 2 < sorted[i - 1].x + sorted[i - 1].w / 2).map((c) => c.text);
    };

    it('короткий запис (10 значень): підписано кожен R-зубець (1–11) і кожну секунду', () => {
      const { numbers, seconds } = drawnLabels([74, 57, 62, 103, 66, 75, 57, 87, 113, 91]);
      expect(numbers.map((c) => c.text)).to.deep.equal(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
      expect(seconds.map((c) => c.text)).to.deep.equal(['0 с', '1 с', '2 с', '3 с', '4 с', '5 с', '6 с']);
    });

    it('довгий запис (200 значень): номери R-зубців і підписи секунд не накладаються одне на одне', () => {
      const bpm = Array.from({ length: 200 }, (_, i) => 60 + ((i + 1) * 7) % 40);
      const { numbers, seconds } = drawnLabels(bpm);
      T.fact('labels200', { numbers: numbers.length, seconds: seconds.length });
      expect(overlaps(numbers), 'номери R-зубців, що накладаються').to.be.empty;
      expect(overlaps(seconds), 'підписи секунд, що накладаються').to.be.empty;
      expect(numbers[0].text).to.equal('1');
      expect(numbers.length).to.be.at.least(10);
      expect(seconds.length).to.be.at.least(5);
    });

    it('RR-інтервали в мс і попередження відображаються без винятків', () => {
      const warnings = [{ short: 'Є значення поза діапазоном навчальних даних (52–120 уд/хв)', long: '…' }];
      expect(() => render(result(0.1), { units: 'ms', inputCount: 6, warnings })).to.not.throw();
    });
  });

  describe('charts.js - шкали і зображення графіків навчання', () => {
    it('linearTicks: «круглі» поділки в межах діапазону', () => {
      expect(HR.charts.linearTicks(0, 1400, 5)).to.deep.equal([0, 200, 400, 600, 800, 1000, 1200, 1400]);
      const t = HR.charts.linearTicks(0.3, 0.97, 4);
      expect(t[0]).to.be.at.least(0.3);
      expect(t[t.length - 1]).to.be.at.most(0.97);
      for (let i = 1; i < t.length; i++) expect(t[i]).to.be.above(t[i - 1]);
    });

    it('composeTrainingImage: 1400 × 620 для історії з однієї епохи (граничний випадок) і з 1 000 епох', async () => {
      const one = { epoch: [1], error: [0.25], evalEpoch: [1], trainAcc: [0.5], testAcc: [0.5] };
      const c1 = HR.charts.composeTrainingImage({ history: one, totalEpochs: 1, title: 'Т', subtitle: 'п' });
      expect([c1.width, c1.height]).to.deep.equal([1400, 620]);
      const { model } = await T.trainedModel();
      const c2 = HR.charts.composeTrainingImage({ history: model.history, totalEpochs: 1000, title: 'Т', subtitle: 'п' });
      const img = await T.decodeImage(await HR.imageExport.canvasToBlob(c2, 'png'));
      expect([img.naturalWidth, img.naturalHeight]).to.deep.equal([1400, 620]);
      expect(T.inkShare(c2, 40, 176, 640, 410)).to.be.above(0.01);
    });
  });
});
