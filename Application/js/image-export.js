/* Збереження полотна (canvas) у форматах PNG, JPG і BMP.
   PNG і JPG кодує сам браузер, BMP — власний кодувальник нижче,
   бо canvas.toBlob() формат BMP не підтримує. */
(function (HR) {
  'use strict';

  const FORMATS = {
    png: { mime: 'image/png', ext: 'png', label: 'PNG' },
    jpg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG' },
    bmp: { mime: 'image/bmp', ext: 'bmp', label: 'BMP' },
  };

  // 24-бітний BMP: заголовки BITMAPFILEHEADER (14 Б) + BITMAPINFOHEADER (40 Б),
  // рядки пікселів знизу вгору у порядку B, G, R, кожен рядок вирівняний до 4 байтів.
  function bmpSize(width, height) {
    return 54 + Math.ceil((width * 3) / 4) * 4 * height;
  }

  function encodeBmp(canvas) {
    const { width, height } = canvas;
    const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const fileSize = bmpSize(width, height);
    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);

    view.setUint8(0, 0x42); // 'B'
    view.setUint8(1, 0x4d); // 'M'
    view.setUint32(2, fileSize, true);
    view.setUint32(10, 54, true); // зміщення до пікселів
    view.setUint32(14, 40, true); // розмір BITMAPINFOHEADER
    view.setInt32(18, width, true);
    view.setInt32(22, height, true); // додатна висота — рядки знизу вгору
    view.setUint16(26, 1, true); // кількість площин
    view.setUint16(28, 24, true); // біт на піксель
    view.setUint32(30, 0, true); // без стиснення (BI_RGB)
    view.setUint32(34, rowSize * height, true);
    view.setInt32(38, 2835, true); // 72 dpi
    view.setInt32(42, 2835, true);

    const bytes = new Uint8Array(buffer);
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width * 4;
      let dst = 54 + y * rowSize;
      for (let x = 0; x < width; x++) {
        const i = src + x * 4;
        const alpha = data[i + 3] / 255;
        // прозорі пікселі змішуються з білим тлом
        bytes[dst++] = Math.round(data[i + 2] * alpha + 255 * (1 - alpha));
        bytes[dst++] = Math.round(data[i + 1] * alpha + 255 * (1 - alpha));
        bytes[dst++] = Math.round(data[i] * alpha + 255 * (1 - alpha));
      }
    }
    return new Blob([buffer], { type: FORMATS.bmp.mime });
  }

  // JPG не має прозорості, тому підкладаємо біле тло
  function withWhiteBackground(canvas) {
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    return out;
  }

  function canvasToBlob(canvas, format, quality = 0.92) {
    const spec = FORMATS[format];
    if (!spec) return Promise.reject(new Error(`Непідтримуваний формат зображення: ${format}`));
    if (format === 'bmp') {
      try {
        return Promise.resolve(encodeBmp(canvas));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    const source = format === 'jpg' ? withWhiteBackground(canvas) : canvas;
    return new Promise((resolve, reject) => {
      source.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Браузер не зміг закодувати зображення.'));
      }, spec.mime, quality);
    });
  }

  HR.imageExport = { FORMATS, canvasToBlob, encodeBmp, bmpSize };
})(window.HR = window.HR || {});
