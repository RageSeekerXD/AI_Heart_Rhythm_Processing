/* Допоміжні функції, спільні для всіх модулів застосунку. */
(function (HR) {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const sum = (arr) => arr.reduce((acc, v) => acc + v, 0);
  const mean = (arr) => (arr.length ? sum(arr) / arr.length : NaN);
  const argmax = (arr) => arr.reduce((best, v, i) => (v > arr[best] ? i : best), 0);
  const spread = (arr) => Math.max(...arr) - Math.min(...arr);

  // ЧСС (уд/хв) <-> RR-інтервал (мс)
  const bpmToMs = (bpm) => 60000 / bpm;
  const msToBpm = (ms) => 60000 / ms;

  const pad = (n, width = 2) => String(n).padStart(width, '0');

  function formatTime(date = new Date()) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  }

  function formatDate(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function formatDateTime(date = new Date()) {
    return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  // Мітка часу для імен файлів: 2026-10-01_19-45-12
  function fileStamp(date = new Date()) {
    return `${formatDate(date)}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  }

  const numberFormats = new Map();
  function fmtNum(value, digits = 0) {
    if (!Number.isFinite(value)) return '—';
    if (!numberFormats.has(digits)) {
      numberFormats.set(digits, new Intl.NumberFormat('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
    }
    return numberFormats.get(digits).format(value);
  }

  const fmtPct = (fraction, digits = 1) => (Number.isFinite(fraction) ? `${fmtNum(fraction * 100, digits)} %` : '—');

  // Десяткове число без зайвих нулів: 0,3; 0,005
  const decimalFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 6 });
  const fmtDec = (value) => (Number.isFinite(value) ? decimalFormat.format(value) : '—');

  // Українські форми множини: 1 значення, 2 значення, 5 значень
  function plural(n, one, few, many) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  // Число разом з узгодженим іменником: «4 значення», «1 000 послідовностей»
  const countOf = (n, one, few, many) => `${fmtNum(n)} ${plural(n, one, few, many)}`;

  // Помилка MSE змінюється на кілька порядків, тому показуємо значущі цифри
  function fmtError(value) {
    if (!Number.isFinite(value)) return '—';
    if (value === 0) return '0';
    if (value >= 0.01) return fmtNum(value, 4);
    return value.toExponential(2).replace('.', ',');
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${fmtNum(bytes / 1024, 1)} КБ`;
    return `${fmtNum(bytes / (1024 * 1024), 2)} МБ`;
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms)) return '—';
    if (ms < 1000) return `${fmtNum(ms, 0)} мс`;
    return `${fmtNum(ms / 1000, 2)} с`;
  }

  function fileExtension(name) {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  }

  // Збереження файлу: працює й тоді, коли index.html відкрито напряму (file://)
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Віддає керування браузеру, щоб він встиг перемалювати прогрес-бар
  // і обробити натискання (наприклад, «Зупинити»). requestAnimationFrame
  // не спрацьовує у фонових вкладках, тому є запасний таймер.
  function nextFrame() {
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (!finished) {
          finished = true;
          resolve();
        }
      };
      requestAnimationFrame(() => setTimeout(finish, 0));
      setTimeout(finish, 120);
    });
  }

  HR.util = {
    $, $$, clamp, sum, mean, argmax, spread, bpmToMs, msToBpm,
    formatTime, formatDate, formatDateTime, fileStamp,
    fmtNum, fmtPct, fmtDec, fmtError, plural, countOf, formatBytes, formatDuration, fileExtension,
    downloadBlob, nextFrame,
  };
})(window.HR = window.HR || {});
