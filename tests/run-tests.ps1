<#
  Автоматизовані тести застосунку (ЛР4) у Microsoft Edge або Google Chrome:
    1) модульні та інтеграційні тести (Mocha + Chai) - сторінка tests/index.html;
    2) наскрізні (E2E) тести - сценарії користувача в Application/index.html
       (справжні кліки й натискання клавіш через Chrome DevTools Protocol).
  Під час виконання V8 збирає покриття коду файлів Application/js.
  Результати: tests/results/<браузер>_<дата>/ - unit.json, e2e.json,
  coverage.json, summary.json, screenshots/.

  Приклади:
    powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1
    powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1 -Browser chrome -Suite unit
    powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1 -Suite e2e -Grep "E2E-0[1-3]" -Headed
  Модульні тести можна також відкрити вручну: подвійний клік по tests\index.html.
#>
param(
  [ValidateSet('edge', 'chrome')][string]$Browser = 'edge',
  [ValidateSet('all', 'unit', 'e2e')][string]$Suite = 'all',
  [string]$Grep = '',
  [switch]$Headed,
  [switch]$KeepDownloads,
  [string]$OutDir = (Join-Path $PSScriptRoot 'results'),
  [int]$Port = 9334
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'e2e\cdp.ps1')
. (Join-Path $PSScriptRoot 'e2e\e2e-tests.ps1')

$root = Split-Path $PSScriptRoot
$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$runDir = Join-Path $OutDir "${Browser}_$stamp"
$shotsDir = Join-Path $runDir 'screenshots'
New-Item -ItemType Directory -Force $shotsDir | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Save-Text([string]$Name, [string]$Text) { [IO.File]::WriteAllText((Join-Path $runDir $Name), $Text, $utf8) }
# JSON з відступами (форматує браузер)
function Format-Json($Object) { [string](Invoke-Js "JSON.stringify($(ConvertTo-JsonText $Object), null, 1)") }

$clock = [Diagnostics.Stopwatch]::StartNew()
$info = Start-TestBrowser -Browser $Browser -Port $Port -Headed:$Headed
Write-Host "Браузер: $($info.product) (V8 $($info.v8))$(if ($info.headless) { ', без вікна (headless)' })"
Write-Host "Результати: $runDir"
Start-Coverage
$summary = [ordered]@{ startedAt = (Get-Date).ToString('s'); browser = $info; suite = $Suite; grep = $Grep }
$snapshots = [ordered]@{}
$failed = 0

