/* Запуск Mocha і збирання результатів у window.TEST_REPORT, звідки їх
   забирає сценарій tests\run-tests.ps1 (JSON для звіту). */
(function () {
  'use strict';

  const results = [];
  const fullSuite = (test) => {
    const parts = [];
    for (let s = test.parent; s && !s.root; s = s.parent) parts.unshift(s.title);
    return parts;
  };
  const level = (suites) => (suites[0] && suites[0].startsWith('Інтеграційні') ? 'integration' : 'unit');

  const runner = mocha.run();
  const record = (test, state, err) => {
    const suites = fullSuite(test);
    results.push({
      level: level(suites),
      suite: suites.join(' › '),
      title: test.title,
      state,
      durationMs: test.duration ?? 0,
      error: err ? String(err.message || err) : null,
    });
  };
  runner.on('pass', (test) => record(test, 'passed'));
  runner.on('fail', (test, err) => record(test, 'failed', err));
  runner.on('pending', (test) => record(test, 'pending'));
  runner.on('end', () => {
    const stats = runner.stats || {};
    const passed = results.filter((r) => r.state === 'passed').length;
    const failed = results.filter((r) => r.state === 'failed').length;
    const summary = document.getElementById('summary');
    summary.textContent = `Тестів: ${results.length}; успішно: ${passed}; з помилками: ${failed}; час: ${((stats.duration || 0) / 1000).toFixed(1)} с`;
    summary.className = failed ? 'fail' : 'ok';
    window.TEST_REPORT = {
      startedAt: stats.start ? new Date(stats.start).toISOString() : null,
      durationMs: stats.duration || 0,
      userAgent: navigator.userAgent,
      totals: { tests: results.length, passed, failed, pending: results.filter((r) => r.state === 'pending').length },
      facts: T.facts,
      tests: results,
    };
  });
})();
