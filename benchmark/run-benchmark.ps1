<#
  Автоматизований запуск бенчмарку (ЛР3) у Microsoft Edge або Google Chrome.
  Браузер стартує з окремим тимчасовим профілем і портом налагодження,
  відкриває benchmark/index.html?auto=1, чекає завершення вимірювань і через
  Chrome DevTools Protocol забирає результати (JSON, CSV), графіки (PNG) і
  знімки сторінки. Вручну сторінку можна просто відкрити подвійним кліком.

  Приклад:  powershell -ExecutionPolicy Bypass -File benchmark\run-benchmark.ps1
            powershell -File benchmark\run-benchmark.ps1 -Browser chrome -Suites volume -Runs 5
            powershell -File benchmark\run-benchmark.ps1 -ChartsFrom benchmark\results\edge_....json
  -ChartsFrom лише перемальовує графіки і знімки сторінки зі збережених результатів.
#>
param(
  [ValidateSet('edge', 'chrome')][string]$Browser = 'edge',
  [string]$Suites = '',
  [int]$Runs = 5,
  [switch]$Quick,
  [string]$OutDir = (Join-Path $PSScriptRoot 'results'),
  [string]$ChartsFrom = '',
  [int]$Port = 9333,
  [int]$TimeoutMinutes = 20
)
$ErrorActionPreference = 'Stop'
if ($ChartsFrom) { $ChartsFrom = (Resolve-Path -LiteralPath $ChartsFrom).Path }

$exe = @{
  edge   = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
  chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
}[$Browser] | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) { throw "Не знайдено браузер $Browser" }

$page = Join-Path $PSScriptRoot 'index.html'
$query = if ($ChartsFrom) { @('view=1') } else { @('auto=1', "runs=$Runs") }
if ($Suites) { $query += "suites=$Suites" }
if ($Quick) { $query += 'quick=1' }
$url = ([Uri]$page).AbsoluteUri + '?' + ($query -join '&')

$profileDir = Join-Path $env:TEMP "hr-benchmark-profile-$Browser"
if (Test-Path $profileDir) { Remove-Item -Recurse -Force $profileDir }
New-Item -ItemType Directory -Force $OutDir | Out-Null

# Прапорці: окремий профіль без розширень; без пригальмовування фонових і
# перекритих вікон (інакше requestAnimationFrame і таймери сповільнюються);
# --expose-gc дає сторінці змогу збирати сміття між запусками
$flags = @(
  "--remote-debugging-port=$Port", "--user-data-dir=`"$profileDir`"",
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--disable-features=CalculateNativeWinOcclusion', '--js-flags=--expose-gc',
  '--window-position=40,40', '--window-size=1360,1000', "`"$url`""
)
Write-Host "Запуск: $exe"
$proc = Start-Process -FilePath $exe -ArgumentList $flags -PassThru

