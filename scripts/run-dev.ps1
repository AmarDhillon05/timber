# run-dev.ps1 — bring up the whole dev stack, each process in its own terminal
# window, with the relay URL wired per-process via EXPO_PUBLIC_RELAY_URL.
#
# Six windows: relay (:8787) · recorder (:8790) · saver (:8791) ·
# app/Electron (:8081) · controller (:8082) · backend/uvicorn (:8000). The app and controller never
# talk directly — both reach the relay, so the relay must be up for pairing to
# work. The recorder sidecar (recorder/windows; needs the .NET 8 SDK for
# `dotnet run`) does two jobs over one local WebSocket: system-audio capture
# (WASAPI loopback) AND media control (SMTC — how the phone remote's
# skip/play-pause buttons reach Spotify et al). Without it, arming system audio
# on the Record page and the remote's transport buttons both fail with a message
# naming how to start it. Pass -NoBackend to skip uvicorn: the app pings it on
# launch and degrades gracefully, so dev without AI suggestions doesn't need it.
#
# Every port auto-bumps to the next free one if something is already listening
# (and prints what moved), so stale dev servers can't wedge the stack.
#
# Usage (run on the WINDOWS host — the recorder sidecar needs it for WASAPI +
# SMTC; the app itself no longer depends on Electron for either):
#   ./scripts/run-dev.ps1                 # controller as web on THIS machine (localhost)
#   ./scripts/run-dev.ps1 -Lan            # controller reachable from a phone (auto LAN IP)
#   ./scripts/run-dev.ps1 -NoBackend      # skip uvicorn (:8000) / AI suggestions
#   ./scripts/run-dev.ps1 -RelayPort 9000 # move the relay off 8787 (wires all three)
#   ./scripts/run-dev.ps1 -AppPort 9081 -ControllerPort 9082 -BackendPort 9000
#   ./scripts/run-dev.ps1 -RecorderPort 9790 # move the recorder sidecar off 8790
#   ./scripts/run-dev.ps1 -SaverPort 9791 # move the saver sidecar off 8791
#   ./scripts/run-dev.ps1 -SavedData D:\timber-projects # where projects are saved
#
# -Lan auto-detects this machine's LAN IP and points ONLY the controller at it,
# so a phone on the same Wi-Fi can reach the relay. The app + relay stay on
# localhost (they share this machine). If the detected IP is wrong, set
# EXPO_PUBLIC_RELAY_URL yourself in the controller window.
#
# Projects the app saves and reopens live in ONE folder — the saver's root,
# passed as SAVED_DATA_DIR. It defaults to <repo>\saved_data; point -SavedData
# (or the env var) somewhere else and both saving and the app's "Open a saved
# project" list follow it, since both go through the saver.
param(
  [switch]$Lan,
  [switch]$NoBackend,
  [int]$RelayPort = 8787,
  [int]$AppPort = 8081,
  [int]$ControllerPort = 8082,
  [int]$BackendPort = 8000,
  [int]$RecorderPort = 8790,
  [int]$SaverPort = 8791,
  [string]$SavedData = $env:SAVED_DATA_DIR
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # this script lives in scripts/, repo root is one up

# The saver's root — where projects are saved to AND opened from. Created up
# front so the sidecar's listing has a folder to read on a fresh checkout.
if (-not $SavedData) { $SavedData = Join-Path $root 'saved_data' }
$savedData = (New-Item -ItemType Directory -Force -Path $SavedData).FullName

# Return $Port or, if it's taken, the next free port up — announcing the move.
# "Taken" includes ports already claimed by this run (our own processes aren't
# listening yet when later picks happen, so e.g. app 8081→8082 must not collide
# with the controller's default 8082). Runs BEFORE the relay URLs are built,
# so bumping the relay rewires the clients too.
$script:chosenPorts = @()
function Select-FreePort([int]$Port, [string]$Name) {
  $orig = $Port
  while ((Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) -or
         ($script:chosenPorts -contains $Port)) { $Port++ }
  if ($Port -ne $orig) { Write-Host "Port $orig busy — $Name moved to :$Port" -ForegroundColor Yellow }
  $script:chosenPorts += $Port
  $Port
}

$relayPort = Select-FreePort $RelayPort 'relay'   # single source of truth: sets the relay's
                                                  # RELAY_PORT and builds the clients' relay URLs.
$recorderPort = Select-FreePort $RecorderPort 'recorder'
$saverPort = Select-FreePort $SaverPort 'saver'
$appPort = Select-FreePort $AppPort 'app'
$controllerPort = Select-FreePort $ControllerPort 'controller'
if (-not $NoBackend) { $BackendPort = Select-FreePort $BackendPort 'backend' }

# App ↔ relay are on the same box, so the app always uses localhost.
$appRelay = "http://localhost:$relayPort"

# Controller URL: localhost for a same-machine web run; the LAN IP for a phone.
if ($Lan) {
  # Prefer a real private-LAN address (192.168/10/172.16-31); skip loopback and
  # APIPA (169.254). First match wins — override manually if it grabs a virtual
  # adapter (WSL/VirtualBox live on 172.x too).
  $lanIp = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*'
    } |
    Sort-Object {
      switch -Wildcard ($_.IPAddress) { '192.168.*' { 0 } '10.*' { 1 } default { 2 } }
    } |
    Select-Object -First 1).IPAddress
  if (-not $lanIp) { throw 'Could not auto-detect a LAN IP; set EXPO_PUBLIC_RELAY_URL manually.' }
  $controllerRelay = "http://${lanIp}:$relayPort"
  Write-Host "Controller wired to LAN relay: $controllerRelay" -ForegroundColor Cyan
} else {
  $controllerRelay = $appRelay
}

