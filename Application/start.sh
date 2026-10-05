#!/bin/sh
# Запуск застосунку «Розпізнавання серцевого ритму» (brain.js) у macOS / Linux.
# Відкриває index.html у браузері за замовчуванням. Параметр --check — лише перевірка файлів.
cd "$(dirname "$0")" || exit 1
if [ ! -f index.html ] || [ ! -f lib/brain-browser.js ]; then
  echo "[ПОМИЛКА] Не знайдено index.html або lib/brain-browser.js поруч зі скриптом." >&2
  exit 1
fi
if [ "$1" = "--check" ]; then
  echo "[OK] Файли застосунку на місці"
  exit 0
fi
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open index.html
elif command -v open >/dev/null 2>&1; then
  open index.html
else
  echo "Відкрийте файл index.html у браузері вручну." >&2
  exit 1
fi