/* Модульні тести: перевірка параметрів і генерація послідовностей за
   формулами (4) і (5) (Application/js/generator.js) */
describe('Модульні тести', () => {
  describe('generator.js - перевірка параметрів validateParams()', () => {
    const v = (overrides) => HR.data.validateParams(T.params(overrides));
    const fieldsOf = (result) => result.errors.flatMap((e) => e.fields);

    it('типові параметри застосунку коректні: без помилок і попереджень', () => {
      const r = v({});
      expect(r.errors).to.be.empty;
      expect(r.warnings).to.be.empty;
    });

    it('мінімальні допустимі значення всіх полів приймаються (граничний випадок)', () => {
      const r = v({ perClass: 10, length: 3, testPct: 5, normMin: 30, normMax: 31, tolerance: 0, arrMin: 30, arrMax: 36, minSpread: 1, seed: 0 });
      expect(r.errors).to.be.empty;
      // 20 зразків < 250 - лише попередження, генерацію не блокує
      expect(r.warnings).to.have.lengthOf(1);
      expect(r.warnings[0].text).to.include('менше 250');
    });

    it('максимальні допустимі значення всіх полів приймаються (граничний випадок)', () => {
      const r = v({ perClass: 5000, length: 12, testPct: 50, normMin: 199, normMax: 200, tolerance: 30, arrMin: 115, arrMax: 220, minSpread: 100, seed: HR.MAX_SEED });
      expect(r.errors).to.be.empty;
    });

    const outside = [
      ['perClass', { perClass: 9 }], ['perClass', { perClass: 5001 }], ['perClass', { perClass: 10.5 }], ['perClass', { perClass: NaN }],
      ['seqLen', { length: 2 }], ['seqLen', { length: 13 }],
      ['testPct', { testPct: 4.9 }], ['testPct', { testPct: 50.1 }], ['testPct', { testPct: NaN }],
      ['normMin', { normMin: 29 }], ['normMax', { normMax: 201 }], ['normMin', { normMin: 100, normMax: 100 }],
      ['tol', { tolerance: -1 }], ['tol', { tolerance: 31 }], ['tol', { tolerance: 2.5 }],
      ['arrMin', { arrMin: 29 }], ['arrMax', { arrMax: 221 }], ['arrMin', { arrMin: 120, arrMax: 50 }],
      ['minSpread', { minSpread: 0 }], ['minSpread', { minSpread: 101 }], ['minSpread', { arrMin: 60, arrMax: 70, minSpread: 15 }],
      ['seed', { seed: -1 }], ['seed', { seed: HR.MAX_SEED + 1 }], ['seed', { seed: 1.5 }], ['seed', { seed: NaN }],
    ];
    for (const [field, overrides] of outside) {
      it(`значення поза межами відхиляється і підсвічується поле ${field}: ${JSON.stringify(overrides).replace(/null/g, 'NaN')}`, () => {
        const r = v(overrides);
        expect(r.errors, 'очікувалася помилка').to.not.be.empty;
        expect(fieldsOf(r)).to.include(field);
        r.errors.forEach((e) => expect(e.text).to.be.a('string').and.not.empty);
      });
    }

    it('нижня межа норми мінус допуск Tol(r) не може бути меншою за 20 уд/хв (інакше генеруються нефізіологічні ЧСС)', () => {
      const r = v({ normMin: 30, tolerance: 30 });
      expect(fieldsOf(r)).to.include.members(['normMin', 'tol']);
      expect(v({ normMin: 30, tolerance: 10 }).errors).to.be.empty;
      expect(v({ normMin: 30, tolerance: 11 }).errors).to.not.be.empty;
    });

    it('попереджає, якщо мінімальний розкид аритмії не більший за допуск норми (класи перекриваються)', () => {
      const r = v({ tolerance: 15, minSpread: 15 });
      expect(r.errors).to.be.empty;
      expect(r.warnings.map((w) => w.text).join(' ')).to.include('перекриваються');
    });

    it('порожнє зерно (null) допустиме - тоді воно вибирається випадково', () => {
      expect(v({ seed: null }).errors).to.be.empty;
    });
  });

  describe('generator.js - формули (4) і (5) та генерація набору', () => {
    const p = T.params();

    it('формула (4): нормальний ритм містить лише Tmax і Tmin, значення в [normMin − Tol; normMax], Tmax − Tmin ≤ Tol(r)', () => {
      // Tmax = random(normMin…normMax), Tmin = Tmax − random(0…Tol); якщо всі K виборів
      // припали на Tmin, найбільше значення послідовності може бути меншим за normMin
      const rng = new HR.Random(11);
      for (let i = 0; i < 2000; i++) {
        const s = HR.data.normalSequence(rng, p);
        expect(s).to.have.lengthOf(p.length);
        expect(new Set(s).size).to.be.at.most(2);
        expect(Math.max(...s)).to.be.at.most(p.normMax);
        expect(Math.min(...s)).to.be.at.least(p.normMin - p.tolerance);
        expect(HR.util.spread(s)).to.be.at.most(p.tolerance);
      }
    });

    it('формула (4) з Tol(r) = 0 дає ідеально рівний ритм', () => {
      const rng = new HR.Random(12);
      for (let i = 0; i < 200; i++) expect(HR.util.spread(HR.data.normalSequence(rng, { ...p, tolerance: 0 }))).to.equal(0);
    });

    it('формула (5): аритмія - цілі ЧСС у межах [arrMin; arrMax] з розкидом ≥ мінімального', () => {
      const rng = new HR.Random(13);
      for (let i = 0; i < 2000; i++) {
        const { bpm, rejected } = HR.data.arrhythmiaSequence(rng, p);
        expect(bpm).to.have.lengthOf(p.length);
        expect(bpm.every((x) => Number.isInteger(x) && x >= p.arrMin && x <= p.arrMax)).to.be.true;
        expect(HR.util.spread(bpm)).to.be.at.least(p.minSpread);
        expect(rejected).to.be.at.least(0);
      }
    });

    it('формула (5): недосяжний розкид дає зрозумілу помилку, а не зависання', () => {
      T.expectThrows(() => HR.data.arrhythmiaSequence(new HR.Random(1), { ...p, arrMin: 60, arrMax: 70, minSpread: 50 }), 'Не вдалося згенерувати аритмію');
    });

    it('exampleSeries: у довгій послідовності аритмії кожне вікно з K значень нерегулярне', () => {
      for (let seed = 1; seed <= 30; seed++) {
        const values = HR.data.exampleSeries(new HR.Random(seed), p, 'arrhythmia', 12, 4);
        expect(values).to.have.lengthOf(12);
        for (let i = 0; i + 4 <= values.length; i++) {
          expect(HR.util.spread(values.slice(i, i + 4))).to.be.at.least(p.minSpread);
        }
      }
      const normal = HR.data.exampleSeries(new HR.Random(5), p, 'normal', 12, 4);
      expect(normal).to.have.lengthOf(12);
      expect(HR.util.spread(normal)).to.be.at.most(p.tolerance);
    });

    it('buildDataset: 2N послідовностей, по N кожного класу, стратифіковане розбиття за часткою тестової вибірки', async () => {
      const ds = await T.dataset({ perClass: 500, testPct: 20 });
      expect(ds.samples).to.have.lengthOf(1000);
      expect(ds.windowSize).to.equal(4);
      for (const label of HR.data.CLASSES) {
        const c = ds.stats.byClass[label];
        expect(c.count).to.equal(500);
        expect(c.test).to.equal(100);
        expect(c.train).to.equal(400);
      }
      expect(ds.train).to.have.lengthOf(800);
      expect(ds.test).to.have.lengthOf(200);
      expect(ds.train.every((s) => s.split === 'train')).to.be.true;
      expect(ds.test.every((s) => s.split === 'test')).to.be.true;
      const ids = new Set(ds.samples.map((s) => s.id));
      expect(ids.size).to.equal(1000);
    });

    it('buildDataset: однакове зерно - однаковий набір і розбиття; інше зерно - інший набір', async () => {
      const a = await HR.data.buildDataset(T.params({ perClass: 50, seed: 2026 }));
      const b = await HR.data.buildDataset(T.params({ perClass: 50, seed: 2026 }));
      const c = await HR.data.buildDataset(T.params({ perClass: 50, seed: 2027 }));
      const key = (ds) => ds.samples.map((s) => `${s.label}:${s.split}:${s.bpm.join(',')}`);
      expect(key(a)).to.deep.equal(key(b));
      expect(key(a)).to.not.deep.equal(key(c));
    });

    it('buildDataset: без зерна вибирає випадкове і записує його в набір', async () => {
      const ds = await HR.data.buildDataset(T.params({ perClass: 10, seed: null }));
      expect(Number.isInteger(ds.seed)).to.be.true;
      expect(ds.params.seed).to.equal(ds.seed);
    });

    it('buildDataset: прогрес-бар отримує зростаючі значення і завершується на 100 %', async () => {
      const calls = [];
      await HR.data.buildDataset(T.params({ perClass: 100 }), { onProgress: (done, total) => calls.push([done, total]) });
      expect(calls.length).to.be.within(2, 51);
      for (let i = 1; i < calls.length; i++) expect(calls[i][0]).to.be.above(calls[i - 1][0]);
      expect(calls[calls.length - 1]).to.deep.equal([200, 200]);
    });

    it('buildDataset: мінімальний набір (N = 10, частка 5 %) - у тестовій вибірці є приклади обох класів', async () => {
      const ds = await HR.data.buildDataset(T.params({ perClass: 10, testPct: 5 }));
      expect(ds.stats.byClass.normal.test).to.equal(1);
      expect(ds.stats.byClass.arrhythmia.test).to.equal(1);
    });

    it('buildDataset: максимальна частка 50 % ділить кожен клас навпіл', async () => {
      const ds = await HR.data.buildDataset(T.params({ perClass: 11, testPct: 50 }));
      // round(11 · 0,5) = 6
      expect(ds.stats.byClass.normal.test).to.equal(6);
      expect(ds.stats.byClass.normal.train).to.equal(5);
    });

    it('buildDataset: статистика набору узгоджена з самими зразками', async () => {
      const ds = await T.dataset();
      const all = ds.samples.flatMap((s) => s.bpm);
      expect(ds.stats.minBpm).to.equal(Math.min(...all));
      expect(ds.stats.maxBpm).to.equal(Math.max(...all));
      const s = ds.samples[0];
      expect(s.mean).to.equal(HR.util.mean(s.bpm));
      expect(s.spread).to.equal(HR.util.spread(s.bpm));
    });

    // Властивість для граничних комбінацій: усе, що пропускає validateParams,
    // має давати фізіологічно можливі ЧСС у межах, які застосунок приймає з файлу (20–300)
    const combos = [
      {}, { length: 3 }, { length: 12 },
      { normMin: 30, normMax: 31, tolerance: 0 }, { normMin: 30, normMax: 200, tolerance: 30 }, { normMin: 40, tolerance: 30 },
      { normMin: 199, normMax: 200, tolerance: 30 }, { arrMin: 30, arrMax: 220, minSpread: 100 }, { arrMin: 30, arrMax: 36, minSpread: 1 },
    ];
    for (const combo of combos) {
      it(`параметри ${JSON.stringify(combo)} або відхиляються перевіркою, або дають ЧСС у межах 20–300 уд/хв`, async () => {
        const params = T.params({ perClass: 300, ...combo });
        if (HR.data.validateParams(params).errors.length) return;
        const ds = await HR.data.buildDataset(params);
        expect(ds.stats.minBpm, 'мінімальна ЧСС набору').to.be.at.least(HR.data.BPM_LIMITS.min);
        expect(ds.stats.maxBpm, 'максимальна ЧСС набору').to.be.at.most(HR.data.BPM_LIMITS.max);
      });
    }
  });
});
