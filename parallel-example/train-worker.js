/* Web Worker: отримує набір даних один раз, далі — завдання
   (параметри навчання) і повертає результат навчання кожного з них. */
importScripts('../Application/lib/brain-browser.js', 'train-core.js');

let data = null;

self.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === 'data') {
    data = msg.data;
    return;
  }
  if (msg.type === 'task') {
    try {
      const result = self.ParallelExample.trainOne(msg.task, data);
      self.postMessage({ type: 'result', result });
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.task.id, message: err.message });
    }
  }
};
