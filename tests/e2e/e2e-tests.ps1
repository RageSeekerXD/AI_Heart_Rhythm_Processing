<#
  Наскрізні (E2E) тести: сценарії користувача в реальному застосунку
  Application/index.html. Кожен сценарій починається з чистого завантаження
  сторінки; дії виконуються справжніми кліками миші й натисканнями клавіш
  (див. cdp.ps1). Підключається з run-tests.ps1 через dot-sourcing.
#>

$script:E2E = @{
  Results = (New-Object System.Collections.Generic.List[object])
  Notes = (New-Object System.Collections.Generic.List[string])
  Coverage = (New-Object System.Collections.Generic.List[object])
  RunDir = ''; Downloads = ''; Shots = ''; AppUrl = ''; Fixtures = ''; Grep = ''
}
Add-Type -AssemblyName System.Drawing

# ------------------------------------------------------------------ допоміжні функції
function Note([string]$Text) { $script:E2E.Notes.Add($Text) }
function Fail([string]$Message) { throw "Перевірка не пройшла: $Message" }
function Assert-True($Condition, [string]$Message) { if (-not $Condition) { Fail $Message } }
function Assert-Equal($Actual, $Expected, [string]$Message) { if ("$Actual" -ne "$Expected") { Fail "$Message (очікувалося «$Expected», фактично «$Actual»)" } }
function Assert-Contains([string]$Text, [string]$Part, [string]$Message) {
  if (-not $Text -or -not $Text.Contains($Part)) { Fail "$Message (немає «$Part» у «$Text»)" }
}

function Js([string]$Expression) { Invoke-Js $Expression }
function Sel([string]$Selector) { ConvertTo-JsonText $Selector }
# Текст елемента; нерозривні пробіли (розділювач тисяч) замінено звичайними
function Text([string]$Selector) {
  [string](Js "(() => { const e = document.querySelector($(Sel $Selector)); return e ? e.textContent.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim() : null; })()")
}
function Is-Disabled([string]$Selector) { [bool](Js "document.querySelector($(Sel $Selector)).disabled") }
function Is-Shown([string]$Selector) { [bool](Js "(() => { const e = document.querySelector($(Sel $Selector)); return !!e && !e.hidden && e.getClientRects().length > 0; })()") }
function Log-Messages([string]$Level) { @(Js "HR.app.log.entries.filter(e => e.level === '$Level').map(e => e.message.replace(/[  ]/g, ' '))") }
function Last-Log([string]$Level) { $m = @(Log-Messages $Level); if ($m.Count) { [string]$m[-1] } else { '' } }
function Log-Count { [int](Js 'HR.app.log.entries.length') }
function Fixture([string]$Name) { Join-Path $script:E2E.Fixtures $Name }
function Wait-Idle([double]$TimeoutSec = 120) { Wait-Js 'HR.app.state.busy === null' $TimeoutSec 'завершення операції' }
function Pct($Fraction) { '{0:N1} %' -f ([double]$Fraction * 100) }
# Контрольна сума зразків набору (клас, вибірка, значення) - для порівняння наборів
function Dataset-Hash { [string](Js "(() => { const ds = HR.app.state.dataset; if (!ds) return null; let h = 0; for (const s of ds.samples) { for (const ch of s.label + s.split + s.bpm.join(',') + ';') h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; } return ds.samples.length + ':' + (h >>> 0).toString(16); })()") }

# Чистий старт застосунку (перед цим - знімок покриття коду попередньої сторінки)
function Reset-App([int]$Width = 1440, [int]$Height = 1000, [switch]$Mobile) {
  $script:E2E.Coverage.Add(@(Get-CoverageSnapshot))
  Set-Viewport $Width $Height -Mobile:$Mobile
  Open-Page $script:E2E.AppUrl 'window.HR && HR.app && HR.app.log.entries.length >= 2'
  $script:Cdp.Dialogs.Clear()
  $script:Cdp.Exceptions.Clear()
  $script:Cdp.DialogAccept = $true
}

function Set-Fields([System.Collections.IDictionary]$Fields) { foreach ($k in $Fields.Keys) { Set-Field "#$k" ([string]$Fields[$k]) } }
function Generate-Data([System.Collections.IDictionary]$Fields = @{}) {
  Set-Fields $Fields
  Click-Element '#btnGenerate'
  Wait-Idle 60
}
function Train-Model([System.Collections.IDictionary]$Fields = @{}) {
  Set-Fields $Fields
  Click-Element '#btnTrain'
  Wait-Idle 180
}
# Типова підготовка: набір з seed 42 і навчена мережа з типовими параметрами
function Prepare-Trained { Generate-Data ([ordered]@{ seed = 42 }); Train-Model; Assert-True (Js 'HR.app.state.model !== null') 'модель навчена' }

# Введення послідовності; пауза - як у користувача, який переводить погляд на кнопку
function Enter-Sequence([string]$Text) { Set-Field '#seqInput' $Text; Start-Sleep -Milliseconds 450 }
function Result-Label { Js 'HR.app.state.lastResult ? HR.app.state.lastResult.result.label : null' }
function Recognize-Text([string]$Text) {
  Enter-Sequence $Text
  Click-Element '#btnRecognize'
  Wait-Js 'HR.app.state.lastResult !== null || !document.querySelector("#errRecognize").hidden' 5 'результат або повідомлення про помилку'
}

# Збереження файлу кнопкою застосунку і очікування файлу в папці завантажень
function Save-Via([string]$Button) {
  $before = Js 'HR.app.state.lastSave ? HR.app.state.lastSave.at.getTime() : 0'
  Click-Element $Button
  Wait-Js "HR.app.state.lastSave && HR.app.state.lastSave.at.getTime() !== $before" 20 "збереження файлу ($Button)"
  Wait-Download $script:E2E.Downloads ([string](Js 'HR.app.state.lastSave.name'))
}
function File-Head($File, [int]$Count) {
  $fs = [IO.File]::OpenRead($File.FullName)
  try { $b = New-Object byte[] $Count; [void]$fs.Read($b, 0, $Count); , $b } finally { $fs.Close() }
}
function Image-Size($File) {
  $img = [Drawing.Image]::FromFile($File.FullName)
  try { "$($img.Width)×$($img.Height)" } finally { $img.Dispose() }
}
function Kb($File) { '{0:N1} КБ' -f ($File.Length / 1KB) }

# ------------------------------------------------------------------ виконання сценарію
function Test-Case {
  param([string]$Id, [string]$Kind, [string]$What, [string]$Given, [string]$Expected, [scriptblock]$Body)
  if ($script:E2E.Grep -and "$Id $What" -notmatch $script:E2E.Grep) { return }
  $script:E2E.Notes.Clear()
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $status = 'passed'
  $err = $null
  try {
    Reset-App
    $null = & $Body
    # для кожного сценарію: жодних необроблених винятків JavaScript
    $unexpected = @(Js "HR.app.log.entries.filter(e => e.message.startsWith('Неочікувана помилка')).map(e => e.message)")
    Assert-True ($script:Cdp.Exceptions.Count -eq 0) "необроблені винятки JavaScript: $($script:Cdp.Exceptions -join '; ')"
    Assert-True ($unexpected.Count -eq 0) "у журналі є «Неочікувана помилка»: $($unexpected -join '; ')"
  } catch {
    $status = 'failed'
    $err = $_.Exception.Message
    try { Save-Screenshot (Join-Path $script:E2E.Shots "FAIL_$Id.png") } catch {}
  }
  $sw.Stop()
  $script:E2E.Results.Add([ordered]@{
      id = $Id; kind = $Kind; what = $What; given = $Given; expected = $Expected
      actual = ($script:E2E.Notes -join '; '); status = $status; error = $err; durationMs = [int]$sw.ElapsedMilliseconds
    })
  $mark = if ($status -eq 'passed') { 'PASS' } else { 'FAIL' }
  Write-Host ("  [{0}] {1} {2} ({3:N1} с)" -f $mark, $Id, $What, ($sw.ElapsedMilliseconds / 1000)) -ForegroundColor $(if ($status -eq 'passed') { 'Green' } else { 'Red' })
  if ($err) { Write-Host "         $err" -ForegroundColor DarkRed }
}

