/* Модульні тести: збереження зображення у PNG, JPG, BMP (Application/js/image-export.js) */
describe('Модульні тести', () => {
  describe('image-export.js - кодування зображень', () => {
    const X = HR.imageExport;

    // Полотно 3 × 2: верхній рядок червоний, зелений, синій; нижній - білий, чорний, прозорий
    function testCanvas() {
      const c = document.createElement('canvas');
      c.width = 3;
      c.height = 2;
      const ctx = c.getContext('2d');
      [['#ff0000', 0, 0], ['#00ff00', 1, 0], ['#0000ff', 2, 0], ['#ffffff', 0, 1], ['#000000', 1, 1]].forEach(([color, x, y]) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      });
      return c; // піксель (2, 1) лишається прозорим
    }

    it('bmpSize: 54 Б заголовків + рядки, вирівняні до 4 байтів', () => {
      expect(X.bmpSize(1400, 800)).to.equal(54 + 4200 * 800);
      expect(X.bmpSize(3, 2)).to.equal(54 + 12 * 2); // 9 Б даних + 3 Б вирівнювання
      expect(X.bmpSize(1, 1)).to.equal(58);
    });

    it('encodeBmp: заголовки BITMAPFILEHEADER і BITMAPINFOHEADER для 24-бітного BMP', async () => {
      const blob = X.encodeBmp(testCanvas());
      const b = await T.bytesOf(blob);
      const view = new DataView(b.buffer);
      expect(blob.type).to.equal('image/bmp');
      expect(String.fromCharCode(b[0], b[1])).to.equal('BM');
      expect(view.getUint32(2, true)).to.equal(b.length);
      expect(b.length).to.equal(X.bmpSize(3, 2));
      expect(view.getUint32(10, true)).to.equal(54);
      expect(view.getUint32(14, true)).to.equal(40);
      expect(view.getInt32(18, true)).to.equal(3);
      expect(view.getInt32(22, true)).to.equal(2);
      expect(view.getUint16(26, true)).to.equal(1);
      expect(view.getUint16(28, true)).to.equal(24);
      expect(view.getUint32(30, true)).to.equal(0);
      expect(view.getUint32(34, true)).to.equal(24);
    });

    it('encodeBmp: рядки знизу вгору, порядок байтів B, G, R, нулі вирівнювання, прозорий піксель - білий', async () => {
      const b = await T.bytesOf(X.encodeBmp(testCanvas()));
      // перший рядок у файлі - нижній рядок зображення: білий, чорний, прозорий→білий
      expect(Array.from(b.slice(54, 66))).to.deep.equal([255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 0]);
      // другий рядок - верхній: червоний (B=0, G=0, R=255), зелений, синій
      expect(Array.from(b.slice(66, 78))).to.deep.equal([0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0]);
    });

    it('BMP, PNG і JPG декодуються браузером з тими самими розмірами', async () => {
      const c = document.createElement('canvas');
      c.width = 31;
      c.height = 17;
      for (const format of ['bmp', 'png', 'jpg']) {
        const img = await T.decodeImage(await X.canvasToBlob(c, format));
        expect([img.naturalWidth, img.naturalHeight], format).to.deep.equal([31, 17]);
      }
    });

    it('canvasToBlob: сигнатури файлів PNG (89 50 4E 47) і JPG (FF D8 FF), MIME-типи', async () => {
      const c = testCanvas();
      const png = await X.canvasToBlob(c, 'png');
      expect(Array.from((await T.bytesOf(png)).slice(0, 8))).to.deep.equal([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(png.type).to.equal('image/png');
      const jpg = await X.canvasToBlob(c, 'jpg');
      expect(Array.from((await T.bytesOf(jpg)).slice(0, 3))).to.deep.equal([0xff, 0xd8, 0xff]);
      expect(jpg.type).to.equal('image/jpeg');
    });

    it('JPG не має прозорості: прозорі ділянки стають білими, а не чорними', async () => {
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8; // повністю прозоре полотно
      const img = await T.decodeImage(await X.canvasToBlob(c, 'jpg'));
      const out = document.createElement('canvas');
      out.width = 8;
      out.height = 8;
      out.getContext('2d').drawImage(img, 0, 0);
      const [r, g, b] = T.pixel(out, 4, 4);
      expect(Math.min(r, g, b)).to.be.above(245);
    });

    it('непідтримуваний формат (gif) - відхилена Promise з поясненням', async () => {
      await T.expectRejects(X.canvasToBlob(testCanvas(), 'gif'), 'Непідтримуваний формат зображення: gif');
    });

    it('FORMATS: розширення і підписи форматів для імен файлів', () => {
      expect(Object.keys(X.FORMATS)).to.deep.equal(['png', 'jpg', 'bmp']);
      expect(X.FORMATS.jpg.ext).to.equal('jpg');
      expect(X.FORMATS.bmp.label).to.equal('BMP');
    });
  });
});
