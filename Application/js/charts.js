/* Графіки на canvas: помилка й точність навчання, діаграма розсіювання
   набору даних, мініатюри послідовностей. */
(function (HR) {
  'use strict';

  const { fmtNum, fmtError, clamp } = HR.util;
  const { CLASS_NAMES } = HR.data;

  const C = {
    ink: '#0b0b0b',
    ink2: '#52514e',
    muted: '#6f6d68',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
    surface: '#ffffff',
    accent: '#4a3aa7',
    deemph: '#898781',
    normal: '#2a78d6',
    arrhythmia: '#eb6834',
    trace: '#2b2a28',
  };
  const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const font = (size, weight = 400) => `${weight} ${size}px ${FONT_FAMILY}`;

  // Узгоджує розмір буфера canvas з його CSS-розміром і щільністю пікселів
  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  // ------------------------------------------------------------ Шкали

  function niceStep(range, count) {
    const raw = range / Math.max(1, count);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  function linearTicks(lo, hi, count) {
    const step = niceStep(hi - lo, count);
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) {
      ticks.push(Number(v.toFixed(10)));
    }
    return ticks;
  }

  function logTicks(lo, hi) {
    const ticks = [];
    for (let d = Math.floor(Math.log10(lo)); d <= Math.ceil(Math.log10(hi)); d++) {
      for (const m of [1, 2, 5]) {
        const v = m * 10 ** d;
        if (v >= lo * 0.999 && v <= hi * 1.001) ticks.push(v);
      }
    }
    if (ticks.length > 6) {
      return ticks.filter((v) => Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9);
    }
    return ticks;
  }

  function fmtLogTick(v) {
    if (v >= 0.001) return fmtNum(v, Math.max(0, -Math.floor(Math.log10(v) + 1e-9)));
    return v.toExponential(0);
  }

  // Сітка, вісь X і підписи шкал
  function drawFrame(ctx, area, { yTicks, yToPx, fmtY, xTicks, xToPx, fmtX }) {
    ctx.save();
    ctx.font = font(11);
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.grid;
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of yTicks) {
      const y = Math.round(yToPx(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(area.x, y);
      ctx.lineTo(area.x + area.w, y);
      ctx.stroke();
      ctx.fillText(fmtY(t), area.x - 6, y);
    }
    ctx.strokeStyle = C.axis;
    const yb = Math.round(area.y + area.h) + 0.5;
    ctx.beginPath();
    ctx.moveTo(area.x, yb);
    ctx.lineTo(area.x + area.w, yb);
    ctx.stroke();
    ctx.textBaseline = 'top';
    xTicks.forEach((t, i) => {
      const x = xToPx(t);
      ctx.textAlign = i === 0 && x - area.x < 12 ? 'left' : 'center';
      ctx.fillText(fmtX(t), x, area.y + area.h + 6);
    });
    ctx.restore();
  }

  // Маркер із кільцем кольору поверхні (щоб не зливався з лініями)
  function drawDot(ctx, x, y, color, r = 4) {
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = C.surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawCrosshair(ctx, area, x) {
    ctx.save();
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, area.y);
    ctx.lineTo(Math.round(x) + 0.5, area.y + area.h);
    ctx.stroke();
    ctx.restore();
  }

  function strokeSeries(ctx, xs, ys, xToPx, yToPx, color, maxPoints) {
    const n = xs.length;
    if (!n) return;
    const step = Math.max(1, Math.floor(n / maxPoints));
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < n; i += step) {
      const x = xToPx(xs[i]);
      const y = yToPx(ys[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(xToPx(xs[n - 1]), yToPx(ys[n - 1]));
    ctx.stroke();
    ctx.restore();
  }

  // Підпис кінцевої точки: праворуч від неї, поки лінія ще не дійшла до правого краю
  function endLabel(ctx, area, x, y, text) {
    ctx.save();
    ctx.font = font(11.5, 600);
    ctx.fillStyle = C.ink;
    const roomRight = area.x + area.w - x > ctx.measureText(text).width + 12;
    if (roomRight) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 9, y);
    } else {
      ctx.textAlign = 'right';
      const above = y - 10 > area.y + 8;
      ctx.textBaseline = above ? 'bottom' : 'top';
      ctx.fillText(text, Math.min(x, area.x + area.w), above ? y - 8 : y + 8);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ Помилка навчання

  function errorScales(area, history, totalEpochs) {
    const errs = history.error;
    let lo = Infinity;
    let hi = 0;
    for (const e of errs) {
      if (e > 0 && e < lo) lo = e;
      if (e > hi) hi = e;
    }
    if (!Number.isFinite(lo) || hi <= 0) {
      lo = 0.001;
      hi = 0.3;
    }
    lo = Math.max(1e-9, lo / 1.6);
    hi *= 1.25;
    if (hi / lo < 10) lo = hi / 10;
    const xMax = Math.max(totalEpochs, errs.length, 2);
    const lLo = Math.log10(lo);
    const lHi = Math.log10(hi);
    return {
      lo,
      hi,
      xMax,
      xToPx: (e) => area.x + (e / xMax) * area.w,
      yToPx: (v) => area.y + (1 - (Math.log10(Math.max(v, lo)) - lLo) / (lHi - lLo)) * area.h,
    };
  }

  function drawErrorChart(ctx, w, h, history, totalEpochs, hoverIndex = null) {
    const area = { x: 52, y: 14, w: w - 52 - 16, h: h - 14 - 26 };
    const s = errorScales(area, history, totalEpochs);
    drawFrame(ctx, area, {
      yTicks: logTicks(s.lo, s.hi),
      yToPx: s.yToPx,
      fmtY: fmtLogTick,
      xTicks: linearTicks(0, s.xMax, Math.max(2, Math.floor(area.w / 80))),
      xToPx: s.xToPx,
      fmtX: (v) => fmtNum(v, 0),
    });
    const n = history.error.length;
    if (!n) return { area, ...s };
    strokeSeries(ctx, history.epoch, history.error, s.xToPx, s.yToPx, C.accent, area.w * 2);
    const lx = s.xToPx(history.epoch[n - 1]);
    const ly = s.yToPx(history.error[n - 1]);
    drawDot(ctx, lx, ly, C.accent);
    endLabel(ctx, area, lx, ly, fmtError(history.error[n - 1]));
    if (hoverIndex !== null && hoverIndex < n) {
      const hx = s.xToPx(history.epoch[hoverIndex]);
      drawCrosshair(ctx, area, hx);
      drawDot(ctx, hx, s.yToPx(history.error[hoverIndex]), C.accent);
    }
    return { area, ...s };
  }

  // ------------------------------------------------------------ Точність

  function accuracyScales(area, history, totalEpochs) {
    const values = history.trainAcc.concat(history.testAcc).filter(Number.isFinite);
    const minAcc = values.length ? Math.min(...values) : 0.5;
    const lo = clamp(Math.floor((minAcc * 100 - 5) / 10) * 10, 0, 90);
    const last = history.evalEpoch.length ? history.evalEpoch[history.evalEpoch.length - 1] : 0;
    const xMax = Math.max(totalEpochs, last, 2);
    return {
      lo,
      xMax,
      xToPx: (e) => area.x + (e / xMax) * area.w,
      yToPx: (pct) => area.y + (1 - (pct - lo) / (100 - lo)) * area.h,
    };
  }

  function drawAccuracyChart(ctx, w, h, history, totalEpochs, hoverIndex = null) {
    const area = { x: 44, y: 14, w: w - 44 - 16, h: h - 14 - 26 };
    const s = accuracyScales(area, history, totalEpochs);
    drawFrame(ctx, area, {
      yTicks: linearTicks(s.lo, 100, Math.max(3, Math.floor(area.h / 48))),
      yToPx: s.yToPx,
      fmtY: (v) => fmtNum(v, 0),
      xTicks: linearTicks(0, s.xMax, Math.max(2, Math.floor(area.w / 80))),
      xToPx: s.xToPx,
      fmtX: (v) => fmtNum(v, 0),
    });
    const n = history.evalEpoch.length;
    if (!n) return { area, ...s };
    const pct = (arr) => arr.map((v) => (Number.isFinite(v) ? v * 100 : NaN));
    const train = pct(history.trainAcc);
    const test = pct(history.testAcc);
    const hasTest = test.some(Number.isFinite);
    strokeSeries(ctx, history.evalEpoch, train, s.xToPx, s.yToPx, C.deemph, area.w);
    if (hasTest) strokeSeries(ctx, history.evalEpoch, test, s.xToPx, s.yToPx, C.accent, area.w);

    const lx = s.xToPx(history.evalEpoch[n - 1]);
    drawDot(ctx, lx, s.yToPx(train[n - 1]), C.deemph);
    if (hasTest) {
      const ly = s.yToPx(test[n - 1]);
      drawDot(ctx, lx, ly, C.accent);
      endLabel(ctx, area, lx, ly, `тест ${fmtNum(test[n - 1], 1)} %`);
    }
    if (hoverIndex !== null && hoverIndex < n) {
      const hx = s.xToPx(history.evalEpoch[hoverIndex]);
      drawCrosshair(ctx, area, hx);
      drawDot(ctx, hx, s.yToPx(train[hoverIndex]), C.deemph);
      if (hasTest) drawDot(ctx, hx, s.yToPx(test[hoverIndex]), C.accent);
    }
    return { area, ...s };
  }

  // ------------------------------------------------------------ Підказки

  function nearestIndex(sortedValues, target) {
    let lo = 0;
    let hi = sortedValues.length - 1;
    if (hi < 0) return null;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedValues[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(sortedValues[lo - 1] - target) <= Math.abs(sortedValues[lo] - target)) return lo - 1;
    return lo;
  }

  // Заповнює підказку безпечно (лише textContent)
  function fillTip(tip, title, rows) {
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'tip-title';
    head.textContent = title;
    tip.appendChild(head);
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'tip-row';
      if (row.color) {
        const key = document.createElement('i');
        key.className = row.key === 'dot' ? 'swatch' : 'line-key';
        if (row.key === 'dot') key.style.background = row.color;
        else key.style.borderColor = row.color;
        line.appendChild(key);
      }
      const value = document.createElement('strong');
      value.textContent = row.value;
      const label = document.createElement('span');
      label.textContent = row.label;
      line.append(value, label);
      tip.appendChild(line);
    }
    tip.hidden = false;
  }

  function placeTip(tip, wrap, x, y) {
    const pad = 12;
    const ww = wrap.clientWidth;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = x + pad;
    if (left + tw > ww) left = x - pad - tw;
    let top = y - th - pad;
    if (top < 0) top = y + pad;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${top}px`;
  }

  // ------------------------------------------------------------ Графіки навчання

  class TrainingCharts {
    constructor({ errorCanvas, accCanvas, errorTip, accTip, errorEmpty, accEmpty }) {
      this.errorCanvas = errorCanvas;
      this.accCanvas = accCanvas;
      this.errorTip = errorTip;
      this.accTip = accTip;
      this.errorEmpty = errorEmpty;
      this.accEmpty = accEmpty;
      this.history = null;
      this.totalEpochs = 0;
      this.hoverError = null;
      this.hoverAcc = null;
      this.lastDraw = 0;
      this.pending = false;
      this.errorScale = null;
      this.accScale = null;

      this.bindHover(errorCanvas, errorTip, 'error');
      this.bindHover(accCanvas, accTip, 'acc');
      new ResizeObserver(() => this.draw()).observe(errorCanvas.parentElement);
    }

    get hasData() {
      return Boolean(this.history && this.history.epoch.length);
    }

    show(history, totalEpochs) {
      this.history = history;
      this.totalEpochs = totalEpochs;
      this.errorEmpty.hidden = true;
      this.accEmpty.hidden = true;
      this.draw();
    }

    // Під час навчання перемальовуємо не частіше ніж ~12 разів на секунду
    update(history, totalEpochs) {
      this.history = history;
      this.totalEpochs = totalEpochs;
      const now = performance.now();
      if (now - this.lastDraw > 80) this.draw();
    }

    clear() {
      this.history = null;
      this.errorEmpty.hidden = false;
      this.accEmpty.hidden = false;
      prepareCanvas(this.errorCanvas);
      prepareCanvas(this.accCanvas);
      this.errorTip.hidden = true;
      this.accTip.hidden = true;
    }

    draw() {
      if (!this.history) return;
      this.lastDraw = performance.now();
      const e = prepareCanvas(this.errorCanvas);
      this.errorScale = drawErrorChart(e.ctx, e.w, e.h, this.history, this.totalEpochs, this.hoverError);
      const a = prepareCanvas(this.accCanvas);
      this.accScale = drawAccuracyChart(a.ctx, a.w, a.h, this.history, this.totalEpochs, this.hoverAcc);
    }

    bindHover(canvas, tip, kind) {
      const wrap = canvas.parentElement;
      canvas.addEventListener('pointermove', (ev) => {
        if (!this.hasData) return;
        const rect = canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const scale = kind === 'error' ? this.errorScale : this.accScale;
        if (!scale) return;
        const epoch = ((x - scale.area.x) / scale.area.w) * scale.xMax;
        const h = this.history;
        if (kind === 'error') {
          const idx = nearestIndex(h.epoch, epoch);
          if (idx === null) return;
          this.hoverError = idx;
          fillTip(tip, `Епоха ${fmtNum(h.epoch[idx], 0)}`, [
            { color: C.accent, value: fmtError(h.error[idx]), label: 'помилка (MSE)' },
          ]);
        } else {
          const idx = nearestIndex(h.evalEpoch, epoch);
          if (idx === null) return;
          this.hoverAcc = idx;
          const rows = [];
          if (Number.isFinite(h.testAcc[idx])) rows.push({ color: C.accent, value: `${fmtNum(h.testAcc[idx] * 100, 1)} %`, label: 'тестова' });
          rows.push({ color: C.deemph, value: `${fmtNum(h.trainAcc[idx] * 100, 1)} %`, label: 'навчальна' });
          fillTip(tip, `Епоха ${fmtNum(h.evalEpoch[idx], 0)}`, rows);
        }
        this.draw();
        placeTip(tip, wrap, x, y);
      });
      canvas.addEventListener('pointerleave', () => {
        if (kind === 'error') this.hoverError = null;
        else this.hoverAcc = null;
        tip.hidden = true;
        this.draw();
      });
    }
  }

  // Обидва графіки на одному зображенні — для збереження у файл
  function composeTrainingImage({ history, totalEpochs, title, subtitle }) {
    const W = 1400;
    const H = 620;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = C.ink;
    ctx.font = font(26, 650);
    ctx.textBaseline = 'top';
    ctx.fillText(title, 40, 28);
    ctx.fillStyle = C.ink2;
    ctx.font = font(16);
    ctx.fillText(subtitle, 40, 64);

    const panelW = (W - 40 * 2 - 40) / 2;
    const panelY = 120;
    const panelH = H - panelY - 30;

    const panel = (x, heading, legend, draw) => {
      ctx.save();
      ctx.translate(x, panelY);
      ctx.fillStyle = C.ink;
      ctx.font = font(17, 600);
      ctx.fillText(heading, 0, 0);
      let lx = 0;
      ctx.font = font(14);
      for (const item of legend) {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lx, 38);
        ctx.lineTo(lx + 22, 38);
        ctx.stroke();
        ctx.fillStyle = C.ink2;
        ctx.textBaseline = 'middle';
        ctx.fillText(item.label, lx + 30, 38);
        lx += 30 + ctx.measureText(item.label).width + 24;
      }
      ctx.textBaseline = 'top';
      ctx.translate(0, 56);
      draw(ctx, panelW, panelH - 56);
      ctx.restore();
    };

    panel(40, 'Помилка навчання (MSE), логарифмічна шкала', [{ color: C.accent, label: 'помилка на епосі' }],
      (c, w, h) => drawErrorChart(c, w, h, history, totalEpochs));
    panel(40 + panelW + 40, 'Точність класифікації, %', [
      { color: C.accent, label: 'тестова вибірка' },
      { color: C.deemph, label: 'навчальна вибірка' },
    ], (c, w, h) => drawAccuracyChart(c, w, h, history, totalEpochs));

    ctx.fillStyle = C.muted;
    ctx.font = font(13);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right';
    ctx.fillText('Вісь X — номер епохи', W - 40, H - 12);
    return canvas;
  }

  // ------------------------------------------------------------ Діаграма розсіювання

  function scatterDomain(samples) {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMax = 0;
    for (const s of samples) {
      if (s.mean < xMin) xMin = s.mean;
      if (s.mean > xMax) xMax = s.mean;
      if (s.spread > yMax) yMax = s.spread;
    }
    return {
      x0: Math.floor((xMin - 3) / 10) * 10,
      x1: Math.ceil((xMax + 3) / 10) * 10,
      y1: Math.max(10, Math.ceil((yMax + 3) / 10) * 10),
    };
  }

  class ScatterPlot {
    constructor({ canvas, tip, empty, onPick }) {
      this.canvas = canvas;
      this.tip = tip;
      this.empty = empty;
      this.onPick = onPick;
      this.dataset = null;
      this.points = [];
      this.hover = null;
      canvas.addEventListener('pointermove', (ev) => this.handleMove(ev));
      canvas.addEventListener('pointerleave', () => {
        this.hover = null;
        tip.hidden = true;
        this.draw();
      });
      canvas.addEventListener('click', () => {
        if (this.hover !== null && this.onPick) this.onPick(this.dataset.samples[this.hover]);
      });
      new ResizeObserver(() => this.draw()).observe(canvas.parentElement);
    }

    setData(dataset) {
      this.dataset = dataset;
      this.hover = null;
      this.empty.hidden = Boolean(dataset);
      this.canvas.style.cursor = dataset ? 'crosshair' : '';
      this.draw();
    }

    draw() {
      const { ctx, w, h } = prepareCanvas(this.canvas);
      this.points = [];
      if (!this.dataset) return;
      const samples = this.dataset.samples;
      const area = { x: 46, y: 12, w: w - 46 - 14, h: h - 12 - 44 };
      const d = scatterDomain(samples);
      const xToPx = (v) => area.x + ((v - d.x0) / (d.x1 - d.x0)) * area.w;
      const yToPx = (v) => area.y + (1 - v / d.y1) * area.h;

      drawFrame(ctx, area, {
        yTicks: linearTicks(0, d.y1, Math.max(2, Math.floor(area.h / 36))),
        yToPx,
        fmtY: (v) => fmtNum(v, 0),
        xTicks: linearTicks(d.x0, d.x1, Math.max(2, Math.floor(area.w / 60))),
        xToPx,
        fmtX: (v) => fmtNum(v, 0),
      });

      ctx.save();
      ctx.fillStyle = C.ink2;
      ctx.font = font(11.5);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Середня ЧСС у послідовності, уд/хв', area.x + area.w / 2, h - 2);
      ctx.translate(11, area.y + area.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'middle';
      ctx.fillText('Розкид (max − min), уд/хв', 0, 0);
      ctx.restore();

      // пороги класів: допуск норми та мінімальний розкид аритмії
      const p = this.dataset.params;
      const thresholds = p && Number.isFinite(p.tolerance) && Number.isFinite(p.minSpread)
        ? [[p.tolerance, `Tol = ${p.tolerance}`, 'top'], [p.minSpread, `мін. розкид = ${p.minSpread}`, 'bottom']]
        : [];
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 1;
      for (const [value] of thresholds) {
        const y = Math.round(yToPx(value)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(area.x, y);
        ctx.lineTo(area.x + area.w, y);
        ctx.stroke();
      }
      ctx.restore();

      // точки з кільцем кольору поверхні
      const r = 3.5;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const x = xToPx(s.mean);
        const y = yToPx(s.spread);
        this.points.push({ x, y });
        ctx.beginPath();
        ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
        ctx.fillStyle = C.surface;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = s.label === 'normal' ? C.normal : C.arrhythmia;
        ctx.fill();
      }

      // підписи порогів — поверх точок, з білим ореолом для читабельності
      ctx.save();
      ctx.font = font(11, 600);
      ctx.textAlign = 'left';
      ctx.lineJoin = 'round';
      for (const [value, text, side] of thresholds) {
        const y = yToPx(value);
        ctx.textBaseline = side === 'top' ? 'top' : 'bottom';
        const ty = side === 'top' ? y + 3 : y - 3;
        ctx.strokeStyle = C.surface;
        ctx.lineWidth = 3;
        ctx.strokeText(text, area.x + 4, ty);
        ctx.fillStyle = C.ink2;
        ctx.fillText(text, area.x + 4, ty);
      }
      ctx.restore();

      if (this.hover !== null) {
        const s = samples[this.hover];
        const pt = this.points[this.hover];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 2;
        ctx.stroke();
        drawDot(ctx, pt.x, pt.y, s.label === 'normal' ? C.normal : C.arrhythmia, r + 1);
      }
    }

    handleMove(ev) {
      if (!this.dataset || !this.points.length) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      let best = null;
      let bestDist = 24 * 24; // ціль наведення — щонайменше 24 px
      this.points.forEach((pt, i) => {
        const d = (pt.x - x) ** 2 + (pt.y - y) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      if (best !== this.hover) {
        this.hover = best;
        this.draw();
      }
      if (best === null) {
        this.tip.hidden = true;
        return;
      }
      const s = this.dataset.samples[best];
      fillTip(this.tip, `Зразок №${s.id} · ${s.split === 'test' ? 'тестова' : 'навчальна'} вибірка`, [
        { key: 'dot', color: s.label === 'normal' ? C.normal : C.arrhythmia, value: CLASS_NAMES[s.label], label: '' },
        { value: s.bpm.join(', '), label: 'уд/хв' },
        { value: `${fmtNum(s.mean, 1)} / ${fmtNum(s.spread, 0)}`, label: 'середня / розкид' },
      ]);
      placeTip(this.tip, this.canvas.parentElement, this.points[best].x, this.points[best].y);
    }
  }

  // ------------------------------------------------------------ Мініатюри

  // Смужка R-зубців: рівні проміжки — норма, нерівні — аритмія
  function drawRhythmThumb(canvas, bpm) {
    const { ctx, w, h } = prepareCanvas(canvas);
    const rr = bpm.map((v) => 60000 / v);
    const total = rr.reduce((a, b) => a + b, 0);
    const pad = 8;
    const scale = (w - pad * 2) / total;
    const base = h - 7;
    const peak = 6;
    ctx.strokeStyle = C.trace;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, base);
    let t = 0;
    const rPositions = [0];
    for (const interval of rr) {
      t += interval;
      rPositions.push(t);
    }
    for (const pos of rPositions) {
      const x = pad + pos * scale;
      ctx.lineTo(x - 3, base);
      ctx.lineTo(x - 1.5, base + 2);
      ctx.lineTo(x, peak);
      ctx.lineTo(x + 1.8, base + 4);
      ctx.lineTo(x + 3.5, base);
    }
    ctx.lineTo(w, base);
    ctx.stroke();
  }

  HR.charts = {
    COLORS: C,
    font,
    prepareCanvas,
    linearTicks,
    TrainingCharts,
    ScatterPlot,
    composeTrainingImage,
    drawRhythmThumb,
  };
})(window.HR = window.HR || {});