try {
  # ---------------------------------------------------------------- модульні та інтеграційні
  if ($Suite -in 'all', 'unit') {
    Write-Host "`nМодульні та інтеграційні тести (Mocha + Chai)..." -ForegroundColor Cyan
    $url = ([Uri](Join-Path $PSScriptRoot 'index.html')).AbsoluteUri
    if ($Grep) { $url += '?grep=' + [Uri]::EscapeDataString($Grep) }
    Open-Page $url
    Wait-Js 'window.TEST_REPORT !== undefined' 900 'завершення тестів Mocha'
    $unitText = [string](Invoke-Js 'JSON.stringify(window.TEST_REPORT, null, 1)')
    Save-Text 'unit.json' $unitText
    $unit = ConvertFrom-JsonText $unitText
    $snapshots['unit'] = @(, @(Get-CoverageSnapshot))
    Save-Screenshot (Join-Path $shotsDir 'unit_report.png')
    $levels = @($unit['tests']) | Group-Object { $_['level'] }
    foreach ($g in $levels) {
      $p = @($g.Group | Where-Object { $_['state'] -eq 'passed' }).Count
      Write-Host ("  {0,-12} {1,4} тестів, успішно {2,4}" -f $g.Name, $g.Count, $p)
    }
    foreach ($t in @($unit['tests'] | Where-Object { $_['state'] -eq 'failed' })) {
      Write-Host "  [FAIL] $($t['suite']) › $($t['title'])" -ForegroundColor Red
      Write-Host "         $($t['error'])" -ForegroundColor DarkRed
    }
    $failed += [int]$unit['totals']['failed']
    $summary['unit'] = $unit['totals']
    $summary['unitDurationMs'] = $unit['durationMs']
  }

  # ---------------------------------------------------------------- наскрізні
  if ($Suite -in 'all', 'e2e') {
    Write-Host "`nНаскрізні тести (E2E) у застосунку..." -ForegroundColor Cyan
    $appUrl = ([Uri](Join-Path $root 'Application\index.html')).AbsoluteUri
    Invoke-E2ETests -AppUrl $appUrl -RunDir $runDir -Fixtures (Join-Path $PSScriptRoot 'e2e\fixtures') -Grep $Grep
    $script:E2E.Coverage.Add(@(Get-CoverageSnapshot))
    # ToArray, а не @(): у PowerShell 5.1 @() над List з порожнім масивом кидає «Argument types do not match»
    $snapshots['e2e'] = $script:E2E.Coverage.ToArray()
    $results = $script:E2E.Results.ToArray()
    Save-Text 'e2e.json' (Format-Json $results)
    $e2eFailed = @($results | Where-Object { $_.status -ne 'passed' }).Count
    $failed += $e2eFailed
    $summary['e2e'] = [ordered]@{ tests = $results.Count; passed = $results.Count - $e2eFailed; failed = $e2eFailed }
    Write-Host ("  E2E: {0} сценаріїв, успішно {1}" -f $results.Count, ($results.Count - $e2eFailed))
  }

  # ---------------------------------------------------------------- покриття коду
  $sources = [ordered]@{}
  Get-ChildItem (Join-Path $root 'Application\js') -Filter *.js | Sort-Object Name | ForEach-Object { $sources[$_.Name] = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8) }
  $buckets = [ordered]@{}
  foreach ($k in $snapshots.Keys) { $buckets[$k] = $snapshots[$k] }
  if ($snapshots.Count -gt 1) { $buckets['all'] = [object[]]$snapshots['unit'] + [object[]]$snapshots['e2e'] }
  $coverageJs = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'e2e\coverage.js'), [Text.Encoding]::UTF8)
  $coverageText = [string](Invoke-Js "JSON.stringify(($coverageJs)($(ConvertTo-JsonText $buckets), $(ConvertTo-JsonText $sources)), null, 1)")
  Save-Text 'coverage.json' $coverageText
  $coverage = ConvertFrom-JsonText $coverageText
  Write-Host "`nПокриття коду Application/js (рядки / функції):" -ForegroundColor Cyan
  foreach ($bucket in $coverage.Keys) {
    $line = "  {0,-5}" -f $bucket
    $tl = 0; $tc = 0; $fl = 0; $fc = 0
    foreach ($file in $coverage[$bucket].Keys) {
      $c = $coverage[$bucket][$file]
      $tl += $c['lines']; $tc += $c['linesCovered']; $fl += $c['functions']; $fc += $c['functionsCovered']
    }
    Write-Host ("{0} рядків {1:N1} % ({2}/{3}), функцій {4:N1} % ({5}/{6})" -f $line, (100 * $tc / [Math]::Max(1, $tl)), $tc, $tl, (100 * $fc / [Math]::Max(1, $fl)), $fc, $fl)
  }
} finally {
  $summary['durationSec'] = [Math]::Round($clock.Elapsed.TotalSeconds, 1)
  $summary['failed'] = $failed
  try { Save-Text 'summary.json' (Format-Json $summary) } catch { Write-Host "summary.json не збережено: $($_.Exception.Message)" -ForegroundColor DarkYellow }
  Stop-TestBrowser
  if (-not $KeepDownloads) { Remove-Item -Recurse -Force (Join-Path $runDir 'downloads') -ErrorAction SilentlyContinue }
}

$color = if ($failed) { 'Red' } else { 'Green' }
Write-Host ("`nГотово за {0:N0} с. Тестів з помилками: {1}" -f $clock.Elapsed.TotalSeconds, $failed) -ForegroundColor $color
exit $(if ($failed) { 1 } else { 0 })
