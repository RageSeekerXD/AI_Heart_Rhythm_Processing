<#
  Мінімальний клієнт Chrome DevTools Protocol (CDP) для наскрізних тестів.
  Керує Microsoft Edge або Google Chrome через одне з'єднання WebSocket з
  браузером (сесія сторінки - Target.attachToTarget, flatten). Дії
  користувача імітуються справжніми подіями миші й клавіатури
  (Input.dispatchMouseEvent, Input.insertText, Input.dispatchKeyEvent),
  файли вибираються через DOM.setFileInputFiles, збереження файлів
  потрапляє в окрему папку (Browser.setDownloadBehavior), діалоги
  confirm() обробляються автоматично. Підключається через dot-sourcing.
#>

Add-Type -AssemblyName System.Web.Extensions
$script:Cdp = @{
  Ws = $null; NextId = 0; SessionId = $null; Process = $null; Port = 0
  Serializer = (New-Object System.Web.Script.Serialization.JavaScriptSerializer)
  Dialogs = (New-Object System.Collections.Generic.List[object])
  Exceptions = (New-Object System.Collections.Generic.List[object])
  DialogAccept = $true
}
$script:Cdp.Serializer.MaxJsonLength = [int]::MaxValue
$script:Cdp.Serializer.RecursionLimit = 512

function ConvertTo-JsonText($value) { $script:Cdp.Serializer.Serialize($value) }
function ConvertFrom-JsonText([string]$text) { $script:Cdp.Serializer.DeserializeObject($text) }