function Get-Json($path) {
  (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port$path" -TimeoutSec 5).Content | ConvertFrom-Json
}

# ------------------------------------------------------------------ CDP
$script:ws = $null
$script:nextId = 0
function Connect-Cdp($wsUrl) {
  $script:ws = New-Object System.Net.WebSockets.ClientWebSocket
  $script:ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(20)
  $script:ws.ConnectAsync([Uri]$wsUrl, [Threading.CancellationToken]::None).Wait()
}
function Receive-Message {
  $buffer = New-Object byte[] 1048576
  $ms = New-Object System.IO.MemoryStream
  do {
    $seg = New-Object System.ArraySegment[byte] -ArgumentList @(, $buffer)
    $res = $script:ws.ReceiveAsync($seg, [Threading.CancellationToken]::None).Result
    $ms.Write($buffer, 0, $res.Count)
  } while (-not $res.EndOfMessage)
  [Text.Encoding]::UTF8.GetString($ms.ToArray())
}
# Відповіді (результати, PNG у base64) бувають більшими за ліміт
# ConvertFrom-Json у PowerShell 5.1, тому розбираються JavaScriptSerializer
Add-Type -AssemblyName System.Web.Extensions
$script:serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$script:serializer.MaxJsonLength = [int]::MaxValue
$script:serializer.RecursionLimit = 256

function Invoke-Cdp([string]$method, $params = @{}) {
  $script:nextId++
  $id = $script:nextId
  $json = $script:serializer.Serialize(@{ id = $id; method = $method; params = $params })
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $seg = New-Object System.ArraySegment[byte] -ArgumentList @(, $bytes)
  $script:ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()
  while ($true) {
    $text = Receive-Message
    if ($text.StartsWith("{`"id`":$id,")) {
      $msg = $script:serializer.DeserializeObject($text)
      if ($msg.ContainsKey('error')) { throw "CDP $method : $($msg['error']['message'])" }
      return $msg['result']
    }
  }
}
function Invoke-Js([string]$expression) {
  $r = Invoke-Cdp 'Runtime.evaluate' @{ expression = $expression; returnByValue = $true; awaitPromise = $true }
  if ($r.ContainsKey('exceptionDetails')) { throw "JS: $($r['exceptionDetails']['exception']['description'])" }
  $r['result']['value']
}
function Invoke-JsString([string]$expression) { [string](Invoke-Js $expression) }

# ------------------------------------------------------------------ Очікування сторінки
$deadline = (Get-Date).AddSeconds(30)
$target = $null
while (-not $target -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  try {
    $list = Get-Json '/json/list'  # у PS 5.1 масив з ConvertFrom-Json розгортається лише зі змінної
    $target = $list | Where-Object { $_.type -eq 'page' -and $_.url -like '*benchmark/index.html*' } | Select-Object -First 1
  } catch {}
}
if (-not $target) { throw 'Сторінка бенчмарку не відкрилася' }
$version = Get-Json '/json/version'
Connect-Cdp $target.webSocketDebuggerUrl
Write-Host "Браузер: $($version.Browser), V8 $($version.'V8-Version')"

$utf8 = New-Object System.Text.UTF8Encoding($false)
if ($ChartsFrom) {
  # збережені результати передаються сторінці, вона малює таблиці й графіки
  while (-not (Invoke-Js 'Boolean(window.BENCH && window.BENCH.showResults && document.readyState === "complete")')) { Start-Sleep -Milliseconds 300 }
  $saved = [IO.File]::ReadAllText($ChartsFrom, [Text.Encoding]::UTF8)
  Invoke-Js "(window.BENCH.showResults($saved), true)" | Out-Null
  Start-Sleep -Milliseconds 500
  $prefix = $ChartsFrom -replace '\.json$', ''
} else {
  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  $lastStatus = ''
  while ($true) {
    Start-Sleep -Seconds 3
    $done = Invoke-Js 'Boolean(window.BENCH && window.BENCH.done)'
    $status = Invoke-Js "document.querySelector('#status').textContent"
    if ($status -ne $lastStatus) { Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $status); $lastStatus = $status }
    if ($done) { break }
    if ((Get-Date) -gt $deadline) { throw 'Перевищено час очікування' }
  }

  # ---------------------------------------------------------------- Збереження результатів
  $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
  $prefix = Join-Path $OutDir "${Browser}_$stamp"
  $resultsJson = Invoke-JsString 'JSON.stringify(Object.assign({}, window.BENCH.results, { fits: window.BENCH.charts.fits() }), null, 1)'
  [IO.File]::WriteAllText("$prefix.json", $resultsJson, $utf8)
  [IO.File]::WriteAllText("$prefix.csv", (Invoke-JsString 'window.BENCH.toCsv(window.BENCH.results)'), $utf8)
  $browserInfo = @{ product = $version.Browser; v8 = $version.'V8-Version'; userAgent = $version.'User-Agent'; protocol = $version.'Protocol-Version'; executable = $exe } | ConvertTo-Json
  [IO.File]::WriteAllText("$prefix.browser.json", $browserInfo, $utf8)
}

$chartsDir = "${prefix}_charts"
New-Item -ItemType Directory -Force $chartsDir | Out-Null
$names = Invoke-JsString 'Object.keys(window.BENCH.charts.exportCharts()).join(",")'
foreach ($name in ($names -split ',' | Where-Object { $_ })) {
  $data = Invoke-JsString "window.BENCH.charts.exportCharts()['$name']"
  [IO.File]::WriteAllBytes((Join-Path $chartsDir "$name.png"), [Convert]::FromBase64String($data.Substring($data.IndexOf(',') + 1)))
}

# знімки сторінки: верх (середовище, налаштування) і таблиця обсягу даних
Invoke-Cdp 'Emulation.setDeviceMetricsOverride' @{ width = 1280; height = 860; deviceScaleFactor = 1.5; mobile = $false } | Out-Null
foreach ($shot in @(@{ name = 'page-top'; js = 'window.scrollTo(0, 0)' }, @{ name = 'page-volume'; js = "document.querySelector('#suite-volume') && document.querySelector('#suite-volume').scrollIntoView()" })) {
  Invoke-Js "($($shot.js), true)" | Out-Null
  Start-Sleep -Milliseconds 400
  $img = Invoke-Cdp 'Page.captureScreenshot' @{ format = 'png' }
  [IO.File]::WriteAllBytes((Join-Path $chartsDir "$($shot.name).png"), [Convert]::FromBase64String($img['data']))
}

Write-Host "Результати: $prefix.json"
try { Invoke-Cdp 'Browser.close' | Out-Null } catch {}
Start-Sleep -Seconds 1
if (-not $proc.HasExited) { $proc.Kill() }
