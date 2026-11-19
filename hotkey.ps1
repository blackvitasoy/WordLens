# WordLens 全局热键托盘程序
# 常驻后台，Ctrl+Shift+W 唤起/收起翻译浮窗；托盘图标可显示/隐藏/退出
# 由 启动热键翻译.bat 以隐藏窗口方式启动

$ErrorActionPreference = 'Stop'

# ---------- 配置 ----------
$APP_TITLE    = 'WordLens 翻译'                       # 浮窗标题（与 popup.html 的 title 一致）
$POPUP_URL    = 'http://localhost:7788/popup.html'
# 浏览器候选（无地址栏的 app 窗口）。Chrome 优先，EDGE 兜底
$BROWSER_PATHS = @(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
)
$ROOT         = Split-Path -Parent $MyInvocation.MyCommand.Path
$NODE_EXE     = 'C:/Users/ceprei/.workbuddy/binaries/node/versions/22.22.2-6/node.exe'
if (-not (Test-Path $NODE_EXE)) { $NODE_EXE = 'node' }
$SERVER_JS    = Join-Path $ROOT 'server.js'
$LOCK_FILE    = Join-Path $ROOT '.hotkey.lock'
$LOG_FILE     = Join-Path $ROOT 'hotkey.log'

# 热键候选（按优先级尝试，自动选用第一个未被占用的组合）
# modifiers: Alt=1, Ctrl=2, Shift=4, Win=8
$MOD_ALT      = 0x0001
$MOD_CONTROL  = 0x0002
$MOD_SHIFT    = 0x0004
$MOD_WIN      = 0x0008
$HOTKEY_ID    = 1
$HK_CANDIDATES = @(
  @{ Name='Ctrl+Shift+W';  Mod=($MOD_CONTROL -bor $MOD_SHIFT); Vk=0x57 },
  @{ Name='Ctrl+Alt+W';    Mod=($MOD_CONTROL -bor $MOD_ALT);   Vk=0x57 },
  @{ Name='Ctrl+Shift+D';  Mod=($MOD_CONTROL -bor $MOD_SHIFT); Vk=0x44 },
  @{ Name='Ctrl+Alt+D';    Mod=($MOD_CONTROL -bor $MOD_ALT);   Vk=0x44 },
  @{ Name='Ctrl+Shift+K';  Mod=($MOD_CONTROL -bor $MOD_SHIFT); Vk=0x4B },
  @{ Name='Ctrl+Alt+K';    Mod=($MOD_CONTROL -bor $MOD_ALT);   Vk=0x4B },
  @{ Name='Ctrl+Shift+J';  Mod=($MOD_CONTROL -bor $MOD_SHIFT); Vk=0x4A },
  @{ Name='Ctrl+Alt+J';    Mod=($MOD_CONTROL -bor $MOD_ALT);   Vk=0x4A }
)
$ACTIVE_HK = $null

function Log($msg) {
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $line = "[$ts] $msg`r`n"
  [System.IO.File]::AppendAllText($LOG_FILE, $line, (New-Object System.Text.UTF8Encoding($false)))
}

# ---------- 单实例保护 ----------
if (Test-Path $LOCK_FILE) {
  $oldPid = (Get-Content $LOCK_FILE -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Log "已有实例在运行 PID=$oldPid，退出"
    exit 0
  }
}
Set-Content -Path $LOCK_FILE -Value $PID -ErrorAction SilentlyContinue

# ---------- Win32 API（从独立 .cs 文件编译） ----------
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$csFile = Join-Path $ROOT 'hotkey_native.cs'
$src = Get-Content -Path $csFile -Raw -Encoding UTF8
Add-Type -ReferencedAssemblies 'System.Windows.Forms','System.Drawing' -TypeDefinition $src -ErrorAction Stop

