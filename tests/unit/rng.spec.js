/* Модульні тести: генератор псевдовипадкових чисел (Application/js/rng.js) */
describe('Модульні тести', () => {
  describe('rng.js - відтворюваний генератор mulberry32', () => {
    const draw = (rng, n) => Array.from({ length: n }, () => rng.next());

    it('однакове зерно дає однакову послідовність чисел (відтворюваність набору)', () => {
      expect(draw(new HR.Random(42), 1000)).to.deep.equal(draw(new HR.Random(42), 1000));
    });

    it('різні зерна дають різні послідовності', () => {
      expect(draw(new HR.Random(42), 20)).to.not.deep.equal(draw(new HR.Random(43), 20));
    });

    it('next() повертає числа в [0; 1), середнє близьке до 0,5', () => {
      const values = draw(new HR.Random(1), 20000);
      expect(values.every((v) => v >= 0 && v < 1)).to.be.true;
      expect(HR.util.mean(values)).to.be.closeTo(0.5, 0.01);
    });

    it('int(min, max) повертає цілі числа включно з обома межами', () => {
      const rng = new HR.Random(5);
      const seen = new Set();
      for (let i = 0; i < 5000; i++) {
        const v = rng.int(60, 65);
        expect(Number.isInteger(v)).to.be.true;
        expect(v).to.be.within(60, 65);
        seen.add(v);
      }
      expect([...seen].sort()).to.deep.equal([60, 61, 62, 63, 64, 65]);
      expect(rng.int(7, 7)).to.equal(7);
    });

    it('float(min, max) повертає числа в [min; max)', () => {
      const rng = new HR.Random(9);
      for (let i = 0; i < 2000; i++) {
        const v = rng.float(-2, 3);
        expect(v).to.be.at.least(-2);
        expect(v).to.be.below(3);
      }
    });

    it('shuffle - перестановка: ті самі елементи, інший порядок, відтворювано за зерном', () => {
      const source = Array.from({ length: 50 }, (_, i) => i);
      const a = new HR.Random(3).shuffle(source.slice());
      const b = new HR.Random(3).shuffle(source.slice());
      expect(a).to.deep.equal(b);
      expect(a).to.not.deep.equal(source);
      expect(a.slice().sort((x, y) => x - y)).to.deep.equal(source);
      expect(new HR.Random(3).shuffle([])).to.deep.equal([]);
      expect(new HR.Random(3).shuffle([1])).to.deep.equal([1]);
    });

    it('зерно приводиться до 32-бітного беззнакового цілого; MAX_SEED = 4294967295 допустиме', () => {
      expect(new HR.Random(HR.MAX_SEED).seed).to.equal(4294967295);
      expect(new HR.Random(0).seed).to.equal(0);
      expect(draw(new HR.Random(HR.MAX_SEED), 3).every((v) => v >= 0 && v < 1)).to.be.true;
    });

    it('randomSeed() - ціле число від 0 до 10⁹, щоразу нове', () => {
      const seeds = Array.from({ length: 20 }, () => HR.randomSeed());
      expect(seeds.every((s) => Number.isInteger(s) && s >= 0 && s < 1e9)).to.be.true;
      expect(new Set(seeds).size).to.be.above(15);
    });
  });
});
