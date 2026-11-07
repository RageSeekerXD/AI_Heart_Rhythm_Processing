/* Інтеграційні тести: взаємодія генератора, нейронної мережі, оцінювання,
   розпізнавання і побудови зображення результату */
describe('Інтеграційні тести', () => {
  describe('генерація → навчання → оцінювання → розпізнавання', () => {
    it('одне навчання (типові параметри, seed 42, 1 000 епох): точність, чутливість і специфічність на тестовій вибірці ≥ 90 %', async () => {
      const { model } = await T.trainedModel();
      const ev = model.evaluation;
      T.fact('accuracy', ev.accuracy);
      T.fact('recall', ev.recall);
      T.fact('specificity', ev.specificity);
      T.fact('confusion', { tp: ev.tp, tn: ev.tn, fp: ev.fp, fn: ev.fn });
      T.fact('finalError', model.training.finalError);
      expect(ev.total).to.equal(200);
      expect(ev.accuracy).to.be.at.least(0.9);
      expect(ev.recall).to.be.at.least(0.9);
      expect(ev.specificity).to.be.at.least(0.9);
    });

    it('стабільність якості: 10 навчань з випадковою ініціалізацією ваг - медіана точності ≥ 95 %, найгірше навчання ≥ 90 %', async function () {
      this.timeout(180000);
      const ds = await T.dataset();
      const acc = [];
      for (let i = 0; i < 10; i++) {
        const m = await T.train(ds, { shuffleSeed: i + 1, weightSeed: null }); // справжній Math.random
        acc.push(m.training.testAccuracy);
      }
      acc.sort((a, b) => a - b);
      const median = (acc[4] + acc[5]) / 2;
      T.fact('stability', { min: acc[0], median, max: acc[9], all: acc });
      expect(median, 'медіана точності').to.be.at.least(0.95);
      expect(acc[0], 'найгірша точність').to.be.at.least(0.9);
    });

    it('мережа не перенавчена: точність на навчальній і тестовій вибірках відрізняється менше ніж на 5 п. п.', async () => {
      const { model } = await T.trainedModel();
      expect(Math.abs(model.training.trainAccuracy - model.training.testAccuracy)).to.be.below(0.05);
    });

    it('приклади зі статті: норма → «Нормальний ритм», нерегулярний ритм → «Аритмія»', async () => {
      const { model } = await T.trainedModel();
      const ex = HR.data.ARTICLE_EXAMPLES;
      const normal = model.predictSeries(ex.normal.values);
      const irregular = model.predictSeries(ex.irregular.values);
      T.fact('articleNormal', normal.probs[0]);
      T.fact('articleIrregular', irregular.probs[1]);
      expect(normal.label).to.equal('normal');
      expect(normal.windows).to.have.lengthOf(ex.normal.values.length - 3);
      expect(irregular.label).to.equal('arrhythmia');
      expect(irregular.confidence).to.be.above(0.7);
    });

    it('брадикардія і тахікардія зі статті - рівні інтервали, двокласова модель визначає їх як норму', async () => {
      const { model } = await T.trainedModel();
      expect(model.predictSeries(HR.data.ARTICLE_EXAMPLES.brady.values).label).to.equal('normal');
      expect(model.predictSeries(HR.data.ARTICLE_EXAMPLES.tachy.values).label).to.equal('normal');
    });

    it('нові випадкові послідовності (кнопки «Випадкова норма / аритмія»): 50 з 50 розпізнано правильно', async () => {
      const { model } = await T.trainedModel();
      const rng = new HR.Random(777);
      let correct = 0;
      for (let i = 0; i < 25; i++) {
        for (const label of HR.data.CLASSES) {
          const values = HR.data.exampleSeries(rng, T.params(), label, 8, 4);
          if (model.predictSeries(values).label === label) correct++;
        }
      }
      T.fact('randomCorrect', correct);
      expect(correct).to.equal(50);
    });

    it('модель після збереження у JSON і завантаження дає ту саму точність на тестовій вибірці', async () => {
      const { model, ds } = await T.trainedModel();
      const text = JSON.stringify(model.toJSON());
      const loaded = HR.RhythmModel.fromJSON(JSON.parse(text), 'model.json');
      const ev = await loaded.evaluate(ds.test);
      expect(ev.accuracy).to.equal(model.evaluation.accuracy);
      expect([ev.tp, ev.tn, ev.fp, ev.fn]).to.deep.equal([model.evaluation.tp, model.evaluation.tn, model.evaluation.fp, model.evaluation.fn]);
    });

    it('довжина K = 8: модель 8–8–2 навчається і розпізнає (точність ≥ 85 %); модель K = 4 відмовляється оцінювати набір K = 8', async () => {
      const ds8 = await T.dataset({ perClass: 300, length: 8 });
      const m8 = await T.train(ds8, { epochs: 300, shuffleSeed: 3 });
      const ev = await m8.evaluate(ds8.test);
      T.fact('accuracyK8', ev.accuracy);
      expect(ev.accuracy).to.be.at.least(0.85);
      expect(m8.predictSeries(HR.data.ARTICLE_EXAMPLES.irregular.values).label).to.equal('arrhythmia');
      const { model } = await T.trainedModel();
      await T.expectRejects(model.evaluate(ds8.test), 'не збігається');
    });
  });

  describe('розпізнавання → зображення результату → файл', () => {
    it('результат класифікації будується на зображенні і зберігається у PNG, JPG і BMP 1400 × 800', async () => {
      const { model } = await T.trainedModel();
      const bpm = HR.data.ARTICLE_EXAMPLES.irregular.values;
      const result = model.predictSeries(bpm);
      const canvas = document.createElement('canvas');
      HR.ecg.renderResult(canvas, { bpm, inputCount: bpm.length, units: 'bpm', result, model, warnings: [], normalRange: { min: 60, max: 100 }, createdAt: new Date() });
      expect(T.pixel(canvas, 1354, 53).slice(0, 3)).to.deep.equal(T.hexRgb(HR.charts.COLORS.arrhythmia));
      for (const format of ['png', 'jpg', 'bmp']) {
        const blob = await HR.imageExport.canvasToBlob(canvas, format);
        const img = await T.decodeImage(blob);
        expect([img.naturalWidth, img.naturalHeight], format).to.deep.equal([1400, 800]);
        T.fact(`imageSize_${format}`, blob.size);
        if (format === 'bmp') expect(blob.size).to.equal(HR.imageExport.bmpSize(1400, 800));
      }
    });

    it('графіки навчання навченої моделі зберігаються у PNG', async () => {
      const { model } = await T.trainedModel();
      const canvas = HR.charts.composeTrainingImage({ history: model.history, totalEpochs: 1000, title: 'Динаміка навчання', subtitle: '4–8–2' });
      const img = await T.decodeImage(await HR.imageExport.canvasToBlob(canvas, 'png'));
      expect(img.naturalWidth).to.equal(1400);
    });
  });
});