# Install deps where missing (relay has none, but this creates node_modules).
foreach ($d in 'relay', 'controller', 'mobile') {
  if (-not (Test-Path "$root\$d\node_modules")) {
    Write-Host "Installing deps in $d ..." -ForegroundColor Yellow
    Push-Location "$root\$d"
    npm install
    Pop-Location
  }
}

# Launch each process in its own window. Use PowerShell 7 (pwsh) if present, else
# Windows PowerShell. -NoExit keeps the window open so errors stay visible.
$psExe = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell' }
function Start-Pane([string]$Title, [string]$Body) {
  # Base64-encode the child script so its nested quotes can't be mangled by
  # Start-Process argument parsing. -NoExit keeps the window open on exit/error.
  $script = "`$Host.UI.RawUI.WindowTitle = '$Title'; $Body"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  Start-Process $psExe -ArgumentList '-NoExit', '-EncodedCommand', $encoded
}

# 1. Relay — the pairing middleman. RELAY_PORT is the single source of truth;
#    the app/controller URLs below are built from the same $relayPort.
Start-Pane 'Timber relay' "Set-Location '$root\relay'; `$env:RELAY_PORT='$relayPort'; npm start"

# 1b. Recorder — the system-audio + media-control sidecar (recorder/README.md):
#     WASAPI loopback and SMTC behind a local WebSocket. `dotnet run` restores
#     + builds on first launch.
Start-Pane 'Timber recorder' "Set-Location '$root\recorder\windows'; `$env:RECORDER_PORT='$recorderPort'; dotnet run"

# 1c. Saver — the project-persistence sidecar (saver/README.md): zero-dep node.
#     SAVED_DATA_DIR is the one folder it saves into and lists from, so it backs
#     both the editor's Save and the app's "Open a saved project".
Start-Pane 'Timber saver' "Set-Location '$root\saver'; `$env:SAVER_PORT='$saverPort'; `$env:SAVED_DATA_DIR='$savedData'; node server.js"

# 2. App (receiver) — Electron desktop dev (Metro hot reload + system audio).
#    `npm run win:electron:dev` hard-codes :8081 inside package.json, so when
#    the app port moved we compose the same concurrently pipeline inline with
#    the chosen port instead. EXPO_PUBLIC_INFERENCE_URL follows the backend
#    port so a bumped/overridden backend is still found (harmless when the
#    backend isn't started).
$appCmd = if ($appPort -eq 8081) {
  'npm run win:electron:dev'
} else {
  "npx concurrently -k -n web,electron `"npx expo start --web --port $appPort`" `"npx wait-on tcp:127.0.0.1:$appPort && npx cross-env ELECTRON_START_URL=http://localhost:$appPort electron electron/main.js`""
}
Start-Pane 'Timber app' "Set-Location '$root\mobile'; `$env:EXPO_PUBLIC_RELAY_URL='$appRelay'; `$env:EXPO_PUBLIC_INFERENCE_URL='http://localhost:$BackendPort'; `$env:EXPO_PUBLIC_RECORDER_URL='ws://localhost:$recorderPort'; `$env:EXPO_PUBLIC_SAVER_URL='http://localhost:$saverPort'; $appCmd"

# 3. Controller (sender) — web by default; a Metro dev server (for a phone via
#    Expo Go) when -Lan. Separate port so it never collides with the app.
$ctlCmd = if ($Lan) { "npm start -- --port $controllerPort" } else { "npm run web -- --port $controllerPort" }
Start-Pane 'Timber controller' "Set-Location '$root\controller'; `$env:EXPO_PUBLIC_RELAY_URL='$controllerRelay'; $ctlCmd"

# 4. Backend (inference) — on by default, -NoBackend skips it; activates .venv
#    if present. Without it the app's AI suggestions are disabled but
#    everything else works.
if (-not $NoBackend) {
  $backendCmd = "Set-Location '$root'; if (Test-Path '.venv\Scripts\Activate.ps1') { . .venv\Scripts\Activate.ps1 }; uvicorn inference.api:app --reload --port $BackendPort"
  Start-Pane 'Timber backend' $backendCmd
  Write-Host "Launched relay (:$relayPort), recorder (:$recorderPort), saver (:$saverPort), app (:$appPort), controller (:$controllerPort), backend (:$BackendPort)." -ForegroundColor Green
} else {
  Write-Host "Launched relay (:$relayPort), recorder (:$recorderPort), saver (:$saverPort), app (:$appPort), controller (:$controllerPort). Backend skipped (-NoBackend)." -ForegroundColor Green
}
Write-Host "Projects save to and open from: $savedData" -ForegroundColor Green
Write-Host 'Pair: open the remote screen in the app, enter the shown code in the controller.' -ForegroundColor Green
