/* Зображення результату: ЕКГ-смужка (синтетичні комплекси PQRST у моменти
   R-зубців), гістограма RR-інтервалів і результат класифікації.
   Зображення на екрані й збережене у файл — те саме полотно 1400 × 800. */
(function (HR) {
  'use strict';

  const { fmtNum, fmtDec, countOf, formatDateTime, clamp } = HR.util;
  const { CLASS_NAMES } = HR.data;
  const C = HR.charts.COLORS;
  const font = HR.charts.font;

  const WIDTH = 1400;
  const HEIGHT = 800;
  const M = 36; // поля
  const ECG = {
    background: '#fffdfb',
    minor: '#f6dcd7',
    major: '#eab2aa',
    trace: '#1d1c1a',
    marker: '#c62f2f',
  };
  const TRACK = '#efeee9';

  const gauss = (x, mu, sigma) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2);

  // Синтетичний комплекс PQRST відносно R-зубця (dt у секундах, результат у мВ).
  // Положення зубця T трохи зміщується разом з тривалістю інтервалу.
  function beatValue(dt, rrNext) {
    const tWave = 0.24 * Math.sqrt(rrNext);
    return 0.12 * gauss(dt, -0.16, 0.025)
      - 0.10 * gauss(dt, -0.035, 0.010)
      + 1.15 * gauss(dt, 0, 0.011)
      - 0.22 * gauss(dt, 0.033, 0.011)
      + 0.28 * gauss(dt, tWave, 0.05);
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // Стовпець із заокругленим верхом і прямою основою
  function columnPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  function fitText(ctx, text, maxWidth) {
    return ctx.measureText(text).width <= maxWidth;
  }

  // ------------------------------------------------------------ ЕКГ-смужка

  function drawStrip(ctx, box, bpm) {
    const rr = bpm.map((v) => 60 / v); // секунди
    const rTimes = [0];
    for (const interval of rr) rTimes.push(rTimes[rTimes.length - 1] + interval);
    const tStart = -0.5;
    const tEnd = rTimes[rTimes.length - 1] + 0.6;
    const pxPerSec = box.w / (tEnd - tStart);
    const pxPerMm = pxPerSec * 0.04; // 25 мм/с: 1 мм = 0,04 с
    const pxPerMv = clamp(10 * pxPerMm, 60, 135);
    const baseline = box.y + box.h * 0.66;
    const tx = (t) => box.x + (t - tStart) * pxPerSec;

    ctx.save();
    roundRectPath(ctx, box.x, box.y, box.w, box.h, 8);
    ctx.fillStyle = ECG.background;
    ctx.fill();
    ctx.clip();

    // міліметрова сітка: дрібні лінії — 1 мм, великі — 5 мм (0,2 с)
    ctx.lineWidth = 1;
    const drawGrid = (stepPx, color) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = tx(0) - Math.ceil((tx(0) - box.x) / stepPx) * stepPx; x <= box.x + box.w; x += stepPx) {
        ctx.moveTo(Math.round(x) + 0.5, box.y);
        ctx.lineTo(Math.round(x) + 0.5, box.y + box.h);
      }
      for (let y = baseline - Math.ceil((baseline - box.y) / stepPx) * stepPx; y <= box.y + box.h; y += stepPx) {
        ctx.moveTo(box.x, Math.round(y) + 0.5);
        ctx.lineTo(box.x + box.w, Math.round(y) + 0.5);
      }
      ctx.stroke();
    };
    if (pxPerMm >= 4) drawGrid(pxPerMm, ECG.minor);
    drawGrid(pxPerMm * 5, ECG.major);

    // крива ЕКГ
    ctx.strokeStyle = ECG.trace;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let px = 0; px <= box.w; px += 1) {
      const t = tStart + px / pxPerSec;
      let v = 0;
      for (let i = 0; i < rTimes.length; i++) {
        const dt = t - rTimes[i];
        if (dt < -0.3 || dt > 0.55) continue;
        v += beatValue(dt, rr[Math.min(i, rr.length - 1)]);
      }
      const y = baseline - v * pxPerMv;
      if (px === 0) ctx.moveTo(box.x + px, y);
      else ctx.lineTo(box.x + px, y);
    }
    ctx.stroke();

    // номери R-зубців і червоні мітки над ними (як на рисунках статті)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = font(17, 650);
    rTimes.forEach((t, i) => {
      const x = tx(t);
      ctx.fillStyle = C.ink;
      ctx.fillText(String(i + 1), x, box.y + 8);
      ctx.strokeStyle = ECG.marker;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, box.y + 30);
      ctx.lineTo(x, box.y + 44);
      ctx.stroke();
    });

    // інтервали між сусідніми R-зубцями; формат підпису однаковий для всіх
    // інтервалів: найдовший, що вміщується в найвужчий проміжок
    const labelFormats = [
      (i) => `${fmtNum(bpm[i], 0)} уд/хв · ${fmtNum(rr[i] * 1000, 0)} мс`,
      (i) => `${fmtNum(bpm[i], 0)} уд/хв`,
      (i) => fmtNum(bpm[i], 0),
    ];
    ctx.font = font(16, 600);
    const room = (i) => tx(rTimes[i + 1]) - tx(rTimes[i]) - 12;
    const labelFormat = labelFormats.find((f) => rr.every((_, i) => fitText(ctx, f(i), room(i)))) || null;
    const bracketY = box.y + box.h - 40;
    for (let i = 0; i < rr.length; i++) {
      const x0 = tx(rTimes[i]);
      const x1 = tx(rTimes[i + 1]);
      ctx.strokeStyle = C.ink2;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0 + 3, bracketY - 5);
      ctx.lineTo(x0 + 3, bracketY + 5);
      ctx.moveTo(x0 + 3, bracketY);
      ctx.lineTo(x1 - 3, bracketY);
      ctx.moveTo(x1 - 3, bracketY - 5);
      ctx.lineTo(x1 - 3, bracketY + 5);
      ctx.stroke();
      if (labelFormat) {
        ctx.fillStyle = C.ink;
        ctx.textBaseline = 'top';
        ctx.fillText(labelFormat(i), (x0 + x1) / 2, bracketY + 8);
      }
    }
    ctx.restore();

    // рамка і шкала часу під смужкою (позначки секунд не налазять на підпис масштабу)
    ctx.save();
    roundRectPath(ctx, box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, 8);
    ctx.strokeStyle = ECG.major;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.font = font(13);
    ctx.textBaseline = 'top';
    const caption = labelFormat === labelFormats[2]
      ? '25 мм/с · клітинка 0,04 с · підписи інтервалів — ЧСС, уд/хв'
      : '25 мм/с · клітинка 0,04 с';
    ctx.textAlign = 'right';
    ctx.fillText(caption, box.x + box.w, box.y + box.h + 6);
    const captionLeft = box.x + box.w - ctx.measureText(caption).width - 14;
    ctx.textAlign = 'center';
    const lastSecond = Math.floor(rTimes[rTimes.length - 1]);
    const everySec = pxPerSec < 60 ? 2 : 1;
    for (let s = 0; s <= lastSecond; s += everySec) {
      const label = `${s} с`;
      if (tx(s) + ctx.measureText(label).width / 2 > captionLeft) break;
      ctx.fillText(label, tx(s), box.y + box.h + 6);
    }
    ctx.restore();

    return { duration: rTimes[rTimes.length - 1], beats: rTimes.length };
  }

  // ------------------------------------------------------------ Гістограма RR

  function drawHistogram(ctx, box, bpm, normalRange) {
    ctx.save();
    ctx.fillStyle = C.ink;
    ctx.font = font(19, 650);
    ctx.textBaseline = 'top';
    ctx.fillText('Інтервали між R-зубцями', box.x, box.y);
    ctx.fillStyle = C.ink2;
    ctx.font = font(14);
    ctx.fillText('висота стовпця — тривалість RR, мс; підпис — ЧСС, уд/хв', box.x, box.y + 28);

    const area = { x: box.x + 54, y: box.y + 86, w: box.w - 54 - 8, h: box.h - 86 - 34 };
    const rr = bpm.map((v) => 60000 / v);
    const yMax = Math.max(1400, Math.ceil((Math.max(...rr) + 100) / 200) * 200);
    const yToPx = (v) => area.y + (1 - v / yMax) * area.h;

    // діапазон нормальної ЧСС — світла смуга кольору класу «норма»; підпис у легенді
    if (normalRange) {
      const top = yToPx(60000 / normalRange.min);
      const bottom = yToPx(60000 / normalRange.max);
      ctx.fillStyle = '#e8f1fc';
      ctx.fillRect(area.x, top, area.w, bottom - top);
      ctx.fillRect(box.x, box.y + 52, 22, 14);
      ctx.strokeStyle = '#9ec5f4';
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x + 0.5, box.y + 52.5, 21, 13);
      ctx.fillStyle = C.ink2;
      ctx.font = font(13);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`діапазон нормальної ЧСС ${normalRange.min}–${normalRange.max} уд/хв (RR ${fmtNum(60000 / normalRange.max, 0)}–${fmtNum(60000 / normalRange.min, 0)} мс)`, box.x + 30, box.y + 59);
    }

    const ticks = HR.charts.linearTicks(0, yMax, 5);
    ctx.font = font(13);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (const t of ticks) {
      const y = Math.round(yToPx(t)) + 0.5;
      ctx.strokeStyle = t === 0 ? C.axis : C.grid;
      ctx.beginPath();
      ctx.moveTo(area.x, y);
      ctx.lineTo(area.x + area.w, y);
      ctx.stroke();
      ctx.fillStyle = C.muted;
      ctx.fillText(fmtNum(t, 0), area.x - 8, y);
    }

    const n = rr.length;
    const slot = area.w / n;
    const barW = Math.min(44, slot * 0.62);
    const labelEach = n <= 16;
    for (let i = 0; i < n; i++) {
      const cx = area.x + slot * (i + 0.5);
      const y = yToPx(rr[i]);
      columnPath(ctx, cx - barW / 2, y, barW, area.y + area.h - y, 4);
      ctx.fillStyle = C.ink2;
      ctx.fill();
      if (labelEach) {
        ctx.fillStyle = C.ink;
        ctx.font = font(14, 600);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(fmtNum(bpm[i], 0), cx, y - 5);
        ctx.fillStyle = C.muted;
        ctx.font = font(13);
        ctx.textBaseline = 'top';
        ctx.fillText(String(i + 1), cx, area.y + area.h + 6);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ Результат

  function drawProbabilityBar(ctx, x, y, w, label, prob, color) {
    const labelW = 190;
    const valueW = 92;
    const trackX = x + labelW;
    const trackW = w - labelW - valueW;
    ctx.fillStyle = C.ink;
    ctx.font = font(17, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 11);
    roundRectPath(ctx, trackX, y, trackW, 22, 4);
    ctx.fillStyle = TRACK;
    ctx.fill();
    if (prob > 0) {
      roundRectPath(ctx, trackX, y, Math.max(6, trackW * prob), 22, 4);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.fillStyle = C.ink;
    ctx.font = font(17, 650);
    ctx.textAlign = 'right';
    ctx.fillText(`${fmtNum(prob * 100, 1)} %`, x + w, y + 11);
  }

  function drawWindowChart(ctx, box, windows) {
    ctx.fillStyle = C.ink2;
    ctx.font = font(14);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Ймовірність аритмії в кожному вікні (поріг 50 %)', box.x, box.y);
    const area = { x: box.x, y: box.y + 26, w: box.w, h: box.h - 26 - 20 };
    const n = windows.length;
    const slot = area.w / n;
    const barW = Math.min(28, slot * 0.7);
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(area.x, Math.round(area.y + area.h) + 0.5);
    ctx.lineTo(area.x + area.w, Math.round(area.y + area.h) + 0.5);
    ctx.stroke();
    windows.forEach((win, i) => {
      const p = win.probs[1];
      const h = Math.max(2, p * area.h);
      const cx = area.x + slot * (i + 0.5);
      columnPath(ctx, cx - barW / 2, area.y + area.h - h, barW, h, 3);
      ctx.fillStyle = win.label === 'arrhythmia' ? C.arrhythmia : C.normal;
      ctx.fill();
      if (n <= 20) {
        ctx.fillStyle = C.muted;
        ctx.font = font(12);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(String(i + 1), cx, area.y + area.h + 4);
      }
    });
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = C.ink2;
    const y50 = Math.round(area.y + area.h / 2) + 0.5;
    ctx.beginPath();
    ctx.moveTo(area.x, y50);
    ctx.lineTo(area.x + area.w, y50);
    ctx.stroke();
    ctx.restore();
  }

  function drawResultPanel(ctx, box, data) {
    const { result, model, warnings } = data;
    ctx.save();
    ctx.fillStyle = C.ink;
    ctx.font = font(19, 650);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Результат класифікації', box.x, box.y);

    if (!result) {
      ctx.fillStyle = C.ink2;
      ctx.font = font(16);
      const lines = [
        'Класифікацію не виконано.',
        'Навчіть модель (крок 2) або завантажте збережену,',
        'потім натисніть «Розпізнати».',
      ];
      lines.forEach((line, i) => ctx.fillText(line, box.x, box.y + 44 + i * 26));
      ctx.restore();
      return;
    }

    drawProbabilityBar(ctx, box.x, box.y + 46, box.w, CLASS_NAMES.normal, result.probs[0], C.normal);
    drawProbabilityBar(ctx, box.x, box.y + 84, box.w, CLASS_NAMES.arrhythmia, result.probs[1], C.arrhythmia);

    ctx.fillStyle = C.ink2;
    ctx.font = font(15);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const wins = result.windows.length;
    ctx.fillText(`Вікон по K = ${model.windowSize}: ${wins} · визнано аритмією: ${result.arrhythmicWindows} з ${wins}`, box.x, box.y + 124);

    // висота графіка вікон залежить від того, скільки місця займуть попередження
    const shownWarnings = (warnings || []).slice(0, 2);
    const infoLineH = 30;
    let y = box.y + 156;
    if (wins > 1) {
      const chartH = Math.max(80, box.h - 156 - infoLineH - shownWarnings.length * 24 - 8);
      drawWindowChart(ctx, { x: box.x, y, w: box.w, h: chartH }, result.windows);
      y += chartH + 8;
    }
    ctx.fillStyle = '#7a5000';
    ctx.font = font(14, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (const w of shownWarnings) {
      let text = `⚠ ${w.short}`;
      while (ctx.measureText(text).width > box.w && text.length > 10) text = `${text.slice(0, -2)}…`;
      ctx.fillText(text, box.x, y);
      y += 24;
    }

    const t = model.training;
    const parts = [`Мережа ${model.architecture}`];
    if (t) {
      parts.push(`епох: ${fmtNum(t.epochsDone, 0)}`);
      parts.push(`швидкість навчання ${fmtDec(t.learningRate)}`);
    }
    const acc = model.evaluation ? model.evaluation.accuracy : t && t.testAccuracy;
    if (Number.isFinite(acc)) parts.push(`точність на тесті ${fmtNum(acc * 100, 1)} %`);
    ctx.fillStyle = C.muted;
    ctx.font = font(14);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(parts.join(' · '), box.x, box.y + box.h);
    ctx.restore();
  }

  // ------------------------------------------------------------ Компонування

  function drawVerdict(ctx, result) {
    ctx.save();
    ctx.font = font(22, 700);
    let text;
    let fill;
    let color;
    if (result) {
      text = `${CLASS_NAMES[result.label].toUpperCase()} · ${fmtNum(result.confidence * 100, 1)} %`;
      fill = result.label === 'normal' ? C.normal : C.arrhythmia;
      color = '#ffffff';
    } else {
      text = 'НЕ КЛАСИФІКОВАНО';
      fill = TRACK;
      color = C.ink2;
    }
    const w = ctx.measureText(text).width + 40;
    const x = WIDTH - M - w;
    roundRectPath(ctx, x, 30, w, 44, 22);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, 53);
    ctx.restore();
    return w;
  }

  function renderResult(canvas, data) {
    const { bpm, inputCount, units, result, normalRange, createdAt } = data;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const verdictW = drawVerdict(ctx, result);

    const rr = bpm.map((v) => 60 / v);
    const duration = rr.reduce((a, b) => a + b, 0);
    ctx.fillStyle = C.ink;
    ctx.font = font(30, 700);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('ЕКГ-смужка та результат розпізнавання', M, 26);
    ctx.fillStyle = C.ink2;
    ctx.font = font(17);
    const unitText = units === 'ms' ? 'RR-інтервали, мс' : 'ЧСС, уд/хв';
    const sub = `Вхід: ${countOf(inputCount, 'значення', 'значення', 'значень')} (${unitText}) · R-зубців: ${bpm.length + 1} · тривалість ${fmtNum(duration, 2)} с · ${formatDateTime(createdAt)}`;
    let subText = sub;
    while (ctx.measureText(subText).width > WIDTH - M * 2 - verdictW - 24 && subText.length > 20) {
      subText = `${subText.slice(0, -2)}…`;
    }
    ctx.fillText(subText, M, 68);

    drawStrip(ctx, { x: M, y: 108, w: WIDTH - M * 2, h: 300 }, bpm);
    const half = (WIDTH - M * 2 - 48) / 2;
    drawHistogram(ctx, { x: M, y: 448, w: half, h: 324 }, bpm, normalRange);
    drawResultPanel(ctx, { x: M + half + 48, y: 448, w: half, h: 324 }, data);

    // тонкий розділювач між нижніми панелями
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(M + half + 24 + 0.5, 452);
    ctx.lineTo(M + half + 24 + 0.5, HEIGHT - 28);
    ctx.stroke();

    return { width: WIDTH, height: HEIGHT };
  }

  HR.ecg = { renderResult, WIDTH, HEIGHT };
})(window.HR = window.HR || {});
