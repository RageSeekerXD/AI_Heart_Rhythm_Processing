/* Журнал операцій: показується в інтерфейсі та зберігається у файл .txt. */
(function (HR) {
  'use strict';

  const { formatTime, formatDateTime, formatDate } = HR.util;

  const LEVELS = {
    info: { tag: 'INFO', icon: 'ℹ', label: 'Інформація' },
    success: { tag: 'OK', icon: '✔', label: 'Успішно' },
    warn: { tag: 'WARN', icon: '⚠', label: 'Попередження' },
    error: { tag: 'ERROR', icon: '✖', label: 'Помилка' },
  };

  class OperationLog {
    constructor({ list, count, empty, onChange }) {
      this.entries = [];
      this.list = list;
      this.count = count;
      this.empty = empty;
      this.onChange = onChange || (() => {});
    }

    add(level, message) {
      const entry = { time: new Date(), level, message };
      this.entries.push(entry);
      this.renderEntry(entry);
      this.updateMeta();
      const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[consoleMethod](`[${LEVELS[level].tag}] ${message}`);
      return entry;
    }

    info(message) { return this.add('info', message); }
    success(message) { return this.add('success', message); }
    warn(message) { return this.add('warn', message); }
    error(message) { return this.add('error', message); }

    renderEntry(entry) {
      const level = LEVELS[entry.level];
      const item = document.createElement('li');
      item.className = `log-entry log-${entry.level}`;

      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = formatTime(entry.time);

      const icon = document.createElement('span');
      icon.className = 'log-icon';
      icon.textContent = level.icon;
      icon.title = level.label;

      const msg = document.createElement('span');
      msg.className = 'log-msg';
      const hiddenLevel = document.createElement('span');
      hiddenLevel.className = 'sr-only';
      hiddenLevel.textContent = `${level.label}: `;
      msg.append(hiddenLevel, document.createTextNode(entry.message));

      item.append(time, icon, msg);
      this.list.appendChild(item);
      this.list.scrollTop = this.list.scrollHeight;
    }

    updateMeta() {
      this.count.textContent = String(this.entries.length);
      this.empty.hidden = this.entries.length > 0;
      this.onChange(this.entries.length);
    }

    clear() {
      this.entries = [];
      this.list.replaceChildren();
      this.updateMeta();
    }

    toText() {
      const lines = [
        'Журнал операцій — «Розпізнавання серцевого ритму» (brain.js)',
        `Збережено: ${formatDateTime(new Date())}`,
        `Записів: ${this.entries.length}`,
        '-'.repeat(78),
      ];
      for (const e of this.entries) {
        const tag = `[${LEVELS[e.level].tag}]`.padEnd(8);
        lines.push(`${formatDate(e.time)} ${formatTime(e.time)} ${tag} ${e.message}`);
      }
      return lines.join('\r\n') + '\r\n';
    }
  }

  HR.OperationLog = OperationLog;
})(window.HR = window.HR || {});
