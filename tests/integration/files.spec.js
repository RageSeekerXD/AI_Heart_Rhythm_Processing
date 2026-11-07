/* Інтеграційні тести: збереження набору у файл і завантаження назад,
   навчання на завантаженому наборі */
describe('Інтеграційні тести', () => {
  describe('файл набору даних: збереження → завантаження → навчання', () => {
    const key = (ds) => ds.samples.map((s) => `${s.label}:${s.split}:${s.bpm.join(',')}`);

    it('CSV (з BOM, як зберігає застосунок) завантажується в ідентичний набір з тим самим розбиттям', async () => {
      const ds = await T.dataset();
      const loaded = HR.data.parseDatasetFile('﻿' + HR.data.datasetToCsv(ds), 'rhythm_dataset_K4.csv', 0.2);
      expect(key(loaded)).to.deep.equal(key(ds));
      expect(loaded.splitFromFile).to.be.true;
      expect(loaded.stats.train).to.equal(800);
      expect(loaded.stats.test).to.equal(200);
    });

    it('JSON завантажується в ідентичний набір; параметри генерації і зерно відновлюються', async () => {
      const ds = await T.dataset();
      const loaded = HR.data.parseDatasetFile(HR.data.datasetToJson(ds), 'rhythm_dataset_K4.json', 0.2);
      expect(key(loaded)).to.deep.equal(key(ds));
      expect(loaded.seed).to.equal(42);
      expect(loaded.params.normMin).to.equal(60);
    });

    // Будь-який набір, який застосунок згенерував, має відкриватися цим самим застосунком
    const combos = [
      {}, { length: 3 }, { length: 12, testPct: 50 }, { perClass: 10, testPct: 5 },
      { normMin: 30, normMax: 200, tolerance: 30 }, { normMin: 45, tolerance: 30 }, { normMin: 199, normMax: 200, tolerance: 30 },
      { arrMin: 30, arrMax: 220, minSpread: 100 },
    ];
    for (const combo of combos) {
      it(`набір з параметрами ${JSON.stringify(combo)} (якщо їх пропускає перевірка) зберігається у CSV і завантажується назад`, async () => {
        const params = T.params({ perClass: 300, ...combo });
        if (HR.data.validateParams(params).errors.length) return;
        const ds = await HR.data.buildDataset(params);
        const loaded = HR.data.parseDatasetFile(HR.data.datasetToCsv(ds), 'd.csv', params.testPct / 100);
        expect(key(loaded)).to.deep.equal(key(ds));
      });
    }

    it('модель, навчена на завантаженому з файлу наборі, розпізнає ритм (точність ≥ 85 %)', async () => {
      const ds = HR.data.parseDatasetFile(HR.data.datasetToCsv(await T.dataset({ perClass: 300, seed: 5 })), 'd.csv', 0.2);
      const m = await T.train(ds, { epochs: 500, shuffleSeed: 1 });
      const accuracy = (await m.evaluate(ds.test)).accuracy;
      T.fact('accuracyFromFile', accuracy);
      expect(accuracy).to.be.at.least(0.85);
    });

    it('набір з файлу, де всі зразки позначено test, придатний для навчання (навчальна вибірка не порожня)', async () => {
      const lines = ['label,split,b1,b2,b3,b4'];
      const rng = new HR.Random(9);
      for (let i = 0; i < 40; i++) {
        lines.push(`normal,test,${HR.data.normalSequence(rng, T.params()).join(',')}`);
        lines.push(`arrhythmia,test,${HR.data.arrhythmiaSequence(rng, T.params()).bpm.join(',')}`);
      }
      const ds = HR.data.parseDatasetFile(T.csv(...lines), 'all-test.csv', 0.2);
      const { encoding } = HR.RhythmModel.encodingFor(ds.train);
      expect(Number.isFinite(encoding.min) && Number.isFinite(encoding.max), 'межі нормування скінченні').to.be.true;
      const m = await T.train(ds, { epochs: 50, shuffleSeed: 1 });
      expect(m.training.trainSamples).to.be.above(0);
      expect(m.training.epochsDone).to.equal(50);
    });
  });
});