# ------------------------------------------------------------------ сценарії
function Invoke-E2ETests {
  param([string]$AppUrl, [string]$RunDir, [string]$Fixtures, [string]$Grep = '')
  $script:E2E.AppUrl = $AppUrl
  $script:E2E.RunDir = $RunDir
  $script:E2E.Downloads = Join-Path $RunDir 'downloads'
  $script:E2E.Shots = Join-Path $RunDir 'screenshots'
  $script:E2E.Fixtures = $Fixtures
  $script:E2E.Grep = $Grep
  Set-DownloadFolder $script:E2E.Downloads
  New-Item -ItemType Directory -Force $script:E2E.Shots | Out-Null
  $shots = $script:E2E.Shots
  # E2E виконуються в умовах користувача: ваги мережі ініціалізуються випадково
  # (Math.random у brain.js), порядок прикладів на епохах теж випадковий, тому
  # навчання щоразу трохи інше. Перевірки якості тут - нижня межа критерію
  # приймання (точність ≥ 90 %); медіану ≥ 95 % перевіряє інтеграційний тест стабільності.

  # ================================================================ стан і основний сценарій
  Test-Case 'E2E-01' 'Позитивний' 'Початковий стан інтерфейсу' 'Сторінка щойно відкрита з диска (file://)' `
    'brain.js завантажено; доступна лише генерація даних і завантаження файлів; кнопки навчання, розпізнавання і збереження недоступні' {
    Assert-True (Js 'HR.app.state.brainLoaded') 'бібліотека brain.js завантажилася'
    Assert-True (-not (Is-Shown '#libError')) 'банер помилки бібліотеки прихований'
    Assert-True (-not (Is-Disabled '#btnGenerate')) 'кнопка «Згенерувати дані» доступна'
    $locked = @('#btnTrain', '#btnStop', '#btnEvaluate', '#btnSaveModel', '#btnSaveData', '#btnRecognize', '#btnSaveImage', '#btnSaveResult', '#btnSaveCharts') | Where-Object { Is-Disabled $_ }
    Assert-Equal $locked.Count 9 'недоступних кнопок'
    Assert-Equal (Text '#stateData .step-state') 'не згенеровано' 'стан кроку 1'
    Assert-Equal (Text '#stateModel .step-state') 'не навчена' 'стан кроку 2'
    Assert-Equal (Log-Count) 2 'записів у журналі'
    Note "brain.js завантажено; недоступні 9 з 9 кнопок, яким потрібні дані; журнал: 2 записи (запуск, порядок роботи)"
    Save-Screenshot (Join-Path $shots 'E2E-01_початковий_стан.png')
  }

  Test-Case 'E2E-02' 'Позитивний' 'Основний сценарій: генерація → навчання → розпізнавання → збереження результату' 'Типові параметри, seed 42; приклад аритмії зі статті' `
    'Набір 1 000 послідовностей (800 / 200); точність на тесті ≥ 90 %; результат «Аритмія»; PNG 1400 × 800 і TXT з висновком збережено' {
    Generate-Data ([ordered]@{ seed = 42 })
    Assert-Equal (Js 'document.querySelector("#progData").dataset.state') 'done' 'стан прогрес-бару генерації'
    Assert-Contains (Text '#progData .progress-text') 'Готово: 1 000 послідовностей' 'підпис прогрес-бару'
    Assert-Equal (Js 'HR.app.state.dataset.stats.train + "/" + HR.app.state.dataset.stats.test') '800/200' 'розбиття'
    Assert-Equal (Js 'document.querySelectorAll("#gallery .thumb").length') 8 'мініатюр у галереї'
    Train-Model
    $ev = Js 'HR.app.state.model.evaluation'
    Assert-Equal (Js 'document.querySelector("#progTrain").dataset.state') 'done' 'стан прогрес-бару навчання'
    Assert-True ([double]$ev['accuracy'] -ge 0.9) "точність $(Pct $ev['accuracy']) ≥ 90 %"
    Assert-Contains (Text '#stateModel .step-state') 'навчена, точність' 'стан кроку 2'
    Click-Element '.chip[data-example="irregular"]'
    Wait-Js 'HR.app.state.lastResult !== null' 5
    Assert-Equal (Result-Label) 'arrhythmia' 'клас прикладу аритмії'
    Assert-True (-not (Js 'document.querySelector("#resultWrap").classList.contains("is-empty")')) 'зображення результату показано'
    $badge = Text '#resultSummary .verdict-badge'
    Select-Option '#imgFormat' 'png'
    $png = Save-Via '#btnSaveImage'
    $head = File-Head $png 8
    Assert-Equal (($head | ForEach-Object { '{0:X2}' -f $_ }) -join ' ') '89 50 4E 47 0D 0A 1A 0A' 'сигнатура PNG'
    Assert-Equal (Image-Size $png) '1400×800' 'розмір зображення'
    $txt = Save-Via '#btnSaveResult'
    $content = [IO.File]::ReadAllText($txt.FullName, [Text.Encoding]::UTF8)
    Assert-Contains $content 'ПІДСУМОК: Аритмія' 'висновок у файлі результату'
    Note ("набір 1 000 (800 / 200); точність {0}, TP {1}, TN {2}, FP {3}, FN {4}; результат «{5}»; {6} - 1400×800, {7}; {8} - містить «ПІДСУМОК: Аритмія»" -f (Pct $ev['accuracy']), $ev['tp'], $ev['tn'], $ev['fp'], $ev['fn'], $badge, $png.Name, (Kb $png), $txt.Name)
    Save-Screenshot (Join-Path $shots 'E2E-02_крок3_результат.png') '#step3'
    Save-Screenshot (Join-Path $shots 'E2E-02_крок2_навчання.png') '#step2'
    Save-Screenshot (Join-Path $shots 'E2E-02_крок1_дані.png') '#step1'
  }

  Test-Case 'E2E-03' 'Граничний' 'Введення послідовності з клавіатури і негайне натискання Enter' 'Навчена модель; користувач набирає 10 значень і одразу (до 300 мс) натискає Enter' `
    'Результат «Аритмія» з''являється і залишається на екрані; кнопка «Зберегти результат» доступна' {
    Prepare-Trained
    Set-Field '#seqInput' '74, 57, 62, 103, 66, 75, 57, 87, 113, 91'
    Send-Key 'Enter'
    Wait-Js 'HR.app.state.lastResult !== null' 5 'результат розпізнавання'
    Note "одразу після Enter: «$(Text '#resultSummary .verdict-badge')»"
    Start-Sleep -Milliseconds 1000
    $label = Result-Label
    if ($label) { Note "через 1 с: «$(Text '#resultSummary .verdict-badge')», кнопка «Зберегти результат» $(if (Is-Disabled '#btnSaveResult') { 'недоступна' } else { 'доступна' })" }
    else { Note 'через 1 с результат зник: на зображенні «НЕ КЛАСИФІКОВАНО», кнопка «Зберегти результат» недоступна' }
    Save-Screenshot (Join-Path $shots 'E2E-03_через_1с.png') '#step3'
    Assert-Equal $label 'arrhythmia' 'результат через 1 с після Enter'
    Assert-True (-not (Is-Disabled '#btnSaveResult')) 'кнопка «Зберегти результат» доступна'
  }

  # ================================================================ параметри генерації
  Test-Case 'E2E-04' 'Негативний' 'Некоректні параметри генерації (введення з клавіатури, Enter)' 'Кількість у класі 5, K = 13' `
    'Генерацію не запущено; список помилок над формою; поля підсвічено (aria-invalid), фокус на першому; запис ERROR у журналі' {
    Set-Field '#perClass' '5'
    Set-Field '#seqLen' '13'
    Send-Key 'Enter'
    Wait-Js '!document.querySelector("#errData").hidden' 5 'список помилок'
    $items = @(Js 'Array.from(document.querySelectorAll("#errData li")).map(li => li.textContent)')
    Assert-Equal $items.Count 2 'кількість повідомлень'
    Assert-Equal (Js 'document.querySelector("#perClass").getAttribute("aria-invalid")') 'true' 'підсвічування поля perClass'
    Assert-Equal (Js 'document.querySelector("#seqLen").getAttribute("aria-invalid")') 'true' 'підсвічування поля seqLen'
    Assert-Equal (Js 'document.activeElement.id') 'perClass' 'фокус'
    Assert-True ($null -eq (Js 'HR.app.state.dataset')) 'набір не створено'
    Assert-Contains (Last-Log 'error') 'Генерацію не запущено' 'запис у журналі'
    Note "показано 2 помилки: «$($items[0])», «$($items[1])»; поля підсвічено, фокус у полі «Кількість»; набір не створено"
    Save-Screenshot (Join-Path $shots 'E2E-04_помилки_параметрів.png') '#formData'
  }

  Test-Case 'E2E-05' 'Граничний' 'Мінімальні допустимі параметри генерації і навчання' 'N = 10 у класі, K = 3, тестова частка 5 %, 200 епох; послідовність з 3 значень' `
    'Набір 20 послідовностей (18 / 2) з попередженням «менше 250»; модель 3–8–2 навчається; послідовність рівно з K значень дає 1 вікно' {
    Generate-Data ([ordered]@{ perClass = 10; seqLen = 3; testPct = 5; seed = 1 })
    Assert-Equal (Js 'HR.app.state.dataset.stats.total') 20 'кількість послідовностей'
    Assert-Equal (Js 'HR.app.state.dataset.windowSize') 3 'K'
    Assert-Equal (Js 'HR.app.state.dataset.stats.test') 2 'тестових прикладів'
    Assert-Contains (Last-Log 'warn') 'менше 250' 'попередження про малий набір'
    Train-Model ([ordered]@{ epochs = 200 })
    Assert-Equal (Js 'HR.app.state.model.architecture') '3–8–2' 'архітектура'
    $r = Recognize-Text '72, 70, 72'
    Assert-Equal (Js 'HR.app.state.lastResult.result.windows.length') 1 'кількість вікон'
    Note "набір 20 (18 / 2), K = 3, WARN «менше 250»; мережа 3–8–2, оцінювання на 2 прикладах; [72, 70, 72] → 1 вікно, «$(Text '#resultSummary .verdict-badge')»"
  }

  Test-Case 'E2E-06' 'Граничний' 'Максимальні допустимі параметри генерації' 'N = 5 000 у класі, K = 12, тестова частка 50 %, seed 4294967295; 30 епох' `
    'Набір 10 000 послідовностей (5 000 / 5 000), K = 12; генерація і навчання завершуються без помилок' {
    Generate-Data ([ordered]@{ perClass = 5000; seqLen = 12; testPct = 50; seed = '4294967295' })
    Assert-Equal (Js 'HR.app.state.dataset.stats.total') 10000 'кількість послідовностей'
    Assert-Equal (Js 'HR.app.state.dataset.stats.test') 5000 'тестових прикладів'
    Assert-Equal (Js 'HR.app.state.dataset.seed') 4294967295 'зерно'
    $gen = Text '#progData .progress-text'
    Train-Model ([ordered]@{ epochs = 30 })
    Assert-Equal (Js 'HR.app.state.model.training.epochsDone') 30 'епох'
    Note "«$gen»; мережа 12–8–2 навчилася за 30 епох, точність $(Pct (Js 'HR.app.state.model.evaluation.accuracy')) на 5 000 прикладах"
  }

  Test-Case 'E2E-07' 'Негативний' 'Значення на 1 за межами допустимих (з обох боків)' '1) N = 5001, K = 2, частка 51 %, seed 4294967296; 2) N = 9, K = 13, частка 4 %, seed «abc»' `
    'Обидва рази - 4 повідомлення про помилки, генерацію не запущено' {
    Generate-Data ([ordered]@{ perClass = 5001; seqLen = 2; testPct = 51; seed = '4294967296' })
    $a = @(Js 'Array.from(document.querySelectorAll("#errData li")).map(li => li.textContent)')
    Generate-Data ([ordered]@{ perClass = 9; seqLen = 13; testPct = 4; seed = 'abc' })
    $b = @(Js 'Array.from(document.querySelectorAll("#errData li")).map(li => li.textContent)')
    Assert-Equal $a.Count 4 'помилок у першому випадку'
    Assert-Equal $b.Count 4 'помилок у другому випадку'
    Assert-True ($null -eq (Js 'HR.app.state.dataset')) 'набір не створено'
    Assert-Equal (Js 'document.querySelectorAll("#formData [aria-invalid=true]").length') 4 'підсвічених полів'
    # з некоректними параметрами кроку 1 не створюється й випадковий приклад
    Click-Element '.chip[data-random="normal"]'
    Assert-Contains (Last-Log 'error') 'Випадковий приклад не створено' 'випадковий приклад з некоректними параметрами'
    Note "1) 4 помилки; 2) 4 помилки, зокрема «$($b[-1])»; набір не створено; «Випадкова норма» теж відхилена з поясненням"
  }

  Test-Case 'E2E-08' 'Граничний' 'Нижня межа норми і максимальний допуск Tol(r)' 'Мін. ЧСС норми 30, Tol(r) = 30 (кожне значення окремо допустиме), seed 42' `
    'Генерацію не запущено: поля підсвічено, пояснення, що ЧСС норми мінус допуск не може бути меншою за 20 уд/хв' {
    Generate-Data ([ordered]@{ normMin = 30; tol = 30; seed = 42 })
    $min = Js 'HR.app.state.dataset ? HR.app.state.dataset.stats.minBpm : null'
    Save-Screenshot (Join-Path $shots 'E2E-08_нижня_межа_норми.png') '#step1'
    if ($null -ne $min) {
      $low = Js 'HR.app.state.dataset.samples.flatMap(s => s.bpm).filter(v => v < 20).length'
      Note "набір згенеровано; мінімальна ЧСС $min уд/хв; значень < 20 уд/хв: $low"
      Fail "згенеровано нефізіологічні значення ЧСС (мінімум $min уд/хв)"
    }
    $msg = Text '#errData li'
    Note "генерацію не запущено: «$msg»"
    Assert-Contains $msg '20 уд/хв' 'пояснення'
    Assert-Equal (Js 'document.querySelector("#tol").getAttribute("aria-invalid")') 'true' 'підсвічування поля Tol'
  }

  # ================================================================ навчання
  Test-Case 'E2E-09' 'Негативний' 'Некоректні параметри навчання' 'Епох 0, швидкість 1, момент 0, шари «abc», рання зупинка з помилкою 0,6' `
    'Навчання не запущено; 5 повідомлень про помилки; модель не створено' {
    Generate-Data ([ordered]@{ seed = 42 })
    Click-Element 'label[for="earlyStop"]'
    Train-Model ([ordered]@{ epochs = 0; lr = 1; momentum = 0; hidden = 'abc'; errThresh = '0.6' })
    $items = @(Js 'Array.from(document.querySelectorAll("#errTrain li")).map(li => li.textContent)')
    Assert-Equal $items.Count 5 'кількість повідомлень'
    Assert-True ($null -eq (Js 'HR.app.state.model')) 'модель не створено'
    Assert-Contains (Last-Log 'error') 'Навчання не запущено' 'запис у журналі'
    Note "5 помилок, напр. «$($items[1])»; модель не створено"
    Save-Screenshot (Join-Path $shots 'E2E-09_помилки_навчання.png') '#formTrain'
  }

  Test-Case 'E2E-10' 'Граничний' 'Навчання з мінімальною кількістю епох' 'Епох: 1' `
    'Виконано 1 епоху; прогрес-бар 100 %; графіки й таблиця історії показують одну епоху; оцінювання виконано' {
    Generate-Data ([ordered]@{ seed = 42 })
    Train-Model ([ordered]@{ epochs = 1 })
    Assert-Equal (Js 'HR.app.state.model.training.epochsDone') 1 'епох'
    Assert-Contains (Text '#progTrain .progress-text') 'Епоха 1 з 1 — завершено' 'підпис прогрес-бару'
    Assert-Equal (Js 'document.querySelectorAll("#historyBody tr").length') 1 'рядків історії'
    Assert-True (Js 'HR.app.state.model.evaluation !== null') 'оцінювання виконано'
    Note "«$(Text '#progTrain .progress-text')»; 1 рядок історії; точність після 1 епохи $(Pct (Js 'HR.app.state.model.evaluation.accuracy'))"
  }

  Test-Case 'E2E-11' 'Позитивний' 'Зупинка навчання кнопкою «Зупинити»' '20 000 епох; натискання «Зупинити», коли пройдено ≥ 3 %' `
    'Навчання припиняється після поточної епохи; прогрес-бар у стані «зупинено»; модель збережена в сеансі й оцінена; WARN у журналі' {
    Generate-Data ([ordered]@{ seed = 42 })
    Set-Field '#epochs' '20000'
    Click-Element '#btnTrain'
    Wait-Js 'HR.app.state.busy === "train" && parseFloat(document.querySelector("#progTrain .progress-fill").style.width) >= 3' 60 'прогрес навчання ≥ 3 %'
    Click-Element '#btnStop'
    $stopDisabled = Is-Disabled '#btnStop'
    Wait-Idle 60
    $t = Js 'HR.app.state.model.training'
    Assert-Equal $t['stopReason'] 'stopped' 'причина завершення'
    Assert-True ([int]$t['epochsDone'] -lt 20000) 'виконано менше епох, ніж задано'
    Assert-True $stopDisabled 'кнопка «Зупинити» неактивна після натискання'
    Assert-Equal (Js 'document.querySelector("#progTrain").dataset.state') 'stopped' 'стан прогрес-бару'
    Assert-Contains (Last-Log 'warn') 'Навчання зупинено користувачем' 'запис у журналі'
    Assert-True (Js 'HR.app.state.model.evaluation !== null') 'оцінювання після зупинки'
    Note "зупинено на епосі $($t['epochsDone']) з 20 000; «$(Text '#progTrain .progress-text')»; точність $(Pct (Js 'HR.app.state.model.evaluation.accuracy'))"
    Save-Screenshot (Join-Path $shots 'E2E-11_зупинка_навчання.png') '#step2'
  }

  Test-Case 'E2E-12' 'Негативний' 'Спроба змінити дані або зберегти модель до завершення навчання' 'Триває навчання (20 000 епох); клік по «Зберегти модель» і «Згенерувати дані»' `
    'Під час навчання недоступні генерація, завантаження файлів, збереження моделі й графіків, оцінювання, розпізнавання; кліки нічого не запускають; після зупинки все знову доступне' {
    Generate-Data ([ordered]@{ seed = 42 })
    Set-Field '#epochs' '20000'
    Click-Element '#btnTrain'
    Wait-Js 'HR.app.state.busy === "train"' 10
    $locked = @('#btnGenerate', '#btnTrain', '#btnEvaluate', '#btnSaveModel', '#btnSaveCharts', '#btnSaveData', '#btnRecognize', '#fileData', '#fileModel', '#perClass', '#epochs')
    $notLocked = @($locked | Where-Object { -not (Is-Disabled $_) })
    $logBefore = Js 'HR.app.log.entries.filter(e => e.message.startsWith("Генерація даних") || e.message.startsWith("Збережено")).length'
    Click-Element '#btnSaveModel'
    Click-Element '#btnGenerate'
    Start-Sleep -Milliseconds 300
    $logAfter = Js 'HR.app.log.entries.filter(e => e.message.startsWith("Генерація даних") || e.message.startsWith("Збережено")).length'
    $downloads = @(Get-ChildItem $script:E2E.Downloads -Filter 'rhythm_model_*' -ErrorAction SilentlyContinue).Count
    Click-Element '#btnStop'
    Wait-Idle 60
    Assert-Equal $notLocked.Count 0 "доступні під час навчання: $($notLocked -join ', ')"
    Assert-Equal $logAfter $logBefore 'кліки по недоступних кнопках нічого не запустили'
    Assert-Equal $downloads 0 'файл моделі не збережено'
    Assert-True (-not (Is-Disabled '#btnGenerate') -and -not (Is-Disabled '#btnSaveModel')) 'після зупинки кнопки знову доступні'
    Note "під час навчання недоступні всі 11 перевірених елементів; кліки по «Зберегти модель» і «Згенерувати дані» нічого не запустили; після зупинки кнопки доступні"
  }

  Test-Case 'E2E-13' 'Позитивний' 'Рання зупинка за цільовою помилкою' 'Прапорець «Рання зупинка» (клік), помилка ≤ 0,05; епох 5 000' `
    'Поле помилки стає доступним; навчання зупиняється раніше 5 000 епох з причиною «досягнуто цільової помилки»' {
    Generate-Data ([ordered]@{ seed = 42 })
    Assert-True (Is-Disabled '#errThresh') 'поле помилки спочатку недоступне'
    Click-Element 'label[for="earlyStop"]'
    Assert-True (-not (Is-Disabled '#errThresh')) 'поле помилки доступне після кліку'
    Train-Model ([ordered]@{ epochs = 5000; errThresh = '0.05' })
    $t = Js 'HR.app.state.model.training'
    Assert-Equal $t['stopReason'] 'threshold' 'причина завершення'
    Assert-True ([int]$t['epochsDone'] -lt 5000) 'зупинено раніше'
    Assert-True ([double]$t['finalError'] -le 0.05) 'помилка ≤ 0,05'
    Note "зупинено на епосі $($t['epochsDone']), помилка $('{0:N4}' -f [double]$t['finalError']); «$(Text '#progTrain .progress-text')»"
  }

  # ================================================================ розпізнавання
  Test-Case 'E2E-14' 'Негативний' 'Розпізнавання без навченої моделі' 'Модель не навчена; введено 5 значень, натиснуто Enter' `
    'Показано ЕКГ-смужку без класифікації («НЕ КЛАСИФІКОВАНО»); кнопка «Розпізнати» недоступна, Enter нічого не класифікує; зображення можна зберегти, результат - ні' {
    Enter-Sequence '72, 68, 75, 71, 69'
    Send-Key 'Enter'
    Start-Sleep -Milliseconds 200
    Assert-True (-not (Js 'document.querySelector("#resultWrap").classList.contains("is-empty")')) 'зображення показано'
    Assert-True (Is-Disabled '#btnRecognize') 'кнопка «Розпізнати» недоступна'
    Assert-True ($null -eq (Result-Label)) 'результату немає'
    Assert-True (-not (Is-Disabled '#btnSaveImage')) 'зображення можна зберегти'
    Assert-True (Is-Disabled '#btnSaveResult') 'результат зберегти не можна'
    $file = Save-Via '#btnSaveImage'
    Assert-True ($file.Name -like 'rhythm_preview_*.png') 'ім''я файлу зображення без класифікації'
    Note "ЕКГ-смужка без класифікації; «Розпізнати» недоступна; підказка: «$(Text '#recognizeHint')»; збережено $($file.Name)"
    Save-Screenshot (Join-Path $shots 'E2E-14_без_моделі.png') '#step3'
  }

  Test-Case 'E2E-15' 'Негативний' 'Некоректна послідовність для розпізнавання' 'Навчена модель K = 4; сім некоректних введень (літери, від''ємне число, 1 значення, 3 значення, ЧСС 10 уд/хв, 201 значення, порожнє поле)' `
    'Для кожного - зрозуміле повідомлення під полем і запис ERROR; результат не створюється; застосунок працює далі' {
    Prepare-Trained
    $cases = [ordered]@{
      '72, abc, 75'    = 'Це не додатні числа: abc'
      '-72, 68, 75, 71' = 'Це не додатні числа: -72'
      '72'             = 'Потрібно щонайменше 2 значення'
      '72, 68, 75'     = 'Потрібно щонайменше 4 значення'
      '10, 20, 30, 40' = 'ЧСС має бути в межах 20–300 уд/хв'
      ((@('70') * 201) -join ', ') = 'Забагато значень: максимум 200'
      ''               = 'Введіть послідовність чисел'
    }
    $shown = @()
    foreach ($seq in $cases.Keys) {
      $errorsBefore = (Log-Messages 'error').Count
      Enter-Sequence $seq
      Click-Element '#btnRecognize'
      Wait-Js '!document.querySelector("#errRecognize").hidden' 5 "повідомлення для «$seq»"
      Start-Sleep -Milliseconds 400
      $msg = Text '#errRecognize li'
      Assert-Contains $msg $cases[$seq] "повідомлення для «$($seq.Substring(0, [Math]::Min(20, $seq.Length)))»"
      Assert-True ($null -eq (Result-Label)) 'результат не створено'
      Assert-True ((Log-Messages 'error').Count -gt $errorsBefore) 'запис ERROR у журналі'
      $shown += $cases[$seq]
    }
    $ok = Recognize-Text '72, 68, 75, 71, 69, 73'
    Assert-Equal (Result-Label) 'normal' 'після помилок коректна послідовність розпізнається'
    Note "7 з 7 повідомлень відповідають очікуваним; після цього [72, 68, 75, 71, 69, 73] → «$(Text '#resultSummary .verdict-badge')»"
    Enter-Sequence '72, 68, 75'
    Click-Element '#btnRecognize'
    Start-Sleep -Milliseconds 400
    Save-Screenshot (Join-Path $shots 'E2E-15_помилка_послідовності.png') '#formRecognize'
  }

  Test-Case 'E2E-16' 'Граничний' 'Довжина послідовності: рівно K і максимум 200 значень' '1) 4 значення; 2) 200 значень' `
    '1) одне вікно; 2) 197 вікон, зображення побудовано, у таблиці вікон 197 рядків' {
    Prepare-Trained
    Recognize-Text '72, 68, 75, 71'
    Assert-Equal (Js 'HR.app.state.lastResult.result.windows.length') 1 'вікон для 4 значень'
    $values = (1..200 | ForEach-Object { 60 + ($_ * 7) % 40 }) -join ', '
    Recognize-Text $values
    Assert-Equal (Js 'HR.app.state.lastResult.result.windows.length') 197 'вікон для 200 значень'
    Assert-Equal (Js 'document.querySelectorAll("#resultSummary tbody tr").length') 197 'рядків таблиці вікон'
    Note "4 значення → 1 вікно; 200 значень → 197 вікон, «$(Text '#resultSummary .verdict-badge')», аритмічних вікон $(Js 'HR.app.state.lastResult.result.arrhythmicWindows')"
    Save-Screenshot (Join-Path $shots 'E2E-16_200_значень.png') '#resultWrap'
  }

  Test-Case 'E2E-17' 'Позитивний' 'Введення RR-інтервалів у мілісекундах' 'Значення 800, 850, 1000, 750, 820 спочатку в режимі «ЧСС», потім вибрано «RR, мс»' `
    'У режимі ЧСС - підказка вибрати «RR, мс»; після перемикання помилка зникає, послідовність розпізнається, у файлі результату вказано одиниці «RR-інтервали, мс»' {
    Prepare-Trained
    Recognize-Text '800, 850, 1000, 750, 820'
    Assert-Contains (Text '#errRecognize li') 'оберіть одиниці «RR, мс»' 'підказка'
    Click-Element 'label:has(input[name="units"][value="ms"])'
    Wait-Js 'document.querySelector("#errRecognize").hidden' 3 'помилка зникла'
    Click-Element '#btnRecognize'
    Wait-Js 'HR.app.state.lastResult !== null' 5
    Assert-Equal (Js 'HR.app.state.lastResult.units') 'ms' 'одиниці результату'
    $bpm = (Js 'HR.app.state.lastResult.bpm.map(v => v.toFixed(1).replace(".", ",")).join("; ")')
    $txt = Save-Via '#btnSaveResult'
    Assert-Contains ([IO.File]::ReadAllText($txt.FullName, [Text.Encoding]::UTF8)) 'Вхідна послідовність (RR-інтервали, мс): 800, 850, 1000, 750, 820' 'файл результату'
    Note "у режимі ЧСС: «$(Last-Log 'error')»; у режимі мс: ЧСС $bpm → «$(Text '#resultSummary .verdict-badge')»; одиниці записано у файл результату"
  }

  Test-Case 'E2E-18' 'Позитивний' 'Приклади зі статті і випадкові приклади' 'Навчена модель; кнопки 4 прикладів зі статті та по 3 кліки «Випадкова норма» / «Випадкова аритмія»' `
    'Норма → «Нормальний ритм»; аритмія → «Аритмія»; брадикардія і тахікардія → «Нормальний ритм» з попередженням про ЧСС поза нормою; випадкові - відповідного класу' {
    Prepare-Trained
    $expect = [ordered]@{ normal = @('normal', ''); irregular = @('arrhythmia', ''); brady = @('normal', 'брадикардія'); tachy = @('normal', 'тахікардія') }
    $names = @{ normal = 'норма (стаття)'; irregular = 'аритмія (стаття)'; brady = 'брадикардія'; tachy = 'тахікардія' }
    $parts = @()
    foreach ($k in $expect.Keys) {
      Click-Element ".chip[data-example=`"$k`"]"
      Wait-Js "HR.app.state.lastResult !== null && HR.app.state.lastResult.values.length === HR.data.ARTICLE_EXAMPLES['$k'].values.length" 5
      Assert-Equal (Result-Label) $expect[$k][0] "клас прикладу $k"
      if ($expect[$k][1]) { Assert-Contains (Text '#resultSummary') $expect[$k][1] "попередження для $k" }
      $parts += "$($names[$k]) → $(Text '#resultSummary .verdict-badge')"
    }
    foreach ($label in 'normal', 'arrhythmia') {
      for ($i = 0; $i -lt 3; $i++) {
        $count = Log-Count
        Click-Element ".chip[data-random=`"$label`"]"
        Wait-Js "HR.app.log.entries.length > $count && HR.app.state.lastResult !== null" 5
        Assert-Equal (Result-Label) $label "випадковий приклад $label №$($i + 1)"
      }
    }
    Note (($parts -join '; ') + '; випадкові: 3 / 3 норма, 3 / 3 аритмія')
    Click-Element '.chip[data-example="brady"]'
    Wait-Js 'HR.app.state.lastResult && HR.app.state.lastResult.values.length === 5' 5
    Save-Screenshot (Join-Path $shots 'E2E-18_брадикардія.png') '#step3'
  }

  Test-Case 'E2E-19' 'Позитивний' 'Перенесення прикладу з галереї в розпізнавання' 'Клік по першій мініатюрі норми і першій мініатюрі аритмії' `
    'Значення мініатюри з''являються в полі введення і розпізнаються як клас зразка' {
    Prepare-Trained
    foreach ($label in 'normal', 'arrhythmia') {
      $values = Js "HR.app.state.dataset.samples.find(s => s.label === '$label').bpm.join(', ')"
      Click-Element "#gallery .thumb.$label"
      Wait-Js "document.querySelector('#seqInput').value === '$values' && HR.app.state.lastResult !== null" 5
      Assert-Equal (Result-Label) $label "клас зразка $label"
    }
    Note "мініатюри норми і аритмії перенесено в поле і розпізнано правильно (останній: [$(Js 'document.querySelector("#seqInput").value')] → «$(Text '#resultSummary .verdict-badge')»)"
  }

  # ================================================================ файли набору даних
  Test-Case 'E2E-20' 'Позитивний' 'Збереження набору (CSV, JSON) і завантаження назад' 'seed 42 → «Зберегти набір» у CSV і JSON; нове відкриття сторінки; «Завантажити набір…» кожного файлу' `
    'Обидва файли завантажуються в ідентичний набір (та сама контрольна сума, розбиття з файлу); на завантаженому наборі навчається модель' {
    Generate-Data ([ordered]@{ seed = 42 })
    $hash = Dataset-Hash
    Select-Option '#dataFormat' 'csv'
    $csv = Save-Via '#btnSaveData'
    Select-Option '#dataFormat' 'json'
    $json = Save-Via '#btnSaveData'
    Reset-App
    Set-FileInput '#fileData' $csv.FullName
    Wait-Js 'HR.app.state.dataset !== null' 10 'завантаження CSV'
    Assert-Equal (Dataset-Hash) $hash 'набір з CSV'
    Assert-Contains (Last-Log 'success') 'розбиття на вибірки взято з файлу' 'журнал'
    Reset-App
    Set-FileInput '#fileData' $json.FullName
    Wait-Js 'HR.app.state.dataset !== null' 10 'завантаження JSON'
    Assert-Equal (Dataset-Hash) $hash 'набір з JSON'
    Train-Model ([ordered]@{ epochs = 300 })
    Assert-True ([double](Js 'HR.app.state.model.evaluation.accuracy') -ge 0.9) 'точність моделі на завантаженому наборі ≥ 90 %'
    Note "$($csv.Name) ($(Kb $csv)) і $($json.Name) ($(Kb $json)) завантажено, контрольна сума $hash збігається; модель на наборі з JSON - точність $(Pct (Js 'HR.app.state.model.evaluation.accuracy'))"
  }

  Test-Case 'E2E-21' 'Негативний' 'Завантаження некоректних файлів набору' 'Є згенерований набір; файли: dataset-broken.csv (4 помилки), порожній dataset-empty.csv, зображення not-a-dataset.png' `
    'Для кожного - ERROR з поясненням (номери рядків), прогрес-бар у стані помилки; попередній набір не змінюється; навчання на ньому працює' {
    Generate-Data ([ordered]@{ seed = 42 })
    $hash = Dataset-Hash
    $msgs = @()
    foreach ($f in 'dataset-broken.csv', 'dataset-empty.csv', 'not-a-dataset.png') {
      $n = (Log-Messages 'error').Count
      Set-FileInput '#fileData' (Fixture $f)
      Wait-Js "HR.app.log.entries.filter(e => e.level === 'error').length > $n" 10 "помилка для $f"
      Assert-Equal (Js 'document.querySelector("#progData").dataset.state') 'error' "стан прогрес-бару для $f"
      Assert-Equal (Dataset-Hash) $hash "набір після $f"
      $msgs += Last-Log 'error'
    }
    Assert-Contains $msgs[0] 'Знайдено помилок: 4' 'кількість помилок у dataset-broken.csv'
    Assert-Contains $msgs[0] 'рядок 3: невідомий клас «maybe»' 'номер рядка'
    Assert-Contains $msgs[1] 'Файл порожній' 'порожній файл'
    Train-Model ([ordered]@{ epochs = 200 })
    Assert-True (Js 'HR.app.state.model !== null') 'навчання після помилок'
    Note ("broken.csv: «{0}»; empty.csv: «{1}»; png: «{2}»; набір не змінився, навчання працює" -f ($msgs[0] -replace '^.*?: ', ''), ($msgs[1] -replace '^.*?: ', ''), ($msgs[2] -replace '^.*?: ', ''))
  }

  Test-Case 'E2E-22' 'Граничний' 'Файл набору, у якому всі зразки позначено як тестові' 'dataset-all-test.csv: 80 зразків, у стовпці split усюди test; 300 епох' `
    'Набір завантажується з непорожніми навчальною і тестовою вибірками (розбиття виконано автоматично); модель навчається і оцінюється' {
    Set-FileInput '#fileData' (Fixture 'dataset-all-test.csv')
    Wait-Js 'HR.app.state.dataset !== null' 10 'завантаження'
    $train = Js 'HR.app.state.dataset.train.length'
    $test = Js 'HR.app.state.dataset.test.length'
    Note "завантажено: навчальна $train, тестова $test; підказка «$(Text '#trainHint')»"
    Train-Model ([ordered]@{ epochs = 300 })
    Save-Screenshot (Join-Path $shots 'E2E-22_усі_test.png') '#step2'
    $model = Js 'HR.app.state.model'
    if ($null -eq $model) { Note "навчання: «$(Last-Log 'error')»" }
    Assert-True ([int]$train -gt 0) 'навчальна вибірка не порожня'
    Assert-True ($null -ne $model) 'модель навчено'
    Note "навчання завершено, точність $(Pct (Js 'HR.app.state.model.evaluation.accuracy'))"
  }

  Test-Case 'E2E-23' 'Негативний' 'Завантаження набору при частці тестової вибірки поза межами' 'У полі «Тестова вибірка» 100 %; файл без стовпця split (dataset-no-split.csv)' `
    'Набір не завантажується, поле частки підсвічено, пояснення «від 5 до 50 %»; після виправлення на 20 % файл завантажується' {
    Set-Field '#testPct' '100'
    Set-FileInput '#fileData' (Fixture 'dataset-no-split.csv')
    Start-Sleep -Milliseconds 600
    $ds = Js 'HR.app.state.dataset ? HR.app.state.dataset.train.length + " / " + HR.app.state.dataset.test.length : null'
    if ($ds) {
      Note "набір завантажено з розбиттям $ds (навчальна / тестова)"
      Train-Model ([ordered]@{ epochs = 100 })
      Note "навчання: «$(Last-Log 'error')»"
      Fail "набір завантажено з часткою тестової вибірки 100 % ($ds)"
    }
    Save-Screenshot (Join-Path $shots 'E2E-23_частка_100.png') '#formData'
    Assert-Equal (Js 'document.querySelector("#testPct").getAttribute("aria-invalid")') 'true' 'підсвічування поля'
    $msg = Text '#errData li'
    Assert-Contains $msg 'від 5 до 50 %' 'пояснення'
    Set-Field '#testPct' '20'
    Set-FileInput '#fileData' (Fixture 'dataset-no-split.csv')
    Wait-Js 'HR.app.state.dataset !== null' 10
    Note "набір не завантажено: «$msg»; після зміни частки на 20 % - $(Js 'HR.app.state.dataset.train.length') / $(Js 'HR.app.state.dataset.test.length')"
  }

  # ================================================================ файли моделі
  Test-Case 'E2E-24' 'Позитивний' 'Збереження моделі і завантаження після перезапуску сторінки' 'Модель навчена (seed 42); розпізнано приклад аритмії; «Зберегти модель», перезапуск, «Завантажити модель…»' `
    'Після завантаження - та сама архітектура, метрики й графіки навчання; той самий приклад дає ті самі ймовірності' {
    Prepare-Trained
    Click-Element '.chip[data-example="irregular"]'
    Wait-Js 'HR.app.state.lastResult !== null' 5
    $p1 = Js 'HR.app.state.lastResult.result.probs[1]'
    $acc = Js 'HR.app.state.model.evaluation.accuracy'
    $file = Save-Via '#btnSaveModel'
    Reset-App
    Set-FileInput '#fileModel' $file.FullName
    Wait-Js 'HR.app.state.model !== null' 10 'завантаження моделі'
    Assert-Equal (Js 'HR.app.state.model.source') 'file' 'джерело моделі'
    Assert-Equal (Js 'HR.app.state.model.evaluation.accuracy') $acc 'збережена точність'
    Assert-Contains (Text '#progEval .progress-text') 'Збережений результат' 'метрики відновлено'
    Assert-True (Js 'document.querySelectorAll("#historyBody tr").length > 1') 'таблиця історії навчання'
    Click-Element '.chip[data-example="irregular"]'
    Wait-Js 'HR.app.state.lastResult !== null' 5
    $p2 = Js 'HR.app.state.lastResult.result.probs[1]'
    Assert-Equal $p2 $p1 'ймовірність аритмії'
    Note ("{0} ({1}); після перезапуску: мережа {2}, точність {3}, P(аритмія) = {4:N6} до і {5:N6} після" -f $file.Name, (Kb $file), (Js 'HR.app.state.model.architecture'), (Pct $acc), [double]$p1, [double]$p2)
  }

  Test-Case 'E2E-25' 'Негативний' 'Завантаження некоректних файлів моделі' 'model-not-json.json (текст), dataset-small.json (набір даних замість моделі), model-broken.json (межі нормування 130–40)' `
    'Для кожного - ERROR з поясненням; модель не завантажується; «Оцінити» і «Розпізнати» лишаються недоступними' {
    $msgs = @()
    foreach ($f in 'model-not-json.json', 'dataset-small.json', 'model-broken.json') {
      $n = (Log-Messages 'error').Count
      Set-FileInput '#fileModel' (Fixture $f)
      Wait-Js "HR.app.log.entries.filter(e => e.level === 'error').length > $n" 10 "помилка для $f"
      $msgs += (Last-Log 'error') -replace '^.*?»: ', ''
    }
    Assert-Contains $msgs[0] 'не є коректним JSON' 'текстовий файл'
    Assert-Contains $msgs[1] 'Це не файл моделі' 'набір замість моделі'
    Assert-Contains $msgs[2] 'межі нормування' 'некоректні межі'
    Assert-True ($null -eq (Js 'HR.app.state.model')) 'модель не завантажено'
    Assert-True ((Is-Disabled '#btnRecognize') -and (Is-Disabled '#btnEvaluate')) 'кнопки недоступні'
    Note ('«' + ($msgs -join '»; «') + '»')
  }

  Test-Case 'E2E-26' 'Граничний' 'Модель з іншою довжиною послідовності K' 'Модель 8–8–2 збережена; після перезапуску згенеровано набір K = 4 і завантажено цю модель' `
    '«Оцінити на тестовій вибірці» недоступна, підказка про невідповідність K; послідовність з 8 значень розпізнається, з 4 - повідомлення «щонайменше 8 значень»' {
    Generate-Data ([ordered]@{ seqLen = 8; perClass = 200; seed = 3 })
    Train-Model ([ordered]@{ epochs = 300 })
    $file = Save-Via '#btnSaveModel'
    Reset-App
    Generate-Data ([ordered]@{ seed = 42 })
    Set-FileInput '#fileModel' $file.FullName
    Wait-Js 'HR.app.state.model !== null' 10
    Assert-True (Is-Disabled '#btnEvaluate') 'оцінювання недоступне'
    Assert-Contains (Text '#trainHint') 'модель має 8 входів' 'підказка'
    Recognize-Text '74, 57, 62, 103, 66, 75, 57, 87'
    Assert-Equal (Result-Label) 'arrhythmia' 'розпізнавання 8 значень'
    Recognize-Text '72, 68, 75, 71'
    Assert-Contains (Text '#errRecognize li') 'щонайменше 8 значень' 'повідомлення для 4 значень'
    Note "підказка: «$(Text '#trainHint')»; 8 значень → аритмія; 4 значення → «$(Text '#errRecognize li')»"
  }

  # ================================================================ інші файли
  Test-Case 'E2E-27' 'Позитивний' 'Завантаження послідовності з текстового файлу' 'sequence-rr-ms.txt (8 RR-інтервалів у мс з коментарем), sequence-300.txt (300 чисел), sequence-no-numbers.txt' `
    'RR-інтервали розпізнаються з автоматичним вибором одиниць «мс»; з 300 чисел береться 200 (з поясненням у журналі); файл без чисел - ERROR' {
    Prepare-Trained
    Set-FileInput '#fileSeq' (Fixture 'sequence-rr-ms.txt')
    Wait-Js 'HR.app.state.lastResult !== null' 5
    Assert-Equal (Js 'document.querySelector("input[name=units]:checked").value') 'ms' 'одиниці'
    Assert-Equal (Js 'HR.app.state.lastResult.values.length') 8 'значень з файлу'
    $first = "[$(Js 'document.querySelector("#seqInput").value')] мс → «$(Text '#resultSummary .verdict-badge')»"
    Set-FileInput '#fileSeq' (Fixture 'sequence-300.txt')
    Wait-Js 'HR.app.state.lastResult !== null && HR.app.state.lastResult.values.length === 200' 5
    Assert-Contains (Js 'HR.app.state.lastFile.details') 'з 300, взято перші 200' 'пояснення'
    $n = (Log-Messages 'error').Count
    Set-FileInput '#fileSeq' (Fixture 'sequence-no-numbers.txt')
    Wait-Js "HR.app.log.entries.filter(e => e.level === 'error').length > $n" 5
    Assert-Contains (Last-Log 'error') 'у файлі не знайдено чисел' 'файл без чисел'
    Note "$first; 300 чисел → 200 («$(Js 'HR.app.state.lastFile.details')»); без чисел → «у файлі не знайдено чисел»"
  }

  Test-Case 'E2E-28' 'Позитивний' 'Збереження зображення результату в PNG, JPG і BMP' 'Розпізнано приклад аритмії; формат вибрано у списку, «Зберегти зображення» тричі' `
    'Три файли з правильними сигнатурами (PNG, JPEG, BM), кожен 1400 × 800; розмір BMP = 54 + 4200 · 800 = 3 360 054 Б' {
    Prepare-Trained
    Click-Element '.chip[data-example="irregular"]'
    Wait-Js 'HR.app.state.lastResult !== null' 5
    $sig = @{ png = '89504E47'; jpg = 'FFD8FF'; bmp = '424D' }
    $parts = @()
    foreach ($fmt in 'png', 'jpg', 'bmp') {
      Select-Option '#imgFormat' $fmt
      $f = Save-Via '#btnSaveImage'
      $head = ((File-Head $f 4) | ForEach-Object { '{0:X2}' -f $_ }) -join ''
      Assert-True ($head.StartsWith($sig[$fmt])) "сигнатура $fmt ($head)"
      Assert-Equal (Image-Size $f) '1400×800' "розмір $fmt"
      Assert-True ($f.Extension -eq ".$fmt") "розширення $fmt"
      if ($fmt -eq 'bmp') { Assert-Equal $f.Length 3360054 'розмір файлу BMP' }
      $parts += "$($f.Extension.TrimStart('.').ToUpper()) $(Kb $f)"
    }
    Note ("збережено 3 файли 1400×800: " + ($parts -join ', ') + '; сигнатури правильні')
  }

  Test-Case 'E2E-29' 'Позитивний' 'Збереження графіків навчання і журналу операцій' 'Після навчання: «Зберегти графіки» (PNG) і «Зберегти журнал»' `
    'PNG графіків 1400 × 620; TXT журналу з кількістю записів, датою і рівнем кожного запису' {
    Prepare-Trained
    Select-Option '#chartFormat' 'png'
    $chart = Save-Via '#btnSaveCharts'
    Assert-Equal (Image-Size $chart) '1400×620' 'розмір графіків'
    $count = Log-Count
    $log = Save-Via '#btnSaveLog'
    $text = [IO.File]::ReadAllText($log.FullName, [Text.Encoding]::UTF8)
    Assert-Contains $text "Записів: $($count + 1)" 'кількість записів у файлі'
    Assert-True ($text -match '\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \[OK\]') 'формат рядка журналу'
    Note "$($chart.Name) 1400×620 ($(Kb $chart)); $($log.Name): $($count + 1) записів"
  }

  Test-Case 'E2E-30' 'Позитивний' 'Очищення журналу з підтвердженням' 'Клік «Очистити»: 1) «Скасувати» у діалозі; 2) «OK»' `
    '1) записи не змінюються; 2) журнал очищено, лишається один запис «Журнал очищено (видалено записів: N)»' {
    Generate-Data ([ordered]@{ seed = 42 })
    $count = Log-Count
    $script:Cdp.DialogAccept = $false
    Click-Element '#btnClearLog'
    Start-Sleep -Milliseconds 200
    Assert-Equal (Log-Count) $count 'записів після «Скасувати»'
    $script:Cdp.DialogAccept = $true
    Click-Element '#btnClearLog'
    Wait-Js 'HR.app.log.entries.length === 1' 5
    Assert-Equal $script:Cdp.Dialogs.Count 2 'діалогів підтвердження'
    Assert-Contains (Last-Log 'info') "видалено записів: $count" 'запис про очищення'
    Note "діалог «$($script:Cdp.Dialogs[0].message)» показано двічі; скасування - $count записів лишилося; підтвердження - 1 запис «$(Last-Log 'info')»"
  }

  # ================================================================ повторні дії, діалоги, адаптивність
  Test-Case 'E2E-31' 'Граничний' 'Повторний запуск операцій' 'Подвійний клік «Згенерувати дані»; повторна генерація з тим самим seed; повторне навчання' `
    'Подвійний клік запускає одну генерацію; той самий seed дає ідентичний набір; повторне навчання замінює модель без помилок' {
    Set-Field '#seed' '42'
    $n = @(Js 'HR.app.log.entries.filter(e => e.message.startsWith("Генерація даних:")).length')[0]
    Click-Element '#btnGenerate'
    Click-Element '#btnGenerate'
    Wait-Idle 60
    $runs = (Js 'HR.app.log.entries.filter(e => e.message.startsWith("Генерація даних:")).length') - $n
    $h1 = Dataset-Hash
    Generate-Data
    $h2 = Dataset-Hash
    Train-Model ([ordered]@{ epochs = 300 })
    $a1 = Js 'HR.app.state.model.evaluation.accuracy'
    Train-Model ([ordered]@{ epochs = 1000 })
    $a2 = Js 'HR.app.state.model.evaluation.accuracy'
    Assert-Equal $runs 1 'запусків генерації після подвійного кліку'
    Assert-Equal $h2 $h1 'набір після повторної генерації'
    Assert-Equal (Log-Messages 'error').Count 0 'помилок у журналі'
    Assert-Equal (Js 'HR.app.state.model.training.epochsDone') 1000 'модель другого навчання'
    Note ("подвійний клік → {0} генерація; контрольні суми {1} і {2} збігаються; навчання 300 і 1 000 епох: {3} → {4}" -f $runs, $h1, $h2, (Pct $a1), (Pct $a2))
  }

  Test-Case 'E2E-32' 'Позитивний' 'Діалоги «Інформація» і «Довідка»' 'Клік «Інформація» до і після генерації; Escape; кнопки закриття' `
    'Діалог показує 5 розділів (до генерації - з поясненнями, що даних немає); після генерації - параметри набору і seed; закривається Escape і кнопкою; довідка відкривається і закривається' {
    Click-Element '#btnInfo'
    Wait-Js 'document.querySelector("#dlgInfo").open' 3
    $sections = @(Js 'Array.from(document.querySelectorAll("#infoBody .info-section")).map(s => s.id)')
    Assert-Equal ($sections -join ',') 'infoData,infoModel,infoImage,infoFile,infoEnv' 'розділи'
    Assert-Contains (Text '#infoData') 'Набір ще не згенеровано' 'порожній розділ'
    Send-Key 'Escape'
    Wait-Js '!document.querySelector("#dlgInfo").open' 3 'закриття Escape'
    Generate-Data ([ordered]@{ seed = 42 })
    Click-Element '#btnDataInfo'
    Wait-Js 'document.querySelector("#dlgInfo").open' 3
    Assert-Contains (Text '#infoData') 'Зерно генератора (seed)42' 'seed у діалозі'
    Save-Screenshot (Join-Path $shots 'E2E-32_діалог_інформація.png') '#dlgInfo' 0
    Click-Element '#dlgInfo .dialog-foot button'
    Wait-Js '!document.querySelector("#dlgInfo").open' 3 'закриття кнопкою'
    Click-Element '#btnHelp'
    Wait-Js 'document.querySelector("#dlgHelp").open' 3
    Click-Element '#dlgHelp .dialog-foot button'
    Wait-Js '!document.querySelector("#dlgHelp").open' 3
    Note "5 розділів; після генерації - seed 42 і параметри; Escape і кнопка закривають; довідка відкривається і закривається"
  }

  Test-Case 'E2E-33' 'Позитивний' 'Робота на вузькому екрані (смартфон)' 'Ширина вікна 375 px (емуляція мобільного пристрою); основний сценарій кліками' `
    'Немає горизонтальної прокрутки; усі кнопки досяжні й не перекриті; генерація, навчання і розпізнавання працюють' {
    Reset-App -Width 375 -Height 812 -Mobile
    $overflow = Js 'document.documentElement.scrollWidth - window.innerWidth'
    Prepare-Trained
    Click-Element '.chip[data-example="irregular"]'
    Wait-Js 'HR.app.state.lastResult !== null' 5
    $overflow2 = Js 'document.documentElement.scrollWidth - window.innerWidth'
    Assert-True ([int]$overflow -le 0 -and [int]$overflow2 -le 0) "горизонтальна прокрутка ($overflow / $overflow2 px)"
    Assert-Equal (Result-Label) 'arrhythmia' 'результат'
    Note "ширина 375 px: горизонтальної прокрутки немає (до і після розпізнавання); сценарій виконано кліками, результат «$(Text '#resultSummary .verdict-badge')»"
    Save-Screenshot (Join-Path $shots 'E2E-33_мобільний_крок3.png') '#step3'
    Invoke-Js 'window.scrollTo(0, 0)' | Out-Null
    Save-Screenshot (Join-Path $shots 'E2E-33_мобільний_верх.png')
  }

  Test-Case 'E2E-34' 'Позитивний' 'Підказки на графіках і вибір зразка на діаграмі розсіювання' 'Після навчання: наведення миші на графіки помилки й точності; наведення і клік по точці діаграми розсіювання' `
    'З''являються підказки з номером епохи і значеннями; підказка точки показує зразок, клік переносить його в розпізнавання' {
    Prepare-Trained
    $tips = @()
    foreach ($pair in @(@('#errorCanvas', '#errorTip'), @('#accCanvas', '#accTip'))) {
      $p = Get-ElementPoint $pair[0]
      Move-Mouse ([double]$p['x']) ([double]$p['y'])
      Wait-Js "!document.querySelector('$($pair[1])').hidden" 3 "підказка $($pair[1])"
      $tips += [string](Js "document.querySelector('$($pair[1])').innerText.replace(/\s+/g, ' ').trim()")
    }
    Assert-Contains $tips[0] 'Епоха' 'підказка графіка помилки'
    Assert-Contains $tips[1] 'тестова' 'підказка графіка точності'
    # координати точки першого зразка (за тими самими формулами, що й ScatterPlot)
    $pt = Js @'
(() => {
  const c = document.querySelector('#scatterCanvas');
  c.scrollIntoView({ block: 'center' });
  const ss = HR.app.state.dataset.samples;
  let xMin = Infinity, xMax = -Infinity, yMax = 0;
  for (const s of ss) { xMin = Math.min(xMin, s.mean); xMax = Math.max(xMax, s.mean); yMax = Math.max(yMax, s.spread); }
  const d = { x0: Math.floor((xMin - 3) / 10) * 10, x1: Math.ceil((xMax + 3) / 10) * 10, y1: Math.max(10, Math.ceil((yMax + 3) / 10) * 10) };
  const r = c.getBoundingClientRect();
  const area = { x: 46, y: 12, w: r.width - 60, h: r.height - 56 };
  const s = ss[0];
  return { x: r.left + area.x + ((s.mean - d.x0) / (d.x1 - d.x0)) * area.w, y: r.top + area.y + (1 - s.spread / d.y1) * area.h };
})()
'@
    Move-Mouse ([double]$pt['x']) ([double]$pt['y'])
    Wait-Js "!document.querySelector('#scatterTip').hidden" 3 'підказка точки'
    $tip = [string](Js "document.querySelector('#scatterTip').innerText.replace(/\s+/g, ' ').trim()")
    Click-At ([double]$pt['x']) ([double]$pt['y'])
    Wait-Js 'HR.app.state.lastResult !== null' 5 'розпізнавання вибраного зразка'
    $picked = Js 'document.querySelector("#seqInput").value'
    Assert-Contains $tip 'Зразок №' 'підказка точки'
    Assert-Contains $tip ($picked -replace ', ', ', ') 'значення в підказці і в полі збігаються'
    Note "графік помилки: «$($tips[0])»; точності: «$($tips[1])»; точка: «$tip» → у полі [$picked], «$(Text '#resultSummary .verdict-badge')»"
  }

  Test-Case 'E2E-35' 'Негативний' 'Бібліотека brain.js не завантажилася' 'Файл lib/brain-browser.js не створив об''єкт brain (емуляція пошкодженого файлу)' `
    'Червоний банер з поясненням і ERROR у журналі; генерація даних працює, а навчання й завантаження моделі недоступні з поясненням у підказці' {
    $id = (Invoke-Cdp 'Page.addScriptToEvaluateOnNewDocument' @{ source = "Object.defineProperty(globalThis, 'brain', { configurable: false, get() { return undefined; }, set(v) {} });" })['identifier']
    try {
      Reset-App
      Assert-True (-not (Js 'HR.app.state.brainLoaded')) 'бібліотека не завантажена'
      Assert-True (Is-Shown '#libError') 'банер помилки'
      Assert-Contains (Last-Log 'error') 'Не вдалося завантажити бібліотеку brain.js' 'запис у журналі'
      Generate-Data ([ordered]@{ seed = 42 })
      Assert-True (Js 'HR.app.state.dataset !== null') 'генерація працює'
      Assert-True ((Is-Disabled '#btnTrain') -and (Is-Disabled '#fileModel')) 'навчання і завантаження моделі недоступні'
      Assert-Contains (Text '#trainHint') 'brain.js не завантажилася' 'підказка'
      Note "банер: «$(Text '#libError')»; набір згенеровано; «Навчити» і «Завантажити модель» недоступні; підказка: «$(Text '#trainHint')»"
      Save-Screenshot (Join-Path $shots 'E2E-35_без_brain.png') '#libError'
    } finally {
      Invoke-Cdp 'Page.removeScriptToEvaluateOnNewDocument' @{ identifier = $id } | Out-Null
    }
  }

  Test-Case 'E2E-36' 'Позитивний' 'Кнопка «Оцінити на тестовій вибірці» і модель без історії навчання' 'Модель (seed 42) збережена, з файлу видалено історію навчання й оцінювання; перезапуск, генерація з seed 7, завантаження моделі, «Оцінити на тестовій вибірці»' `
    'Після завантаження графіки й таблиця історії показують, що даних немає; «Оцінити» перераховує метрики на новому наборі (200 прикладів): прогрес-бар, точність, запис у журналі' {
    Prepare-Trained
    $file = Save-Via '#btnSaveModel'
    $json = ConvertFrom-JsonText ([IO.File]::ReadAllText($file.FullName, [Text.Encoding]::UTF8))
    [void]$json.Remove('history')
    [void]$json.Remove('evaluation')
    $stripped = Join-Path $script:E2E.Downloads 'model-no-history.json'
    [IO.File]::WriteAllText($stripped, (ConvertTo-JsonText $json), (New-Object System.Text.UTF8Encoding($false)))
    Reset-App
    Generate-Data ([ordered]@{ seed = 7 })
    Set-FileInput '#fileModel' $stripped
    Wait-Js 'HR.app.state.model !== null' 10 'завантаження моделі'
    Assert-True (Is-Shown '#errorEmpty') 'заглушка графіка помилки'
    Assert-Contains (Text '#historyBody') 'Немає даних про навчання' 'таблиця історії'
    $beforeEval = Text '#progEval .progress-text'
    Assert-Contains $beforeEval 'Немає збереженого результату' 'стан оцінювання'
    Assert-True (-not (Is-Disabled '#btnEvaluate')) 'кнопка «Оцінити» доступна'
    Click-Element '#btnEvaluate'
    Wait-Js 'HR.app.state.busy === null && HR.app.state.model.evaluation !== null' 30 'оцінювання'
    $ev = Js 'HR.app.state.model.evaluation'
    Assert-Equal $ev['total'] 200 'тестових прикладів'
    Assert-Equal (Js 'document.querySelector("#progEval").dataset.state') 'done' 'стан прогрес-бару оцінювання'
    Assert-Contains (Last-Log 'success') 'Оцінювання: точність' 'запис у журналі'
    Assert-True ([double]$ev['accuracy'] -ge 0.9) 'точність на новому наборі ≥ 90 %'
    Note "без історії: заглушки графіків, «Немає даних про навчання», «$beforeEval» до оцінювання; після «Оцінити»: «$(Text '#progEval .progress-text')», TP $($ev['tp']), TN $($ev['tn']), FP $($ev['fp']), FN $($ev['fn'])"
  }

  Test-Case 'E2E-37' 'Позитивний' 'Діалог «Інформація» після повного сценарію' 'Модель навчена, з файлу sequence-rr-ms.txt розпізнано послідовність, зображення збережено в BMP; кнопка «i» біля зображення' `
    'Усі 6 розділів заповнені і відповідають стану: модель 4–8–2 з метриками, зображення 1400 × 800 з обчисленими розмірами PNG і JPG і BMP 3,20 МБ, останній завантажений і останній збережений файл' {
    Prepare-Trained
    Set-FileInput '#fileSeq' (Fixture 'sequence-rr-ms.txt')
    Wait-Js 'HR.app.state.lastResult !== null' 5 'розпізнавання послідовності з файлу'
    Select-Option '#imgFormat' 'bmp'
    $bmp = Save-Via '#btnSaveImage'
    Click-Element '#btnImageInfo'
    Wait-Js 'document.querySelector("#dlgInfo").open' 3 'діалог'
    Wait-Js '!document.querySelector("#infoImage").textContent.includes("обчислюється")' 10 'розміри PNG і JPG'
    $sections = @(Js 'Array.from(document.querySelectorAll("#infoBody .info-section")).map(s => s.id)')
    $dd = @(Js 'Array.from(document.querySelectorAll("#infoImage dd")).map(d => d.textContent.replace(/[  ]/g, " "))')
    Assert-Equal ($sections -join ',') 'infoData,infoModel,infoImage,infoFile,infoSave,infoEnv' 'розділи'
    Assert-Contains (Text '#infoModel') '4–8–2' 'архітектура моделі'
    Assert-Contains (Text '#infoModel') 'Точність на тесті' 'метрики моделі'
    Assert-Contains (Text '#infoImage') '1400 × 800 px' 'роздільна здатність'
    Assert-Contains (Text '#infoImage') 'з результатом класифікації' 'вміст зображення'
    Assert-Contains (Text '#infoImage') '3,20 МБ' 'розмір BMP'
    Assert-True ($dd[6] -match 'КБ|МБ' -and $dd[7] -match 'КБ|МБ') "розміри PNG і JPG ($($dd[6]), $($dd[7]))"
    Assert-Contains (Text '#infoFile') 'sequence-rr-ms.txt' 'останній завантажений файл'
    Assert-Contains (Text '#infoSave') $bmp.Name 'останній збережений файл'
    Note "6 розділів; модель 4–8–2 з метриками; зображення 1400 × 800, PNG $($dd[6]), JPG $($dd[7]), BMP $($dd[8]) (файл $($bmp.Length) Б); останній завантажений - sequence-rr-ms.txt, збережений - $($bmp.Name)"
    Save-Screenshot (Join-Path $shots 'E2E-37_діалог_інформація.png') '#dlgInfo' 0
  }
}
