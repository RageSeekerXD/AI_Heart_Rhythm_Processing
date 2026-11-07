/* Графіки результатів бенчмарку (canvas 2D, без бібліотек).
   Кожен графік малюється у полотно з подвоєною щільністю пікселів, тому
   його можна зберегти в PNG і вставити у звіт. */
(function (BENCH) {
  'use strict';

  const COLORS = {
    ink: '#1d1b2e',
    ink2: '#52514e',
    muted: '#6f6d68',
    grid: '#e6e5df',
    axis: '#b9b8ad',
    accent: '#4a3aa7',
    blue: '#2a78d6',
    orange: '#eb6834',
    green: '#2f9e6b',
    teal: '#159aa3',
    gold: '#c08a12',
    gray: '#8a8880',
    pink: '#c2417f',
  };
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  // шрифт трохи більший за типовий, щоб підписи читалися у звіті шириною 16–17 см
  const FONT_SCALE = 1.2;
  const font = (size, weight = 400) => `${weight} ${Math.round(size * FONT_SCALE * 10) / 10}px ${FONT}`;
  const SCALE = 2;
  const LEFT = 76; // місце під підписи осі Y

  const nf = (d) => new Intl.NumberFormat('uk-UA', { minimumFractionDigits: d, maximumFractionDigits: d });
  function fmtTick(v) {
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1) return nf(Number.isInteger(v) ? 0 : a >= 10 ? 0 : 1).format(v);
    if (a >= 0.1) return nf(1).format(v);
    if (a >= 0.01) return nf(2).format(v);
    return nf(Math.min(6, -Math.floor(Math.log10(a)))).format(v);
  }
  const fmtMs = (ms) => BENCH.fmtMs(ms);
  const median = (arr) => BENCH.stats(arr).median;

  // ---------------------------------------------------------------- Шкали

  function niceStep(range, count) {
    const raw = range / Math.max(1, count);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  function linearScale(lo, hi, a, b, count = 5) {
    const step = niceStep(hi - lo, count);
    const min = Math.floor(lo / step) * step;
    const max = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = min; v <= max + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
    const map = (v) => a + ((v - min) / (max - min || 1)) * (b - a);
    return { map, ticks, min, max };
  }

  function logScale(lo, hi, a, b) {
    const min = 10 ** Math.floor(Math.log10(lo));
    const max = 10 ** Math.ceil(Math.log10(hi));
    const ticks = [];
    for (let v = min; v <= max * 1.0001; v *= 10) ticks.push(v);
    const minor = [];
    for (const t of ticks) for (const m of [2, 5]) if (t * m < max) minor.push(t * m);
    const l0 = Math.log10(min);
    const l1 = Math.log10(max);
    const map = (v) => a + ((Math.log10(v) - l0) / (l1 - l0 || 1)) * (b - a);
    return { map, ticks, minor, min, max, log: true };
  }

  // ---------------------------------------------------------------- Полотно

  function makeCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w * SCALE;
    canvas.height = h * SCALE;
    canvas.style.width = `${w}px`;
    canvas.style.maxWidth = '100%';
    canvas.style.height = 'auto';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    return { canvas, ctx };
  }

  function text(ctx, str, x, y, { size = 13, weight = 400, color = COLORS.ink2, align = 'left', base = 'alphabetic' } = {}) {
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = base;
    ctx.fillText(str, x, y);
  }

  function legend(ctx, items, x, y, maxW) {
    let cx = x;
    let cy = y;
    ctx.font = font(13);
    for (const it of items) {
      const w = 26 + ctx.measureText(it.name).width + 18;
      if (cx + w > x + maxW && cx > x) {
        cx = x;
        cy += 24;
      }
      ctx.strokeStyle = it.color;
      ctx.fillStyle = it.color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash(it.dash || []);
      if (it.bar) {
        ctx.fillRect(cx, cy - 6, 18, 12);
      } else {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + 18, cy);
        ctx.stroke();
        if (it.marker !== false) {
          ctx.beginPath();
          ctx.arc(cx + 9, cy, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.setLineDash([]);
      text(ctx, it.name, cx + 24, cy, { base: 'middle', color: COLORS.ink2 });
      cx += w;
    }
    return cy + 14;
  }

  function panelTitle(ctx, box, title) {
    if (!title) return box.y;
    text(ctx, title, box.x, box.y + 17, { size: 15, weight: 650, color: COLORS.ink });
    return box.y + 30;
  }

  // ---------------------------------------------------------------- Лінійний графік

  function plot(ctx, box, spec) {
    let top = panelTitle(ctx, box, spec.title);
    const series = spec.series.filter((s) => s.points.length);
    if (spec.legend !== false) top = legend(ctx, series.map((s) => ({ name: s.name, color: s.color, dash: s.dash })), box.x + 4, top + 8, box.w - 8) + 6;
    const area = { x: box.x + LEFT, y: top + 6, w: box.w - LEFT - 14, h: box.y + box.h - top - 6 - 50 };

    const pts = series.flatMap((s) => s.points);
    const xs = pts.map((p) => p.x);
    const ys = pts.flatMap((p) => [p.y, p.lo ?? p.y, p.hi ?? p.y]);
    const xLo = spec.xMin ?? Math.min(...xs);
    const xHi = spec.xMax ?? Math.max(...xs);
    const yLo = spec.yMin ?? (spec.yLog ? Math.min(...ys) : 0);
    const yHi = spec.yMax ?? Math.max(...ys);
    const xs_ = spec.xLog ? logScale(xLo, xHi, area.x, area.x + area.w) : linearScale(spec.xZero ? 0 : xLo, xHi, area.x, area.x + area.w, spec.xTickCount || 6);
    const ys_ = spec.yLog ? logScale(yLo, yHi * 1.0001, area.y + area.h, area.y) : linearScale(yLo, yHi * 1.04, area.y + area.h, area.y, spec.yTickCount || 5);

    // сітка й осі
    ctx.lineWidth = 1;
    if (ys_.minor) {
      ctx.strokeStyle = '#f1f0eb';
      for (const t of ys_.minor) {
        const y = Math.round(ys_.map(t)) + 0.5;
        ctx.beginPath(); ctx.moveTo(area.x, y); ctx.lineTo(area.x + area.w, y); ctx.stroke();
      }
    }
    for (const t of ys_.ticks) {
      const y = Math.round(ys_.map(t)) + 0.5;
      ctx.strokeStyle = t === ys_.min ? COLORS.axis : COLORS.grid;
      ctx.beginPath(); ctx.moveTo(area.x, y); ctx.lineTo(area.x + area.w, y); ctx.stroke();
      text(ctx, spec.yFmt ? spec.yFmt(t) : fmtTick(t), area.x - 8, y, { align: 'right', base: 'middle', size: 12, color: COLORS.muted });
    }
    const xTicks = spec.xTicks || xs_.ticks.map((v) => ({ v, label: spec.xFmt ? spec.xFmt(v) : fmtTick(v) }));
    for (const t of xTicks) {
      const x = Math.round(xs_.map(t.v)) + 0.5;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath(); ctx.moveTo(x, area.y); ctx.lineTo(x, area.y + area.h); ctx.stroke();
      text(ctx, t.label, x, area.y + area.h + 8, { align: 'center', base: 'top', size: 12, color: COLORS.muted });
    }
    ctx.strokeStyle = COLORS.axis;
    ctx.beginPath(); ctx.moveTo(area.x + 0.5, area.y); ctx.lineTo(area.x + 0.5, area.y + area.h); ctx.stroke();
    text(ctx, spec.xLabel || '', area.x + area.w / 2, box.y + box.h - 4, { align: 'center', size: 13, color: COLORS.ink2 });
    ctx.save();
    ctx.translate(box.x + 14, area.y + area.h / 2);
    ctx.rotate(-Math.PI / 2);
    text(ctx, spec.yLabel || '', 0, 0, { align: 'center', base: 'middle', size: 13, color: COLORS.ink2 });
    ctx.restore();

    // довідкові лінії (апроксимація, межі)
    for (const l of spec.lines || []) {
      ctx.strokeStyle = l.color || COLORS.gray;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(l.dash || [6, 5]);
      ctx.beginPath();
      if (l.vertical !== undefined) {
        const x = xs_.map(l.vertical);
        ctx.moveTo(x, area.y); ctx.lineTo(x, area.y + area.h);
      } else {
        const n = 40;
        for (let i = 0; i <= n; i++) {
          const xv = spec.xLog ? 10 ** (Math.log10(l.x0) + (i / n) * (Math.log10(l.x1) - Math.log10(l.x0))) : l.x0 + (i / n) * (l.x1 - l.x0);
          const yv = l.fn(xv);
          if (!(yv > 0) && spec.yLog) continue;
          const px = xs_.map(xv);
          const py = ys_.map(yv);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (l.label) {
        let lx = l.vertical !== undefined ? xs_.map(l.vertical) + 6 : xs_.map(l.labelAt ?? l.x1) - 4;
        let ly = l.vertical !== undefined ? area.y + 12 : ys_.map(l.fn(l.labelAt ?? l.x1)) - 8;
        if (l.labelXY) {
          lx = xs_.map(l.labelXY[0]);
          ly = ys_.map(l.labelXY[1]);
        }
        text(ctx, l.label, lx, ly, { size: 12, color: l.color || COLORS.gray, align: l.vertical !== undefined ? 'left' : (l.align || 'right') });
      }
    }

    // ряди даних
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = 2.4;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const x = xs_.map(p.x);
        const y = ys_.map(p.y);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of s.points) {
        const x = xs_.map(p.x);
        const y = ys_.map(p.y);
        ctx.strokeStyle = s.color; // підпис попередньої точки змінює колір контексту
        ctx.fillStyle = s.color;
        if (p.lo !== undefined && p.hi !== undefined && Math.abs(ys_.map(p.lo) - ys_.map(p.hi)) > 2) {
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, ys_.map(p.lo)); ctx.lineTo(x, ys_.map(p.hi));
          ctx.moveTo(x - 4, ys_.map(p.lo)); ctx.lineTo(x + 4, ys_.map(p.lo));
          ctx.moveTo(x - 4, ys_.map(p.hi)); ctx.lineTo(x + 4, ys_.map(p.hi));
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        if (p.label) {
          const pos = p.labelPos || s.labelPos || 'above';
          const dx = pos === 'right' ? 8 : pos === 'left' ? -8 : 0;
          const dy = pos === 'below' ? 16 : pos === 'above' ? -10 : 0;
          text(ctx, p.label, x + dx, y + dy, {
            size: 12, color: COLORS.ink2, weight: 600,
            align: pos === 'right' ? 'left' : pos === 'left' ? 'right' : 'center', base: pos === 'right' || pos === 'left' ? 'middle' : 'alphabetic',
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------- Стовпчикова діаграма

  function bars(ctx, box, spec) {
    let top = panelTitle(ctx, box, spec.title);
    if (spec.note) {
      text(ctx, spec.note, box.x + 4, top + 14, { size: 13, color: COLORS.ink2 });
      top += 22;
    }
    if (spec.legend !== false && spec.series.length > 1) {
      top = legend(ctx, spec.series.map((s) => ({ name: s.name, color: s.color, bar: true })), box.x + 4, top + 8, box.w - 8) + 6;
    }
    const area = { x: box.x + LEFT, y: top + 18, w: box.w - LEFT - 10, h: box.y + box.h - top - 18 - 52 };
    const all = spec.series.flatMap((s) => s.values).filter((v) => v > 0);
    // нижня межа на порядок менша за найменше значення, щоб найнижчий стовпчик було видно
    const ys_ = spec.yLog ? logScale(Math.min(...all) / 2, Math.max(...all) * 1.0001, area.y + area.h, area.y)
      : linearScale(0, Math.max(...all) * 1.08, area.y + area.h, area.y, 5);
    ctx.lineWidth = 1;
    for (const t of ys_.ticks) {
      const y = Math.round(ys_.map(t)) + 0.5;
      ctx.strokeStyle = t === ys_.min ? COLORS.axis : COLORS.grid;
      ctx.beginPath(); ctx.moveTo(area.x, y); ctx.lineTo(area.x + area.w, y); ctx.stroke();
      text(ctx, spec.yFmt ? spec.yFmt(t) : fmtTick(t), area.x - 8, y, { align: 'right', base: 'middle', size: 12, color: COLORS.muted });
    }
    ctx.save();
    ctx.translate(box.x + 14, area.y + area.h / 2);
    ctx.rotate(-Math.PI / 2);
    text(ctx, spec.yLabel || '', 0, 0, { align: 'center', base: 'middle', size: 13, color: COLORS.ink2 });
    ctx.restore();

    const groups = spec.categories.length;
    const slot = area.w / groups;
    const inner = Math.min(slot * 0.78, spec.series.length * 64);
    const bw = inner / spec.series.length;
    const base = ys_.map(ys_.min);
    spec.categories.forEach((cat, g) => {
      const gx = area.x + slot * g + (slot - inner) / 2;
      spec.series.forEach((s, i) => {
        const v = s.values[g];
        if (!(v > 0)) {
          // значення нижче роздільної здатності таймера
          if (s.zeroLabel) text(ctx, s.zeroLabel, gx + i * bw + bw / 2, base - 5, { align: 'center', size: spec.labelSize || 11.5, color: COLORS.ink2, weight: 600 });
          return;
        }
        const x = gx + i * bw + 2;
        const y = ys_.map(v);
        ctx.fillStyle = (s.colors && s.colors[g]) || s.color;
        ctx.fillRect(x, y, bw - 4, base - y);
        const label = s.labels ? s.labels[g] : fmtMs(v);
        if (label) text(ctx, label, x + (bw - 4) / 2, y - 5, { align: 'center', size: spec.labelSize || 11.5, color: COLORS.ink2, weight: 600 });
      });
      const lines = String(cat).split('\n');
      lines.forEach((ln, li) => text(ctx, ln, area.x + slot * g + slot / 2, area.y + area.h + 8 + li * 18, { align: 'center', base: 'top', size: 12.5, color: COLORS.ink2 }));
    });
    text(ctx, spec.xLabel || '', area.x + area.w / 2, box.y + box.h - 4, { align: 'center', size: 13, color: COLORS.ink2 });
  }

  // Горизонтальні стовпчики (порівняння варіантів)
  function hbars(ctx, box, spec) {
    const top = panelTitle(ctx, box, spec.title);
    const labelW = spec.labelW || 250;
    const area = { x: box.x + labelW, y: top + 10, w: box.w - labelW - 150, h: box.y + box.h - top - 10 - 40 };
    const max = Math.max(...spec.items.map((it) => it.value));
    const sc = linearScale(0, max * 1.02, area.x, area.x + area.w, 4);
    for (const t of sc.ticks) {
      const x = Math.round(sc.map(t)) + 0.5;
      ctx.strokeStyle = t === 0 ? COLORS.axis : COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, area.y); ctx.lineTo(x, area.y + area.h); ctx.stroke();
      text(ctx, fmtTick(t), x, area.y + area.h + 8, { align: 'center', base: 'top', size: 12, color: COLORS.muted });
    }
    text(ctx, spec.xLabel || '', area.x + area.w / 2, box.y + box.h - 2, { align: 'center', size: 13, color: COLORS.ink2 });
    const rowH = area.h / spec.items.length;
    spec.items.forEach((it, i) => {
      const y = area.y + rowH * i + rowH * 0.18;
      const h = rowH * 0.64;
      ctx.fillStyle = it.color;
      ctx.fillRect(area.x, y, sc.map(it.value) - area.x, h);
      const lines = it.label.split('\n');
      lines.forEach((ln, li) => text(ctx, ln, area.x - 10, y + h / 2 + (li - (lines.length - 1) / 2) * 15, { align: 'right', base: 'middle', size: 12.5, color: COLORS.ink2 }));
      text(ctx, it.valueLabel, sc.map(it.value) + 8, y + h / 2, { base: 'middle', size: 12.5, weight: 650, color: COLORS.ink });
    });
  }

  // ---------------------------------------------------------------- Апроксимація

  // Метод найменших квадратів: y = a + b·x
  function linearFit(points) {
    const n = points.length;
    const sx = points.reduce((s, p) => s + p.x, 0);
    const sy = points.reduce((s, p) => s + p.y, 0);
    const sxx = points.reduce((s, p) => s + p.x * p.x, 0);
    const sxy = points.reduce((s, p) => s + p.x * p.y, 0);
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const a = (sy - b * sx) / n;
    const mean = sy / n;
    const ssTot = points.reduce((s, p) => s + (p.y - mean) ** 2, 0);
    const ssRes = points.reduce((s, p) => s + (p.y - (a + b * p.x)) ** 2, 0);
    return { a, b, r2: ssTot ? 1 - ssRes / ssTot : 1 };
  }

  const pointOf = (x, values, extra = {}) => {
    const s = BENCH.stats(values);
    return { x, y: s.median, lo: s.min, hi: s.max, ...extra };
  };

  // ---------------------------------------------------------------- Рисунки звіту

  const FIGURES = {
    volume(r) {
      const rows = r.suites.volume.rows;
      const { canvas, ctx } = makeCanvas(960, 520);
      const pts = rows.map((x) => pointOf(x.values / 1000, x.train.map((v) => v / 1000), { label: `${BENCH.fmtInt(x.sequences)} посл.`, labelPos: 'left' }));
      const fit = linearFit(pts);
      plot(ctx, { x: 12, y: 8, w: 936, h: 504 }, {
        xLabel: 'Кількість значень у наборі 2N·K, тис. (K = 4)', yLabel: 'Час навчання, с', xZero: true, xMin: 0,
        series: [{ name: 'Навчання 1 000 епох (медіана; риски - мінімум і максимум з 5 запусків)', color: COLORS.accent, points: pts }],
        lines: [{ x0: 0, x1: pts[pts.length - 1].x, fn: (x) => fit.a + fit.b * x, color: COLORS.gray,
          label: `лінійна апроксимація: t ≈ ${nf(3).format(fit.a)} + ${nf(4).format(fit.b)}·x с, R² = ${nf(4).format(fit.r2)}`, labelAt: pts[pts.length - 1].x * 0.62, align: 'right' }],
      });
      return { canvas, fit };
    },

    stages(r) {
      const rows = r.suites.volume.rows;
      const { canvas, ctx } = makeCanvas(960, 500);
      bars(ctx, { x: 12, y: 8, w: 936, h: 484 }, {
        categories: rows.map((x) => `${BENCH.fmtInt(x.sequences)} послідовностей`),
        yLog: true, yLabel: 'Час, мс (логарифмічна шкала)',
        series: [
          { name: 'Генерація набору', color: COLORS.teal, values: rows.map((x) => median(x.gen)) },
          { name: 'Навчання (1 000 епох)', color: COLORS.accent, values: rows.map((x) => median(x.train)) },
          { name: 'Оцінювання тестової вибірки', color: COLORS.orange, values: rows.map((x) => median(x.eval)), zeroLabel: '< 0,1' },
        ],
      });
      return { canvas };
    },

    params(r) {
      const { canvas, ctx } = makeCanvas(960, 760);
      const h = r.suites.hidden.rows;
      const hp = h.map((x) => pointOf(x.parameters, x.train, { label: x.architecture, labelPos: 'left' }));
      const hf = linearFit(hp);
      plot(ctx, { x: 8, y: 6, w: 470, h: 370 }, {
        title: 'а) Розмір прихованого шару H', legend: false, xZero: true, xMin: 0,
        xLabel: 'Кількість параметрів мережі', yLabel: 'Час навчання, мс',
        series: [{ name: 'H', color: COLORS.accent, points: hp }],
        lines: [{ x0: 0, x1: hp[hp.length - 1].x, fn: (x) => hf.a + hf.b * x, align: 'left',
          label: `t ≈ ${nf(0).format(hf.a)} + ${nf(2).format(hf.b)}·P мс, R² = ${nf(4).format(hf.r2)}`, labelXY: [hp[hp.length - 1].x * 0.42, hf.a * 0.9] }],
      });
      const e = r.suites.epochs.rows;
      const ep = e.map((x) => pointOf(x.epochs, x.train));
      const ef = linearFit(ep);
      plot(ctx, { x: 486, y: 6, w: 470, h: 370 }, {
        title: 'б) Кількість епох E', legend: false, xZero: true, xMin: 0,
        xLabel: 'Кількість епох', yLabel: 'Час навчання, мс',
        series: [{ name: 'E', color: COLORS.blue, points: ep }],
        lines: [{ x0: 0, x1: ep[ep.length - 1].x, fn: (x) => ef.a + ef.b * x, align: 'left',
          label: `t ≈ ${nf(0).format(ef.a)} + ${nf(3).format(ef.b)}·E мс, R² = ${nf(4).format(ef.r2)}`, labelXY: [ep[ep.length - 1].x * 0.42, ef.a * 1.2] }],
      });
      const k = r.suites.seqlen.rows;
      plot(ctx, { x: 8, y: 386, w: 470, h: 370 }, {
        title: 'в) Довжина послідовності K: навчання', legend: false,
        xLabel: 'K (входів мережі)', yLabel: 'Час навчання, мс', xMin: 2, xMax: 14,
        xTicks: [4, 8, 12].map((v) => ({ v, label: String(v) })),
        series: [{ name: 'K', color: COLORS.green, points: k.map((x) => pointOf(x.k, x.train, { label: x.architecture, labelPos: 'below' })) }],
      });
      plot(ctx, { x: 486, y: 386, w: 470, h: 370 }, {
        title: 'г) Довжина послідовності K: генерація', legend: false,
        xLabel: 'K (значень у послідовності)', yLabel: 'Час генерації, мс', xMin: 2, xMax: 14,
        xTicks: [4, 8, 12].map((v) => ({ v, label: String(v) })),
        series: [{ name: 'K', color: COLORS.teal, points: k.map((x) => pointOf(x.k, x.gen, { label: `відкинуто ${BENCH.fmtInt(x.rejected)}`, labelPos: 'right' })) }],
      });
      return { canvas, hiddenFit: hf, epochsFit: ef };
    },

    warmup(r) {
      const rows = r.suites.warmup.rows;
      const { canvas, ctx } = makeCanvas(960, 460);
      const rest = BENCH.stats(rows.slice(1).map((x) => x.total)).median;
      bars(ctx, { x: 12, y: 8, w: 936, h: 444 }, {
        categories: rows.map((x) => String(x.run)), xLabel: 'Номер запуску після завантаження сторінки',
        yLabel: 'Час конвеєра, мс', legend: false,
        note: `Медіана запусків 2–${rows.length}: ${fmtMs(rest)} мс; перший запуск (виділено) - ${fmtMs(rows[0].total)} мс, тобто ${nf(2).format(rows[0].total / rest)} медіани`,
        series: [{ name: 'Разом', color: COLORS.accent, colors: rows.map((x, i) => (i === 0 ? COLORS.orange : COLORS.accent)), values: rows.map((x) => x.total) }],
      });
      return { canvas };
    },

    recognition(r) {
      const rows = r.suites.recognition.rows;
      const { canvas, ctx } = makeCanvas(960, 520);
      plot(ctx, { x: 12, y: 8, w: 936, h: 504 }, {
        xLog: true, yLog: true, xLabel: 'Довжина послідовності n, значень (логарифмічна шкала)', yLabel: 'Час, мс (логарифмічна шкала)',
        xTicks: rows.map((x) => ({ v: x.n, label: BENCH.fmtInt(x.n) })),
        series: [
          { name: 'Побудова зображення 1400 × 800 (з растеризацією)', color: COLORS.orange, points: rows.filter((x) => x.render.length).map((x) => pointOf(x.n, x.render)) },
          { name: 'Розпізнавання predictSeries() (на виклик)', color: COLORS.accent, points: rows.map((x) => pointOf(x.n, x.predict)) },
        ],
        lines: [{ vertical: 200, color: COLORS.gray, label: 'межа інтерфейсу: 200 значень' }],
      });
      return { canvas };
    },

    image(r) {
      const rows = r.suites.image.rows;
      const { canvas, ctx } = makeCanvas(960, 900);
      const mp = (x) => x.pixels / 1e6;
      const ticks = rows.map((x) => ({ v: mp(x), label: `${x.width}×${x.height}` }));
      // лише медіани: поодинокі викиди PNG (сотні мілісекунд) стиснули б решту графіка
      const med = (x, values) => ({ x: mp(x), y: median(values) });
      plot(ctx, { x: 8, y: 6, w: 944, h: 470 }, {
        title: 'а) Час побудови та збереження (медіани)', xLabel: 'Роздільна здатність (вісь - кількість пікселів)', yLabel: 'Час, мс', xZero: true, xMin: 0,
        xTicks: ticks,
        series: [
          { name: 'BMP (власний кодувальник)', color: COLORS.orange, points: rows.map((x) => med(x, x.bmp)) },
          { name: 'BMP (оптимізований прототип)', color: COLORS.gold, dash: [7, 5], points: rows.map((x) => med(x, x.bmpFast)) },
          { name: 'JPG (toBlob)', color: COLORS.blue, points: rows.map((x) => med(x, x.jpg)) },
          { name: 'PNG (toBlob)', color: COLORS.accent, points: rows.map((x) => med(x, x.png)) },
          { name: 'Читання пікселів getImageData', color: COLORS.pink, dash: [3, 4], points: rows.map((x) => med(x, x.readback)) },
          { name: 'Побудова зображення', color: COLORS.green, points: rows.map((x) => med(x, x.render)) },
        ],
      });
      plot(ctx, { x: 8, y: 486, w: 944, h: 410 }, {
        title: 'б) Розмір файлу', xLabel: 'Роздільна здатність (вісь - кількість пікселів)', yLabel: 'Розмір, МБ', xZero: true, xMin: 0,
        xTicks: ticks,
        series: [
          { name: 'BMP', color: COLORS.orange, points: rows.map((x) => ({ x: mp(x), y: x.bmpBytes / 1048576 })) },
          { name: 'PNG', color: COLORS.accent, points: rows.map((x) => ({ x: mp(x), y: x.pngBytes / 1048576 })) },
          { name: 'JPG', color: COLORS.blue, points: rows.map((x) => ({ x: mp(x), y: x.jpgBytes / 1048576 })) },
        ],
      });
      return { canvas };
    },

    opt(r) {
      const rows = r.suites.opt.rows;
      const { canvas, ctx } = makeCanvas(960, 560);
      const groups = [...new Set(rows.map((x) => x.sequences))];
      const colors = { current: COLORS.gray, noAccuracy: COLORS.blue, prepared: COLORS.teal, preparedNoAcc: COLORS.green };
      const short = { current: 'поточна реалізація', noAccuracy: 'без запису точності', prepared: 'форматування один раз', preparedNoAcc: 'обидві зміни' };
      groups.forEach((g, gi) => {
        const gr = rows.filter((x) => x.sequences === g);
        const base = median(gr[0].train);
        hbars(ctx, { x: 8, y: 6 + gi * 276, w: 944, h: 268 }, {
          title: `${gi === 0 ? 'а' : 'б'}) ${BENCH.fmtInt(gr[0].trainSamples)} навчальних прикладів × ${BENCH.fmtInt(gr[0].epochs)} епох`,
          xLabel: 'Час навчання, мс (медіана)', labelW: 220,
          items: gr.map((x) => ({ label: short[x.variant], value: median(x.train), color: colors[x.variant],
            valueLabel: `${fmtMs(median(x.train))} мс · ${nf(2).format(base / median(x.train))}×` })),
        });
      });
      return { canvas };
    },

    uimode(r) {
      const rows = r.suites.uimode.rows;
      const vol = r.suites.volume && r.suites.volume.rows.find((x) => x.sequences === 1000);
      const { canvas, ctx } = makeCanvas(960, 480);
      const m = (key) => median(rows.map((x) => x[key]));
      bars(ctx, { x: 12, y: 8, w: 936, h: 464 }, {
        categories: ['Генерація\n1 000 послідовностей', 'Навчання\n1 000 епох', 'Оцінювання\n200 прикладів'],
        yLog: true, yLabel: 'Час, мс (логарифмічна шкала)',
        series: [
          { name: 'Чисті обчислення (без пауз)', color: COLORS.accent, values: [vol ? median(vol.gen) : m('genCompute'), vol ? median(vol.train) : m('trainCompute'), vol ? median(vol.eval) : NaN] },
          { name: 'Час в інтерфейсі (з паузами для кадрів)', color: COLORS.orange, values: [m('genElapsed'), m('trainElapsed'), m('evalElapsed')] },
        ],
      });
      return { canvas };
    },
  };

  const FIGURE_TITLES = {
    volume: 'Час навчання залежно від обсягу набору даних',
    stages: 'Час етапів алгоритму для наборів різного обсягу',
    params: 'Вплив параметрів мережі та даних на час',
    warmup: 'Перші запуски після завантаження сторінки',
    recognition: 'Розпізнавання і побудова зображення залежно від довжини послідовності',
    image: 'Зображення результату різної роздільної здатності',
    opt: 'Прототипи оптимізації циклу навчання',
    uimode: 'Чисті обчислення і час в інтерфейсі',
  };

  const rendered = {};

  function renderAll(results) {
    const box = document.getElementById('charts');
    box.innerHTML = '';
    for (const [id, draw] of Object.entries(FIGURES)) {
      const needs = { stages: 'volume', params: 'hidden' }[id] || id;
      if (!results.suites[needs] || (id === 'params' && (!results.suites.epochs || !results.suites.seqlen))) continue;
      try {
        const fig = draw(results);
        rendered[id] = fig;
        const wrap = document.createElement('figure');
        const cap = document.createElement('figcaption');
        cap.textContent = FIGURE_TITLES[id];
        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'Зберегти PNG';
        save.addEventListener('click', () => fig.canvas.toBlob((b) => window.HR.util.downloadBlob(b, `benchmark_${id}.png`), 'image/png'));
        cap.appendChild(save);
        wrap.append(fig.canvas, cap);
        box.appendChild(wrap);
      } catch (err) {
        console.error(`Графік ${id}:`, err);
      }
    }
  }

  function exportCharts() {
    const out = {};
    for (const [id, fig] of Object.entries(rendered)) out[id] = fig.canvas.toDataURL('image/png');
    return out;
  }

  function fits() {
    const out = {};
    for (const [id, fig] of Object.entries(rendered)) {
      for (const key of ['fit', 'hiddenFit', 'epochsFit']) if (fig[key]) out[`${id}.${key}`] = fig[key];
    }
    return out;
  }

  BENCH.charts = { renderAll, exportCharts, fits, linearFit };
})(window.BENCH);
