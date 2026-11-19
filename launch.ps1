# WordLens desktop launcher
# 1) start local server if needed  2) start tray/hotkey  3) open the app window
$ErrorActionPreference = 'SilentlyContinue'
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$NODE_EXE = 'C:/Users/ceprei/.workbuddy/binaries/node/versions/22.22.2-6/node.exe'
if (-not (Test-Path $NODE_EXE)) { $NODE_EXE = 'node' }
$SERVER_JS = Join-Path $ROOT 'server.js'
$TRAY_PS1  = Join-Path $ROOT 'hotkey.ps1'
$APP_URL   = 'http://localhost:7788/app.html'
$BROWSERS = @(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
)

# --- server ---
$up = $false
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:7788/api/ping' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
  if ($r.StatusCode -eq 200) { $up = $true }
} catch {}
if (-not $up) {
  # UseShellExecute avoids inherited duplicate proxy env keys
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $NODE_EXE
  $psi.Arguments = "`"$SERVER_JS`""
  $psi.WorkingDirectory = $ROOT
  $psi.UseShellExecute = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  [System.Diagnostics.Process]::Start($psi) | Out-Null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 400
    try {
      $r = Invoke-WebRequest -Uri 'http://localhost:7788/api/ping' -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
      if ($r.StatusCode -eq 200) { break }
    } catch {}
  }
}

# --- browser ---
$browser = $null
foreach ($p in $BROWSERS) { if (Test-Path $p) { $browser = $p; break } }
if (-not $browser) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show('Chrome / Edge not found.', 'WordLens') | Out-Null
  exit 1
}

# --- tray (hotkey.ps1 has its own single-instance guard) ---
$trayArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$TRAY_PS1`""
Start-Process -FilePath 'powershell.exe' -ArgumentList $trayArgs -WindowStyle Hidden | Out-Null

# --- app window (reuse if already open, avoid duplicate windows) ---
$existing = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*--app=$APP_URL*" } | Select-Object -First 1
if (-not $existing) {
  $appArgs = @("--app=$APP_URL", '--window-size=1200,820', '--window-position=160,80', '--disable-features=Translate')
  Start-Process -FilePath $browser -ArgumentList $appArgs | Out-Null
} else {
  try {
    $ws = New-Object -ComObject WScript.Shell
    $ws.AppActivate('WordLens') | Out-Null
  } catch {}
}

# --- first run: create a desktop shortcut with our own icon ---
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'WordLens.lnk'
  if (-not (Test-Path $lnk)) {
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnk)
    $sc.TargetPath = 'powershell.exe'
    $sc.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $ROOT 'launch.ps1') + '"'
    $sc.WorkingDirectory = $ROOT
    $sc.IconLocation = Join-Path $ROOT 'public/app.ico'
    $sc.Description = 'WordLens Desktop Dictionary'
    $sc.Save()
  }
} catch {}
