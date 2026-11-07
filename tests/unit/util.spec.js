/* Модульні тести: допоміжні функції (Application/js/util.js) */
describe('Модульні тести', () => {
  describe('util.js - допоміжні функції', () => {
    const u = HR.util;
    // Intl для uk-UA розділяє тисячі нерозривним пробілом; для порівняння - звичайний
    const norm = (s) => s.replace(/\s/g, ' ');

    it('clamp обмежує значення межами і не змінює значення всередині', () => {
      expect(u.clamp(5, 0, 10)).to.equal(5);
      expect(u.clamp(-1, 0, 10)).to.equal(0);
      expect(u.clamp(11, 0, 10)).to.equal(10);
      expect(u.clamp(0, 0, 10)).to.equal(0);
      expect(u.clamp(10, 0, 10)).to.equal(10);
    });

    it('mean, sum, spread рахують середнє, суму і розкид; mean порожнього масиву - NaN', () => {
      expect(u.sum([72, 68, 75])).to.equal(215);
      expect(u.mean([1, 2, 3, 6])).to.equal(3);
      expect(u.mean([])).to.be.NaN;
      expect(u.spread([72, 68, 75, 71])).to.equal(7);
      expect(u.spread([70])).to.equal(0);
    });

    it('argmax повертає індекс першого найбільшого елемента', () => {
      expect(u.argmax([0.2, 0.8])).to.equal(1);
      expect(u.argmax([0.5, 0.5])).to.equal(0);
      expect(u.argmax([1, 3, 3])).to.equal(1);
      expect(u.argmax([7])).to.equal(0);
    });

    it('bpmToMs і msToBpm - взаємно обернені перетворення ЧСС ↔ RR-інтервал', () => {
      expect(u.bpmToMs(60)).to.equal(1000);
      expect(u.msToBpm(1000)).to.equal(60);
      expect(u.bpmToMs(120)).to.equal(500);
      for (const bpm of [20, 45, 72, 150, 300]) {
        expect(u.msToBpm(u.bpmToMs(bpm))).to.be.closeTo(bpm, 1e-9);
      }
    });

    it('fmtNum форматує числа за українськими правилами, нечислові значення - «—»', () => {
      expect(norm(u.fmtNum(1000))).to.equal('1 000');
      expect(norm(u.fmtNum(1234567))).to.equal('1 234 567');
      expect(u.fmtNum(0.3, 2)).to.equal('0,30');
      expect(u.fmtNum(NaN)).to.equal('—');
      expect(u.fmtNum(Infinity)).to.equal('—');
    });

    it('fmtPct і fmtDec: відсотки з одним знаком, десяткові без зайвих нулів', () => {
      expect(norm(u.fmtPct(0.5))).to.equal('50,0 %');
      expect(norm(u.fmtPct(0.987))).to.equal('98,7 %');
      expect(u.fmtPct(NaN)).to.equal('—');
      expect(u.fmtDec(0.3)).to.equal('0,3');
      expect(u.fmtDec(0.005)).to.equal('0,005');
    });

    it('plural вибирає правильну форму іменника (1, 2–4, 5–20, 21, 111)', () => {
      const f = (n) => u.plural(n, 'значення-1', 'значення-2', 'значень');
      expect(f(1)).to.equal('значення-1');
      expect(f(2)).to.equal('значення-2');
      expect(f(4)).to.equal('значення-2');
      expect(f(5)).to.equal('значень');
      expect(f(0)).to.equal('значень');
      expect(f(11)).to.equal('значень');
      expect(f(12)).to.equal('значень');
      expect(f(14)).to.equal('значень');
      expect(f(21)).to.equal('значення-1');
      expect(f(22)).to.equal('значення-2');
      expect(f(111)).to.equal('значень');
      expect(f(-1)).to.equal('значення-1');
      expect(norm(u.countOf(1000, 'послідовність', 'послідовності', 'послідовностей'))).to.equal('1 000 послідовностей');
    });

    it('fmtError показує помилку MSE: великі значення - 4 знаки, малі - в експоненційному записі', () => {
      expect(u.fmtError(0)).to.equal('0');
      expect(u.fmtError(0.25)).to.equal('0,2500');
      expect(u.fmtError(0.01)).to.equal('0,0100');
      expect(u.fmtError(0.001234)).to.equal('1,23e-3');
      expect(u.fmtError(NaN)).to.equal('—');
    });

    it('formatBytes: Б, КБ, МБ на межах 1024 і 1024²', () => {
      expect(u.formatBytes(0)).to.equal('0 Б');
      expect(u.formatBytes(1023)).to.equal('1023 Б');
      expect(u.formatBytes(1024)).to.equal('1,0 КБ');
      expect(u.formatBytes(1536)).to.equal('1,5 КБ');
      expect(u.formatBytes(1024 * 1024)).to.equal('1,00 МБ');
      expect(u.formatBytes(NaN)).to.equal('—');
    });

    it('formatBytes: значення, яке після округлення дорівнює 1024 КБ, показується в МБ (межовий випадок)', () => {
      // 1 048 575 Б = 1023,999 КБ - без перевірки після округлення було б «1 024,0 КБ»
      expect(norm(u.formatBytes(1024 * 1024 - 1))).to.equal('1,00 МБ');
      expect(norm(u.formatBytes(1024 * 1024 - 60))).to.equal('1 023,9 КБ');
    });

    it('formatDuration: мілісекунди до 1 с, далі секунди з двома знаками', () => {
      expect(u.formatDuration(0)).to.equal('0 мс');
      expect(u.formatDuration(999)).to.equal('999 мс');
      expect(u.formatDuration(1000)).to.equal('1,00 с');
      expect(u.formatDuration(5040)).to.equal('5,04 с');
      expect(u.formatDuration(-1 / 0)).to.equal('—');
    });

    it('formatDuration: 999,6 мс після округлення показується як «1,00 с», а не «1 000 мс» (межовий випадок)', () => {
      expect(norm(u.formatDuration(999.6))).to.equal('1,00 с');
      expect(norm(u.formatDuration(999.4))).to.equal('999 мс');
    });

    it('fileExtension повертає розширення в нижньому регістрі або порожній рядок', () => {
      expect(u.fileExtension('data.CSV')).to.equal('csv');
      expect(u.fileExtension('model.v2.json')).to.equal('json');
      expect(u.fileExtension('README')).to.equal('');
      expect(u.fileExtension('')).to.equal('');
    });

    it('fileStamp, formatTime, formatDateTime мають фіксований формат з ведучими нулями', () => {
      const d = new Date(2026, 9, 1, 9, 5, 7, 8);
      expect(u.fileStamp(d)).to.equal('2026-10-01_09-05-07');
      expect(u.formatTime(d)).to.equal('09:05:07.008');
      expect(u.formatDateTime(d)).to.equal('2026-10-01 09:05:07');
    });

    it('nextFrame віддає керування браузеру і завершується (запасний таймер ≤ 120 мс)', async () => {
      const t0 = performance.now();
      await u.nextFrame();
      expect(performance.now() - t0).to.be.below(500);
    });
  });
});