# ---------- 确保后端服务已启动 ----------
function Ensure-Server {
  try {
    $r = Invoke-WebRequest -Uri 'http://localhost:7788/' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    if ($r.StatusCode -eq 200) { return $true }
  } catch {}
  try {
    # UseShellExecute=true 走 ShellExecuteEx，不继承环境变量块，规避 https_proxy/HTTPS_PROXY 重复键冲突
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $NODE_EXE
    $psi.Arguments = "`"$SERVER_JS`""
    $psi.WorkingDirectory = $ROOT
    $psi.UseShellExecute = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    [System.Diagnostics.Process]::Start($psi) | Out-Null
    Start-Sleep -Milliseconds 1500
    return $true
  } catch {
    Log "启动后端服务失败: $($_.Exception.Message)"
    return $false
  }
}
Ensure-Server | Out-Null

# ---------- 查找浏览器 ----------
$Browser = $null
foreach ($p in $BROWSER_PATHS) { if (Test-Path $p) { $Browser = $p; break } }
if (-not $Browser) { Log '未找到 Chrome/Edge 浏览器'; [System.Windows.Forms.MessageBox]::Show('未找到 Chrome 或 Edge 浏览器，无法创建翻译浮窗。','WordLens'); exit 1 }
Log "使用浏览器: $Browser"

# ---------- 浮窗控制 ----------
function Find-PopupWindow {
  # 枚举方式按标题包含匹配，容忍 Chrome/Edge 给标题加的后缀
  return [WinApi]::FindByTitle($APP_TITLE)
}

function Show-Popup {
  $h = Find-PopupWindow
  if ($h -ne [IntPtr]::Zero) {
    if ([WinApi]::IsWindowVisible($h)) {
      # 已显示 -> 隐藏（收起）
      [WinApi]::ShowWindow($h, [WinApi]::SW_HIDE) | Out-Null
      Log '收起浮窗'
    } else {
      [WinApi]::ShowWindow($h, [WinApi]::SW_SHOW) | Out-Null
      [WinApi]::SetForegroundWindow($h) | Out-Null
      Log '显示浮窗'
    }
  } else {
    # 不存在 -> 新建。--app 无地址栏，独立窗口；标题由 popup.html 的 title 提供
    $browserArgs = @("--app=$POPUP_URL", '--window-size=560,720', '--window-position=120,90', '--disable-features=Translate')
    try {
      Start-Process -FilePath $Browser -ArgumentList $browserArgs -ErrorAction Stop | Out-Null
      Log '新建浮窗'
    } catch { Log "启动浮窗失败: $($_.Exception.Message)" }
  }
}

function Hide-Popup {
  $h = Find-PopupWindow
  if ($h -ne [IntPtr]::Zero) { [WinApi]::ShowWindow($h, [WinApi]::SW_HIDE) | Out-Null }
}

# ---------- 托盘图标 ----------
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.SystemIcons]::Information
$tray.Text = "WordLens 翻译`n正在注册热键…"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$mShow    = $menu.Items.Add('显示 / 收起翻译窗口')
$mShow.Add_Click({ Show-Popup }) | Out-Null
$mOpen    = $menu.Items.Add('打开完整词典页面')
$mOpen.Add_Click({ Start-Process 'http://localhost:7788/' }) | Out-Null
$menu.Items.Add('-') | Out-Null
$mRestart = $menu.Items.Add('重启后端服务')
$mRestart.Add_Click({ Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500; Ensure-Server | Out-Null; [System.Windows.Forms.MessageBox]::Show('后端服务已重启','WordLens') }) | Out-Null
$mExit    = $menu.Items.Add('退出 WordLens')
$mExit.Add_Click({ [System.Windows.Forms.Application]::ExitThread() }) | Out-Null
$tray.ContextMenuStrip = $menu
$tray.Add_DoubleClick({ Show-Popup }) | Out-Null

# ---------- 注册热键并进入消息循环 ----------
$hwnd = [IntPtr]::Zero
$registered = $false
try {
  $win = New-Object HotKeyWindow
  $win.HotKeyCallback = [Action]{ Show-Popup }
  # 访问 Handle 属性会自动创建原生窗口句柄
  $hwnd = $win.Handle
  foreach ($hk in $HK_CANDIDATES) {
    $registered = [WinApi]::RegisterHotKey($hwnd, $HOTKEY_ID, [uint32]$hk.Mod, [uint32]$hk.Vk)
    if ($registered) { $ACTIVE_HK = $hk; break }
  }
  if ($registered -and $ACTIVE_HK) {
    Log "热键已注册: $($ACTIVE_HK.Name)  hwnd=$hwnd"
    $tray.Text = "WordLens 翻译`n$($ACTIVE_HK.Name) 唤起/收起"
  } else {
    Log '注册热键失败：所有候选组合均被占用'
    [System.Windows.Forms.MessageBox]::Show('所有候选热键都被其他程序占用了，请关闭冲突程序后重试。','WordLens')
  }

  $script:shouldExit = $false
  [System.Windows.Forms.Application]::Run($win)
} finally {
  if ($registered) { [WinApi]::UnregisterHotKey($hwnd, $HOTKEY_ID) | Out-Null }
  $tray.Visible = $false
  $tray.Dispose()
  if (Test-Path $LOCK_FILE) { Remove-Item $LOCK_FILE -Force -ErrorAction SilentlyContinue }
  Log 'WordLens 热键程序已退出'
}
