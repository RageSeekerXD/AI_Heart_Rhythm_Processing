/* Модульні тести: журнал операцій (Application/js/logger.js) */
describe('Модульні тести', () => {
  describe('logger.js - журнал операцій', () => {
    let log;
    let ui;
    let changes;
    beforeEach(() => {
      ui = { list: document.createElement('ol'), count: document.createElement('span'), empty: document.createElement('div') };
      changes = [];
      log = new HR.OperationLog({ ...ui, onChange: (n) => changes.push(n) });
    });

    it('додає записи чотирьох рівнів, оновлює лічильник і заглушку', () => {
      expect(log.entries).to.be.empty;
      log.info('a');
      log.success('b');
      log.warn('c');
      log.error('d');
      expect(log.entries.map((e) => e.level)).to.deep.equal(['info', 'success', 'warn', 'error']);
      expect(ui.list.children).to.have.lengthOf(4);
      expect(ui.count.textContent).to.equal('4');
      expect(ui.empty.hidden).to.be.true;
      expect(changes).to.deep.equal([1, 2, 3, 4]);
      expect(ui.list.lastElementChild.className).to.include('log-error');
    });

    it('текст повідомлення вставляється як текст, а не HTML (захист від ін’єкції розмітки)', () => {
      log.error('<img src=x onerror="window.__xss = 1"><b>жирний</b>');
      const item = ui.list.lastElementChild;
      expect(item.querySelector('img')).to.be.null;
      expect(item.querySelector('b')).to.be.null;
      expect(item.textContent).to.include('<b>жирний</b>');
    });

    it('toText: заголовок, кількість записів, дата, час і рівень кожного запису, рядки через CRLF', () => {
      log.info('Перший');
      log.warn('Другий');
      const text = log.toText();
      const lines = text.split('\r\n');
      expect(lines[0]).to.include('Журнал операцій');
      expect(lines[2]).to.equal('Записів: 2');
      expect(lines[4]).to.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \[INFO\] {3}Перший$/);
      expect(lines[5]).to.match(/\[WARN\] {3}Другий$/);
      expect(text.endsWith('\r\n')).to.be.true;
    });

    it('clear: видаляє всі записи і показує заглушку', () => {
      log.info('a');
      log.clear();
      expect(log.entries).to.be.empty;
      expect(ui.list.children).to.have.lengthOf(0);
      expect(ui.count.textContent).to.equal('0');
      expect(ui.empty.hidden).to.be.false;
    });
  });
});