# ------------------------------------------------------------------ запуск браузера
function Start-TestBrowser {
  param([ValidateSet('edge', 'chrome')][string]$Browser = 'edge', [int]$Port = 9334, [switch]$Headed, [int]$Width = 1440, [int]$Height = 1000)
  $exe = @{
    edge   = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
    chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
  }[$Browser] | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $exe) { throw "Не знайдено браузер $Browser" }
  # окремий тимчасовий профіль для кожного запуску (видаляється в Stop-TestBrowser)
  $profileDir = Join-Path $env:TEMP ("hr-tests-profile-$Browser-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $script:Cdp.ProfileDir = $profileDir
  $flags = @(
    "--remote-debugging-port=$Port", "--user-data-dir=`"$profileDir`"",
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion', "--window-size=$Width,$Height", '--force-device-scale-factor=1', 'about:blank'
  )
  if (-not $Headed) { $flags = @('--headless=new') + $flags }
  $script:Cdp.Process = Start-Process -FilePath $exe -ArgumentList $flags -PassThru
  $script:Cdp.Port = $Port
  $deadline = (Get-Date).AddSeconds(30)
  while ($true) {
    try { $version = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2).Content | ConvertFrom-Json; break } catch {}
    if ((Get-Date) -gt $deadline) { throw 'Браузер не відкрив порт налагодження' }
    Start-Sleep -Milliseconds 300
  }
  $script:Cdp.Ws = New-Object System.Net.WebSockets.ClientWebSocket
  $script:Cdp.Ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(20)
  $script:Cdp.Ws.ConnectAsync([Uri]$version.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()

  # сторінка about:blank, з якою працюватимуть тести
  $targets = (Invoke-Cdp 'Target.getTargets' -Browser)['targetInfos']
  $page = @($targets | Where-Object { $_['type'] -eq 'page' })[0]
  $targetId = if ($page) { $page['targetId'] } else { (Invoke-Cdp 'Target.createTarget' @{ url = 'about:blank' } -Browser)['targetId'] }
  $script:Cdp.SessionId = (Invoke-Cdp 'Target.attachToTarget' @{ targetId = $targetId; flatten = $true } -Browser)['sessionId']
  Invoke-Cdp 'Page.enable' | Out-Null
  Invoke-Cdp 'Runtime.enable' | Out-Null
  Set-Viewport $Width $Height
  return @{ product = [string]$version.Browser; v8 = [string]$version.'V8-Version'; userAgent = [string]$version.'User-Agent'; executable = [string]$exe; headless = [bool](-not $Headed) }
}

function Stop-TestBrowser {
  try { Invoke-Cdp 'Browser.close' -Browser -TimeoutSec 5 | Out-Null } catch {}
  $deadline = (Get-Date).AddSeconds(5)
  while ($script:Cdp.Process -and -not $script:Cdp.Process.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
  if ($script:Cdp.Process -and -not $script:Cdp.Process.HasExited) { $script:Cdp.Process.Kill() }
  if ($script:Cdp.ProfileDir) {
    Start-Sleep -Milliseconds 500
    Remove-Item -Recurse -Force $script:Cdp.ProfileDir -ErrorAction SilentlyContinue
  }
}

# ------------------------------------------------------------------ обмін повідомленнями
function Send-CdpText([string]$text) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($text)
  $seg = New-Object System.ArraySegment[byte] -ArgumentList @(, $bytes)
  $script:Cdp.Ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()
}

function Receive-CdpText([int]$TimeoutSec) {
  $buffer = New-Object byte[] 1048576
  $ms = New-Object System.IO.MemoryStream
  do {
    $seg = New-Object System.ArraySegment[byte] -ArgumentList @(, $buffer)
    $task = $script:Cdp.Ws.ReceiveAsync($seg, [Threading.CancellationToken]::None)
    if (-not $task.Wait($TimeoutSec * 1000)) { throw "CDP: немає відповіді браузера за $TimeoutSec с" }
    $ms.Write($buffer, 0, $task.Result.Count)
  } while (-not $task.Result.EndOfMessage)
  [Text.Encoding]::UTF8.GetString($ms.ToArray())
}

# Події, які потрібно обробити під час очікування відповіді
function Receive-CdpEvent($msg) {
  switch ($msg['method']) {
    'Page.javascriptDialogOpening' {
      $script:Cdp.Dialogs.Add(@{ type = $msg['params']['type']; message = $msg['params']['message']; accepted = $script:Cdp.DialogAccept })
      # відповідь не очікуємо: діалог блокує сторінку, доки його не закрито
      $script:Cdp.NextId++
      Send-CdpText (ConvertTo-JsonText @{ id = $script:Cdp.NextId; method = 'Page.handleJavaScriptDialog'; params = @{ accept = $script:Cdp.DialogAccept }; sessionId = $msg['sessionId'] })
    }
    'Runtime.exceptionThrown' {
      $d = $msg['params']['exceptionDetails']
      $text = if ($d['exception'] -and $d['exception']['description']) { $d['exception']['description'] } else { $d['text'] }
      $script:Cdp.Exceptions.Add($text)
    }
  }
}

function Invoke-Cdp {
  param([string]$Method, [hashtable]$Params = @{}, [switch]$Browser, [int]$TimeoutSec = 180)
  $script:Cdp.NextId++
  $id = $script:Cdp.NextId
  $msg = @{ id = $id; method = $Method; params = $Params }
  if (-not $Browser -and $script:Cdp.SessionId) { $msg.sessionId = $script:Cdp.SessionId }
  Send-CdpText (ConvertTo-JsonText $msg)
  while ($true) {
    $reply = ConvertFrom-JsonText (Receive-CdpText $TimeoutSec)
    if ($reply.ContainsKey('id')) {
      if ($reply['id'] -ne $id) { continue } # відповідь на команду, результат якої не потрібен
      if ($reply.ContainsKey('error')) { throw "CDP $Method : $($reply['error']['message'])" }
      return $reply['result']
    }
    Receive-CdpEvent $reply
  }
}

# ------------------------------------------------------------------ JavaScript на сторінці
function Invoke-Js([string]$Expression) {
  $r = Invoke-Cdp 'Runtime.evaluate' @{ expression = $Expression; returnByValue = $true; awaitPromise = $true }
  if ($r.ContainsKey('exceptionDetails')) {
    $d = $r['exceptionDetails']
    $text = if ($d['exception'] -and $d['exception']['description']) { $d['exception']['description'] } else { $d['text'] }
    throw "JS: $text"
  }
  $r['result']['value']
}

function Wait-Js([string]$Expression, [double]$TimeoutSec = 20, [string]$What = '') {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ($true) {
    if (Invoke-Js "Boolean($Expression)") { return }
    if ((Get-Date) -gt $deadline) { throw "Не дочекалися за $TimeoutSec с: $(if ($What) { $What } else { $Expression })" }
    Start-Sleep -Milliseconds 60
  }
}

# Перехід на сторінку; стара сторінка позначається, щоб не сплутати її з новою
function Open-Page([string]$Url, [string]$ReadyExpression = 'true') {
  try { Invoke-Js 'window.__e2eOld = true' | Out-Null } catch {}
  Invoke-Cdp 'Page.navigate' @{ url = $Url } | Out-Null
  $target = ConvertTo-JsonText $Url.Split('?')[0]
  Wait-Js "!window.__e2eOld && document.readyState === 'complete' && decodeURIComponent(location.href.split('?')[0]) === decodeURIComponent($target) && ($ReadyExpression)" 30 "завантаження $Url"
}

function Set-Viewport([int]$Width, [int]$Height, [switch]$Mobile) {
  Invoke-Cdp 'Emulation.setDeviceMetricsOverride' @{ width = $Width; height = $Height; deviceScaleFactor = 1; mobile = [bool]$Mobile } | Out-Null
}

# ------------------------------------------------------------------ дії користувача
# Центр елемента у вікні; елемент прокручується у видиму область, а в цій
# точці має бути саме він (не перекритий іншим елементом)
function Get-ElementPoint([string]$Selector) {
  $sel = ConvertTo-JsonText $Selector
  $p = Invoke-Js @"
(() => {
  const el = document.querySelector($sel);
  if (!el) return { error: 'елемент не знайдено' };
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { error: 'елемент невидимий' };
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  const ok = hit && (hit === el || el.contains(hit) || (hit.control && hit.control === el) || (el.control && el.control === hit));
  return { x, y, ok: !!ok, hit: hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') : null };
})()
"@
  if ($p['error']) { throw "$Selector : $($p['error'])" }
  if (-not $p['ok']) { throw "$Selector перекрито елементом $($p['hit'])" }
  $p
}

function Move-Mouse([double]$X, [double]$Y) {
  Invoke-Cdp 'Input.dispatchMouseEvent' @{ type = 'mouseMoved'; x = $X; y = $Y } | Out-Null
}

function Click-At([double]$X, [double]$Y) {
  Move-Mouse $X $Y
  Invoke-Cdp 'Input.dispatchMouseEvent' @{ type = 'mousePressed'; x = $X; y = $Y; button = 'left'; buttons = 1; clickCount = 1 } | Out-Null
  Invoke-Cdp 'Input.dispatchMouseEvent' @{ type = 'mouseReleased'; x = $X; y = $Y; button = 'left'; buttons = 0; clickCount = 1 } | Out-Null
}

function Click-Element([string]$Selector) {
  $p = Get-ElementPoint $Selector
  Click-At ([double]$p['x']) ([double]$p['y'])
}

$script:Keys = @{
  Enter = @{ key = 'Enter'; code = 'Enter'; vk = 13; text = "`r" }
  Tab = @{ key = 'Tab'; code = 'Tab'; vk = 9; text = '' }
  Escape = @{ key = 'Escape'; code = 'Escape'; vk = 27; text = '' }
  Delete = @{ key = 'Delete'; code = 'Delete'; vk = 46; text = '' }
  A = @{ key = 'a'; code = 'KeyA'; vk = 65; text = '' }
}
function Send-Key([string]$Name, [int]$Modifiers = 0, [string[]]$Commands = @()) {
  $k = $script:Keys[$Name]
  $down = @{ type = $(if ($k.text) { 'keyDown' } else { 'rawKeyDown' }); key = $k.key; code = $k.code; windowsVirtualKeyCode = $k.vk; nativeVirtualKeyCode = $k.vk; modifiers = $Modifiers }
  if ($k.text) { $down.text = $k.text; $down.unmodifiedText = $k.text }
  if ($Commands.Count) { $down.commands = $Commands }
  Invoke-Cdp 'Input.dispatchKeyEvent' $down | Out-Null
  Invoke-Cdp 'Input.dispatchKeyEvent' @{ type = 'keyUp'; key = $k.key; code = $k.code; windowsVirtualKeyCode = $k.vk; nativeVirtualKeyCode = $k.vk; modifiers = $Modifiers } | Out-Null
}

# Введення тексту в поле: клік, Ctrl+A, набір (або Delete для порожнього значення)
function Set-Field([string]$Selector, [string]$Text) {
  Click-Element $Selector
  Send-Key 'A' -Modifiers 2 -Commands @('selectAll')
  if ($Text -eq '') { Send-Key 'Delete' } else { Invoke-Cdp 'Input.insertText' @{ text = $Text } | Out-Null }
}

# Вибір у списку select (значення, подія change)
function Select-Option([string]$Selector, [string]$Value) {
  Invoke-Js "(() => { const s = document.querySelector($(ConvertTo-JsonText $Selector)); s.focus(); s.value = $(ConvertTo-JsonText $Value); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()" | Out-Null
}

# Вибір файлу в <input type="file"> (як у діалозі відкриття файлу)
function Set-FileInput([string]$Selector, [string]$Path) {
  $r = Invoke-Cdp 'Runtime.evaluate' @{ expression = "document.querySelector($(ConvertTo-JsonText $Selector))" }
  Invoke-Cdp 'DOM.setFileInputFiles' @{ files = @((Resolve-Path -LiteralPath $Path).Path); objectId = $r['result']['objectId'] } | Out-Null
}

function Set-DownloadFolder([string]$Dir) {
  New-Item -ItemType Directory -Force $Dir | Out-Null
  Invoke-Cdp 'Browser.setDownloadBehavior' @{ behavior = 'allow'; downloadPath = $Dir; eventsEnabled = $true } -Browser | Out-Null
}

# Очікує файл, збережений браузером (без тимчасового .crdownload, розмір не змінюється)
function Wait-Download([string]$Dir, [string]$Name, [double]$TimeoutSec = 20) {
  $path = Join-Path $Dir $Name
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $last = -1
  while ($true) {
    if ((Test-Path -LiteralPath $path) -and -not (Test-Path -LiteralPath "$path.crdownload")) {
      $size = (Get-Item -LiteralPath $path).Length
      if ($size -gt 0 -and $size -eq $last) { return Get-Item -LiteralPath $path }
      $last = $size
    }
    if ((Get-Date) -gt $deadline) { throw "Файл $Name не збережено за $TimeoutSec с" }
    Start-Sleep -Milliseconds 150
  }
}

# ------------------------------------------------------------------ знімки екрана
function Save-Screenshot([string]$Path, [string]$Selector = '', [int]$Pad = 10) {
  $params = @{ format = 'png'; captureBeyondViewport = $true }
  if ($Selector) {
    $r = Invoke-Js "(() => { const el = document.querySelector($(ConvertTo-JsonText $Selector)); const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; })()"
    $params.clip = @{ x = [Math]::Max(0, [double]$r['x'] - $Pad); y = [Math]::Max(0, [double]$r['y'] - $Pad); width = [double]$r['w'] + 2 * $Pad; height = [double]$r['h'] + 2 * $Pad; scale = 1 }
  }
  $img = Invoke-Cdp 'Page.captureScreenshot' $params
  New-Item -ItemType Directory -Force (Split-Path $Path) | Out-Null
  [IO.File]::WriteAllBytes($Path, [Convert]::FromBase64String($img['data']))
}

# ------------------------------------------------------------------ покриття коду (V8 precise coverage)
function Start-Coverage {
  Invoke-Cdp 'Profiler.enable' | Out-Null
  Invoke-Cdp 'Profiler.startPreciseCoverage' @{ callCount = $true; detailed = $true } | Out-Null
}

# Знімок покриття файлів застосунку; лічильники V8 після знімка обнуляються
function Get-CoverageSnapshot {
  $r = Invoke-Cdp 'Profiler.takePreciseCoverage'
  @($r['result'] | Where-Object { $_['url'] -match '/Application/js/[\w-]+\.js$' } | ForEach-Object { @{ url = $_['url']; functions = $_['functions'] } })
}
