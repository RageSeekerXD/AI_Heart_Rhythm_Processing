@echo off
chcp 65001 >nul
rem ============================================================
rem  Запуск застосунку «Розпізнавання серцевого ритму» (brain.js)
rem  1) переходить у папку, де лежить цей файл;
rem  2) перевіряє наявність index.html і бібліотеки lib\brain-browser.js;
rem  3) відкриває index.html у браузері за замовчуванням.
rem  Node.js, сервер чи інші інструменти НЕ потрібні.
rem  Параметр --check: лише перевірити файли, браузер не відкривати.
rem ============================================================
cd /d "%~dp0"
if not exist "index.html" (
  echo [ПОМИЛКА] Не знайдено index.html поруч із start.bat.
  pause
  exit /b 1
)
if not exist "lib\brain-browser.js" (
  echo [ПОМИЛКА] Не знайдено бібліотеку lib\brain-browser.js.
  pause
  exit /b 1
)
if /i "%~1"=="--check" (
  echo [OK] Файли застосунку на місці: index.html, lib\brain-browser.js
  exit /b 0
)
echo Відкриваю застосунок у браузері...
start "" "%~dp0index.html"
exit /b 0