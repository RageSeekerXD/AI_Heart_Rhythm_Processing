/* Модульні тести: нейронна мережа RhythmModel (Application/js/model.js) */
describe('Модульні тести', () => {
  const makeModel = (opts = {}) => new HR.RhythmModel({
    windowSize: 4, hiddenLayers: [8], encoding: { min: 40, max: 130 }, trainRange: { min: 52, max: 120 }, ...opts,
  });

  // Заглушка мережі: повертає задані виходи залежно від першого значення вікна
  const stubNet = (fn) => ({ run: (input) => fn(input) });

  describe('model.js - кодування входів і виходів, архітектура', () => {
    it('encodingFor: межі нормування з запасом 10 уд/хв, округлені до десятків', () => {
      const r = HR.RhythmModel.encodingFor([{ bpm: [52, 70] }, { bpm: [120, 64] }]);
      expect(r.encoding).to.deep.equal({ min: 40, max: 130 });
      expect(r.trainRange).to.deep.equal({ min: 52, max: 120 });
    });

    it('encode: мін-макс нормування в [0; 1] з обмеженням значень поза межами', () => {
      const m = makeModel();
      expect(m.encode([40, 85, 130])).to.deep.equal([0, 0.5, 1]);
      expect(m.encode([20, 300])).to.deep.equal([0, 1]);
    });

    it('target: унітарне кодування - норма [1, 0], аритмія [0, 1]', () => {
      const m = makeModel();
      expect(m.target('normal')).to.deep.equal([1, 0]);
      expect(m.target('arrhythmia')).to.deep.equal([0, 1]);
    });

    it('архітектура і кількість параметрів: 4–8–2 → 58, 4–12–6–2 → 152', () => {
      const a = makeModel();
      expect(a.architecture).to.equal('4–8–2');
      expect(a.parameterCount).to.equal(8 * 5 + 2 * 9);
      const b = makeModel({ hiddenLayers: [12, 6] });
      expect(b.sizes).to.deep.equal([4, 12, 6, 2]);
      expect(b.parameterCount).to.equal(12 * 5 + 6 * 13 + 2 * 7);
    });
  });

  describe('model.js - класифікація вікна і ковзне вікно', () => {
    it('predictWindow: ймовірності нормуються до суми 1, клас - найбільша ймовірність', () => {
      const m = makeModel();
      m.net = stubNet(() => [0.2, 0.6]);
      const p = m.predictWindow([70, 72, 70, 72]);
      expect(p.probs[0]).to.be.closeTo(0.25, 1e-12);
      expect(p.probs[1]).to.be.closeTo(0.75, 1e-12);
      expect(p.label).to.equal('arrhythmia');
      expect(p.confidence).to.be.closeTo(0.75, 1e-12);
    });

    it('predictWindow: нульові виходи мережі дають рівні ймовірності, а не NaN', () => {
      const m = makeModel();
      m.net = stubNet(() => [0, 0]);
      const p = m.predictWindow([70, 72, 70, 72]);
      expect(p.probs).to.deep.equal([0.5, 0.5]);
      expect(p.label).to.equal('normal');
    });

    it('predictSeries: n значень → n − K + 1 вікон зі зсувом 1, ймовірності усереднюються', () => {
      const m = makeModel();
      m.net = stubNet((x) => (x[0] > 0.5 ? [0.1, 0.9] : [0.9, 0.1])); // перше значення > 85 уд/хв → аритмія
      const r = m.predictSeries([70, 70, 70, 70, 100, 70, 70]);
      expect(r.windows).to.have.lengthOf(4);
      expect(r.windows.map((w) => w.start)).to.deep.equal([0, 1, 2, 3]);
      expect(r.windows[3].values).to.deep.equal([70, 100, 70, 70]);
      expect(r.arrhythmicWindows).to.equal(0);
      expect(r.label).to.equal('normal');
      const r2 = m.predictSeries([100, 70, 100, 70, 100]);
      expect(r2.arrhythmicWindows).to.equal(1);
      expect(r2.probs[1]).to.be.closeTo((0.9 + 0.1) / 2, 1e-12);
    });

    it('predictSeries: рівно K значень - одне вікно (граничний випадок)', () => {
      const m = makeModel();
      m.net = stubNet(() => [0.7, 0.3]);
      const r = m.predictSeries([70, 72, 70, 72]);
      expect(r.windows).to.have.lengthOf(1);
      expect(r.confidence).to.be.closeTo(0.7, 1e-12);
    });

    it('predictSeries: менше K значень - зрозуміла помилка', () => {
      const m = makeModel();
      m.net = stubNet(() => [0.7, 0.3]);
      T.expectThrows(() => m.predictSeries([70, 72, 70]), 'Потрібно щонайменше 4 значення');
    });
  });

  describe('model.js - навчання train()', () => {
    let small;
    before(async () => { small = await T.dataset({ perClass: 50 }); });
    const fresh = () => {
      const { encoding, trainRange } = HR.RhythmModel.encodingFor(small.train);
      return makeModel({ encoding, trainRange });
    };
    const opts = (o = {}) => ({ epochs: 5, learningRate: 0.3, momentum: 0.1, shuffleSeed: 1, ...o });

    it('виконує задану кількість епох і записує історію помилки й точності', async () => {
      const m = fresh();
      const t = await m.train(small.train, small.test, opts());
      expect(t.epochsDone).to.equal(5);
      expect(t.stopReason).to.equal('completed');
      expect(m.history.epoch).to.deep.equal([1, 2, 3, 4, 5]);
      expect(m.history.error.every((e) => Number.isFinite(e) && e > 0)).to.be.true;
      expect(m.history.evalEpoch[0]).to.equal(1);
      expect(m.history.evalEpoch[m.history.evalEpoch.length - 1]).to.equal(5);
      expect(t.trainAccuracy).to.be.within(0, 1);
      expect(t.trainSamples).to.equal(80);
    });

    it('мінімальна кількість епох (1) - граничний випадок', async () => {
      const m = fresh();
      const t = await m.train(small.train, small.test, opts({ epochs: 1 }));
      expect(t.epochsDone).to.equal(1);
      expect(m.history.error).to.have.lengthOf(1);
      expect(m.history.evalEpoch).to.deep.equal([1]);
    });

    it('зупинка користувачем: навчання переривається після поточної епохи', async () => {
      const m = fresh();
      let calls = 0;
      const t = await m.train(small.train, small.test, opts({ epochs: 1000 }), { shouldStop: () => ++calls >= 3 });
      expect(t.epochsDone).to.equal(3);
      expect(t.stopReason).to.equal('stopped');
    });

    it('рання зупинка: досягнуто цільової помилки', async () => {
      const m = fresh();
      const t = await m.train(small.train, small.test, opts({ epochs: 500, errorThresh: 0.45 }));
      expect(t.stopReason).to.equal('threshold');
      expect(t.epochsDone).to.be.below(500);
      expect(t.finalError).to.be.at.most(0.45);
    });

    it('викликає onEpoch для кожної епохи та onFrame хоча б раз (для прогрес-бару)', async () => {
      const m = fresh();
      const epochs = [];
      let frames = 0;
      await m.train(small.train, small.test, opts({ epochs: 7 }), { onEpoch: (e) => epochs.push(e), onFrame: () => frames++ });
      expect(epochs).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);
      expect(frames).to.be.at.least(1);
    });

    it('порожня тестова вибірка не заважає навчанню (точність на тесті - NaN)', async () => {
      const m = fresh();
      const t = await m.train(small.train, [], opts({ epochs: 2 }));
      expect(t.testAccuracy).to.be.NaN;
      expect(t.testSamples).to.equal(0);
    });
  });

  describe('model.js - оцінювання evaluate() і метрики', () => {
    // 10 прикладів: TP = 4, FN = 1, TN = 3, FP = 2
    const samples = [];
    const add = (label, predictArr, n) => {
      for (let i = 0; i < n; i++) samples.push({ label, bpm: [predictArr ? 120 : 50, 70, 70, 70] });
    };
    add('arrhythmia', true, 4);
    add('arrhythmia', false, 1);
    add('normal', false, 3);
    add('normal', true, 2);
    const model = () => {
      const m = makeModel();
      m.net = stubNet((x) => (x[0] > 0.5 ? [0.2, 0.8] : [0.8, 0.2]));
      return m;
    };

    it('матриця помилок і метрики збігаються з розрахованими вручну', async () => {
      const ev = await model().evaluate(samples);
      expect([ev.tp, ev.fn, ev.tn, ev.fp]).to.deep.equal([4, 1, 3, 2]);
      expect(ev.accuracy).to.be.closeTo(0.7, 1e-12);
      expect(ev.precision).to.be.closeTo(4 / 6, 1e-12);
      expect(ev.recall).to.be.closeTo(0.8, 1e-12);
      expect(ev.specificity).to.be.closeTo(0.6, 1e-12);
      expect(ev.f1).to.be.closeTo((2 * (4 / 6) * 0.8) / (4 / 6 + 0.8), 1e-12);
      expect(ev.crossEntropy).to.be.closeTo((7 * -Math.log(0.8) + 3 * -Math.log(0.2)) / 10, 1e-9);
      expect(ev.misclassified).to.have.lengthOf(3);
      expect(ev.total).to.equal(10);
    });

    it('прогрес оцінювання завершується на (n, n)', async () => {
      const calls = [];
      await model().evaluate(samples, { onProgress: (d, t) => calls.push([d, t]) });
      expect(calls[calls.length - 1]).to.deep.equal([10, 10]);
    });

    it('граничний випадок: мережа ніколи не прогнозує аритмію - влучність і F1 = NaN без винятку', async () => {
      const m = makeModel();
      m.net = stubNet(() => [0.9, 0.1]);
      const ev = await m.evaluate(samples);
      expect(ev.tp + ev.fp).to.equal(0);
      expect(ev.precision).to.be.NaN;
      expect(ev.f1).to.be.NaN;
      expect(ev.recall).to.equal(0);
      expect(ev.accuracy).to.be.closeTo(0.5, 1e-12);
    });

    it('порожня тестова вибірка і невідповідна довжина вікна - зрозумілі помилки', async () => {
      await T.expectRejects(model().evaluate([]), 'Тестова вибірка порожня');
      await T.expectRejects(model().evaluate([{ label: 'normal', bpm: [70, 70, 70, 70, 70, 70, 70, 70] }]), 'не збігається з кількістю входів мережі (4)');
    });
  });

  describe('model.js - збереження і завантаження моделі toJSON() / fromJSON()', () => {
    it('toJSON містить формат, архітектуру, нормування, історію і мережу brain.js', async () => {
      const { model } = await T.trainedModel();
      const json = JSON.parse(JSON.stringify(model.toJSON()));
      expect(json.format).to.equal('hr-rhythm-model');
      expect(json.windowSize).to.equal(4);
      expect(json.hiddenLayers).to.deep.equal([8]);
      expect(json.encoding).to.deep.equal(model.encoding);
      expect(json.network.type).to.equal('NeuralNetwork');
      expect(json.network.sizes).to.deep.equal([4, 8, 2]);
      expect(json.history.epoch).to.have.lengthOf(1000);
      expect(json.evaluation).to.not.have.property('misclassified');
      expect(json.evaluation.misclassifiedCount).to.be.a('number');
    });

    it('fromJSON(toJSON()) відновлює модель з ідентичними виходами мережі', async () => {
      const { model, ds } = await T.trainedModel();
      const copy = HR.RhythmModel.fromJSON(JSON.parse(JSON.stringify(model.toJSON())), 'model.json');
      expect(copy.architecture).to.equal('4–8–2');
      expect(copy.source).to.equal('file');
      expect(copy.fileName).to.equal('model.json');
      for (const s of ds.test.slice(0, 100)) {
        expect(copy.predictWindow(s.bpm).raw).to.deep.equal(model.predictWindow(s.bpm).raw);
      }
    });

    describe('некоректні файли моделі', () => {
      let good;
      before(async () => { good = JSON.parse(JSON.stringify((await T.trainedModel()).model.toJSON())); });
      const broken = (mutate) => {
        const j = JSON.parse(JSON.stringify(good));
        mutate(j);
        return () => HR.RhythmModel.fromJSON(j);
      };

      it('не об’єкт або інший формат файлу', () => {
        T.expectThrows(() => HR.RhythmModel.fromJSON(null), 'Це не файл моделі');
        T.expectThrows(() => HR.RhythmModel.fromJSON({ format: 'hr-rhythm-dataset' }), 'Це не файл моделі');
      });

      it('немає мережі або це інший тип мережі brain.js', () => {
        T.expectThrows(broken((j) => { delete j.network; }), 'немає мережі');
        T.expectThrows(broken((j) => { j.network.type = 'LSTM'; }), 'немає мережі');
      });

      it('розміри шарів не відповідають опису моделі (K або кількість класів)', () => {
        T.expectThrows(broken((j) => { j.windowSize = 8; }), 'не відповідають');
        T.expectThrows(broken((j) => { j.network.sizes[2] = 3; }), 'не відповідають');
      });

      it('некоректні межі нормування (відсутні, min ≥ max)', () => {
        T.expectThrows(broken((j) => { delete j.encoding; }), 'межі нормування');
        T.expectThrows(broken((j) => { j.encoding = { min: 100, max: 100 }; }), 'межі нормування');
        T.expectThrows(broken((j) => { j.encoding.min = 'a'; }), 'межі нормування');
      });
    });
  });
});
