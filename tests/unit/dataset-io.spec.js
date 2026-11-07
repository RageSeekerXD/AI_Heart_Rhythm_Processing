/* Модульні тести: збереження і завантаження набору даних (CSV, JSON) -
   коректні та некоректні файли (Application/js/generator.js) */
describe('Модульні тести', () => {
  describe('generator.js - експорт набору даних у CSV і JSON', () => {
    it('datasetToCsv: заголовок id,label,split,bpm_1..bpm_K, рядки через CRLF, один рядок на зразок', async () => {
      const ds = await T.dataset();
      const text = HR.data.datasetToCsv(ds);
      const lines = text.split('\r\n');
      expect(lines[0]).to.equal('id,label,split,bpm_1,bpm_2,bpm_3,bpm_4');
      expect(lines).to.have.lengthOf(ds.samples.length + 2); // + заголовок + порожній рядок у кінці
      const s = ds.samples[0];
      expect(lines[1]).to.equal([s.id, s.label, s.split, ...s.bpm].join(','));
      expect(text.endsWith('\r\n')).to.be.true;
    });

    it('datasetToJson: формат hr-rhythm-dataset, версія, параметри, зерно і всі зразки', async () => {
      const ds = await T.dataset();
      const json = JSON.parse(HR.data.datasetToJson(ds));
      expect(json.format).to.equal('hr-rhythm-dataset');
      expect(json.version).to.equal(1);
      expect(json.units).to.equal('bpm');
      expect(json.windowSize).to.equal(4);
      expect(json.seed).to.equal(42);
      expect(json.params.normMin).to.equal(60);
      expect(json.classes).to.deep.equal(['normal', 'arrhythmia']);
      expect(json.samples).to.have.lengthOf(1000);
      expect(json.samples[0]).to.have.all.keys('id', 'label', 'split', 'bpm');
    });
  });

  describe('generator.js - завантаження коректних файлів parseDatasetFile()', () => {
    const parse = (text, name = 'data.csv', fraction = 0.2) => HR.data.parseDatasetFile(text, name, fraction);

    it('CSV із заголовком: K = 4, по 5 зразків класу, розбиття виконується автоматично', () => {
      const ds = parse(T.csv(...T.validCsvLines(5)));
      expect(ds.windowSize).to.equal(4);
      expect(ds.stats.byClass.normal.count).to.equal(5);
      expect(ds.stats.byClass.arrhythmia.count).to.equal(5);
      expect(ds.splitFromFile).to.be.false;
      expect(ds.stats.byClass.normal.test).to.equal(1); // round(5 · 0,2)
      expect(ds.source).to.equal('file');
    });

    it('CSV з крапкою з комою і українськими назвами стовпців (клас; вибірка)', () => {
      const lines = ['клас;вибірка;ЧСС1;ЧСС2;ЧСС3'];
      for (let i = 0; i < 5; i++) {
        const split = i < 4 ? 'навчальна' : 'тестова';
        lines.push(`норма;${split};70;72;70`, `аритмія;${split};60;95;110`);
      }
      const ds = parse(T.csv(...lines));
      expect(ds.windowSize).to.equal(3);
      expect(ds.splitFromFile).to.be.true;
      expect(ds.train).to.have.lengthOf(8);
      expect(ds.test).to.have.lengthOf(2);
    });

    it('файл з табуляцією як роздільником (TSV)', () => {
      const ds = parse(T.csv(...T.validCsvLines(5).map((l) => l.replace(/,/g, '\t'))), 'data.tsv');
      expect(ds.samples).to.have.lengthOf(10);
    });

    it('CSV без заголовка: стовпець класу знаходиться за значенням (normal / arrhythmia)', () => {
      const ds = parse(T.csv(...T.validCsvLines(5).slice(1)));
      expect(ds.samples).to.have.lengthOf(10);
      expect(ds.windowSize).to.equal(4);
    });

    it('BOM, порожні рядки і коментарі (#) ігноруються', () => {
      const lines = T.validCsvLines(5);
      const text = '﻿# експорт з іншої програми\r\n' + T.csv(lines[0], '', ...lines.slice(1), '# кінець');
      expect(parse(text).samples).to.have.lengthOf(10);
    });

    it('синоніми класів: Норма, АРИТМІЯ, N, a, 0, 1', () => {
      const lines = ['label,b1,b2,b3,b4'];
      const normal = ['Норма', 'N', '0', 'normal', 'нормальний ритм'];
      const arr = ['АРИТМІЯ', 'a', '1', 'irregular', 'arrhythmic'];
      normal.forEach((l) => lines.push(`${l},70,72,70,72`));
      arr.forEach((l) => lines.push(`${l},60,95,70,110`));
      const ds = parse(T.csv(...lines));
      expect(ds.stats.byClass.normal.count).to.equal(5);
      expect(ds.stats.byClass.arrhythmia.count).to.equal(5);
    });

    it('JSON у форматі застосунку { samples: [{ label, bpm }] } і масив [{ class, values }]', () => {
      const samples = [];
      for (let i = 0; i < 5; i++) samples.push({ label: 'normal', bpm: [70, 72, 70, 72] }, { label: 'arrhythmia', bpm: [60, 95, 70, 110] });
      expect(parse(JSON.stringify({ samples }), 'd.json').samples).to.have.lengthOf(10);
      const arr = samples.map((s) => ({ class: s.label === 'normal' ? 0 : 1, values: s.bpm }));
      expect(parse(JSON.stringify(arr), 'd.json').samples).to.have.lengthOf(10);
      const seq = samples.map((s) => ({ label: s.label, sequence: s.bpm }));
      expect(parse(JSON.stringify(seq), 'export.txt').samples).to.have.lengthOf(10); // JSON розпізнається за вмістом
    });

    it('розбиття з файлу використовується, якщо воно є в кожному рядку', () => {
      const lines = ['label,split,b1,b2,b3,b4'];
      for (let i = 0; i < 10; i++) {
        const split = i < 8 ? 'train' : 'test';
        lines.push(`normal,${split},70,72,70,72`, `arrhythmia,${split},60,95,70,110`);
      }
      const ds = parse(T.csv(...lines));
      expect(ds.splitFromFile).to.be.true;
      expect(ds.train).to.have.lengthOf(16);
      expect(ds.test).to.have.lengthOf(4);
    });

    it('невідоме значення вибірки в одному рядку - розбиття виконується автоматично', () => {
      const lines = ['label,split,b1,b2,b3,b4'];
      for (let i = 0; i < 6; i++) lines.push(`normal,${i === 3 ? 'validation' : 'train'},70,72,70,72`, 'arrhythmia,test,60,95,70,110');
      const ds = parse(T.csv(...lines));
      expect(ds.splitFromFile).to.be.false;
      expect(ds.stats.byClass.normal.test).to.be.above(0);
      expect(ds.stats.byClass.arrhythmia.train).to.be.above(0);
    });

    it('граничні ЧСС 20 і 300 уд/хв та граничні довжини K = 3 і K = 30 приймаються', () => {
      const make = (k, a, b) => {
        const lines = ['label,' + Array.from({ length: k }, (_, i) => `v${i}`).join(',')];
        for (let i = 0; i < 5; i++) {
          lines.push('normal,' + Array(k).fill(a).join(','));
          lines.push('arrhythmia,' + Array.from({ length: k }, (_, j) => (j % 2 ? a : b)).join(','));
        }
        return T.csv(...lines);
      };
      expect(parse(make(3, 20, 300)).windowSize).to.equal(3);
      expect(parse(make(30, 20, 300)).windowSize).to.equal(30);
    });

    const splits = {
      'усі рядки позначено test': () => ['test', 'test'],
      'аритмія лише в тестовій вибірці': (i) => [i < 4 ? 'train' : 'test', 'test'],
    };
    for (const [name, splitOf] of Object.entries(splits)) {
      it(`кожен клас має приклади і в навчальній, і в тестовій вибірці, навіть якщо у файлі ${name}`, () => {
        const lines = ['label,split,b1,b2,b3,b4'];
        for (let i = 0; i < 6; i++) {
          const [sn, sa] = splitOf(i);
          lines.push(`normal,${sn},70,72,70,72`, `arrhythmia,${sa},60,95,70,110`);
        }
        const ds = parse(T.csv(...lines));
        for (const label of HR.data.CLASSES) {
          expect(ds.stats.byClass[label].train, `навчальних прикладів класу ${label}`).to.be.above(0);
          expect(ds.stats.byClass[label].test, `тестових прикладів класу ${label}`).to.be.above(0);
        }
      });
    }

    for (const fraction of [0, 1]) {
      it(`частка тестової вибірки ${fraction * 100} % (поза межами поля 5–50 %) не залишає порожньої вибірки`, () => {
        const ds = parse(T.csv(...T.validCsvLines(6)), 'data.csv', fraction);
        expect(ds.train.length, 'навчальна вибірка').to.be.above(0);
        expect(ds.test.length, 'тестова вибірка').to.be.above(0);
      });
    }
  });

  describe('generator.js - завантаження некоректних файлів (негативні сценарії)', () => {
    const parse = (text, name = 'data.csv') => () => HR.data.parseDatasetFile(text, name, 0.2);

    it('порожній файл і файл лише з коментарями', () => {
      T.expectThrows(parse(''), 'Файл порожній');
      T.expectThrows(parse('\r\n\r\n'), 'Файл порожній');
      T.expectThrows(parse('# лише коментар\r\n'), 'Файл порожній');
    });

    it('пошкоджений JSON і JSON без масиву samples', () => {
      T.expectThrows(parse('{"samples": [', 'd.json'), 'Некоректний JSON');
      T.expectThrows(parse('{"foo": 1}', 'd.json'), 'масив samples');
      T.expectThrows(parse('[]', 'd.json'), 'немає жодного зразка');
    });

    it('CSV без стовпця класу', () => {
      T.expectThrows(parse(T.csv('a,b,c,d', '70,72,70,72', '60,95,70,110')), 'Не знайдено стовпця з класом');
    });

    it('невідомий клас - помилка з номером рядка', () => {
      const lines = T.validCsvLines(5);
      lines.splice(3, 0, 'maybe,70,72,70,72');
      T.expectThrows(parse(T.csv(...lines)), 'рядок 4: невідомий клас «maybe»');
    });

    it('нечислове значення ЧСС', () => {
      const lines = T.validCsvLines(5);
      lines.push('normal,72,abc,70,71');
      T.expectThrows(parse(T.csv(...lines)), 'значення мають бути числами');
    });

    it('ЧСС за межами 20–300 уд/хв (19 і 301)', () => {
      const low = T.validCsvLines(5);
      low.push('normal,19,72,70,71');
      T.expectThrows(parse(T.csv(...low)), 'поза межами 20–300');
      const high = T.validCsvLines(5);
      high.push('arrhythmia,301,72,70,71');
      T.expectThrows(parse(T.csv(...high)), 'поза межами 20–300');
    });

    it('рядки різної довжини', () => {
      const lines = T.validCsvLines(5);
      lines.push('normal,72,70,71');
      T.expectThrows(parse(T.csv(...lines)), '3 значення замість 4');
    });

    it('довжина послідовності K = 2 і K = 31 не підтримується', () => {
      const make = (k) => {
        const lines = ['label,' + Array.from({ length: k }, (_, i) => `v${i}`).join(',')];
        for (let i = 0; i < 5; i++) lines.push('normal,' + Array(k).fill(70).join(','), 'arrhythmia,' + Array(k).fill(90).join(','));
        return T.csv(...lines);
      };
      T.expectThrows(parse(make(2)), 'Довжина послідовностей 2 не підтримується');
      T.expectThrows(parse(make(31)), 'Довжина послідовностей 31 не підтримується');
    });

    it('менше 5 зразків одного з класів (межа: 5 - достатньо, 4 - ні)', () => {
      const lines = T.validCsvLines(5);
      expect(HR.data.parseDatasetFile(T.csv(...lines), 'd.csv', 0.2).samples).to.have.lengthOf(10);
      const four = lines.filter((l, i) => !(i === lines.length - 1));
      T.expectThrows(parse(T.csv(...four)), 'Замало зразків класу «Аритмія»');
    });

    it('багато помилок: показується кількість і перші п’ять', () => {
      const lines = T.validCsvLines(5);
      for (let i = 0; i < 7; i++) lines.push(`unknown${i},70,72,70,72`);
      const err = T.expectThrows(parse(T.csv(...lines)), 'Знайдено помилок: 7');
      expect(err.message).to.include('…');
      expect(err.message).to.include('unknown4').and.not.include('unknown5');
    });
  });
});
