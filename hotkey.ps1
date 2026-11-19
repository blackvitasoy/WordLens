# WordLens 全局热键托盘程序
# 常驻后台，Ctrl+Shift+W 唤起/收起翻译浮窗；托盘图标可显示/隐藏/退出
# 由 启动热键翻译.bat 以隐藏窗口方式启动

$ErrorActionPreference = 'Stop'

# ---------- 配置 ----------
$APP_TITLE    = 'WordLens 翻译'                       # 浮窗标题（与 popup.html 的 title 一致）
$POPUP_URL    = 'http://localhost:7788/popup.html'
$APP_URL      = 'http://localhost:7788/app.html'   # 桌面工作台（独立应用窗口）
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
$CONFIG_FILE  = Join-Path $ROOT 'hotkey_config.json'
$ICON_FILE    = Join-Path $ROOT 'public/app.ico'

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

# 打开桌面工作台（独立应用窗口，无地址栏）
function Open-Workbench {
  Ensure-Server | Out-Null
  $browserArgs = @("--app=$APP_URL", '--window-size=1200,820', '--window-position=160,80', '--disable-features=Translate')
  try {
    Start-Process -FilePath $Browser -ArgumentList $browserArgs -ErrorAction Stop | Out-Null
    Log '打开桌面工作台'
  } catch { Log "打开工作台失败: $($_.Exception.Message)" }
}

# ---------- 热键配置读写 ----------
# 从 VK 码反推显示名
function Vk-Name($vk, $mod) {
  $s = ''
  if ($mod -band $MOD_CONTROL) { $s += 'Ctrl+' }
  if ($mod -band $MOD_ALT)     { $s += 'Alt+' }
  if ($mod -band $MOD_SHIFT)   { $s += 'Shift+' }
  if ($mod -band $MOD_WIN)     { $s += 'Win+' }
  $letter = [char]$vk
  if ($vk -ge 0x41 -and $vk -le 0x5A) { $s += [char]$vk }
  elseif ($vk -ge 0x30 -and $vk -le 0x39) { $s += [char]$vk }
  elseif ($vk -ge 0x70 -and $vk -le 0x7B) { $s += ('F' + ($vk - 0x6F)) }
  else { $s += ('VK' + $vk) }
  return $s
}

function Load-HotkeyConfig {
  if (-not (Test-Path $CONFIG_FILE)) { return $null }
  try {
    $j = Get-Content $CONFIG_FILE -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -ne $j.mod -and $null -ne $j.vk) {
      return @{ Name = (Vk-Name ([int]$j.vk) ([int]$j.mod)); Mod = [int]$j.mod; Vk = [int]$j.vk }
    }
  } catch { Log "读取热键配置失败: $($_.Exception.Message)" }
  return $null
}

function Save-HotkeyConfig($hk) {
  $obj = [ordered]@{ mod = $hk.Mod; vk = $hk.Vk; name = $hk.Name }
  $json = $obj | ConvertTo-Json
  [System.IO.File]::WriteAllText($CONFIG_FILE, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# 首次启动向导：弹窗让用户按下想用的组合键（修饰键 + 一个普通键）
function Show-HotkeyWizard {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'WordLens - 设置唤起热键'
  $form.Width = 440; $form.Height = 210
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false; $form.MinimizeBox = $false
  $form.KeyPreview = $true
  $form.TopMost = $true
  $form.BringToFront()

  $lbl1 = New-Object System.Windows.Forms.Label
  $lbl1.Text = '为翻译浮窗设置一个唤起热键'
  $lbl1.Left = 24; $lbl1.Top = 20; $lbl1.Width = 390; $lbl1.Height = 26
  $lbl1.Font = New-Object System.Drawing.Font('Microsoft YaHei', 13, [System.Drawing.FontStyle]::Bold)

  $lbl2 = New-Object System.Windows.Forms.Label
  $lbl2.Text = "请同时按下组合键（例如 Ctrl + Shift + D）：`n必须包含 Ctrl / Alt / Shift / Win 中至少一个"
  $lbl2.Left = 24; $lbl2.Top = 52; $lbl2.Width = 390; $lbl2.Height = 42

  $disp = New-Object System.Windows.Forms.TextBox
  $disp.Left = 24; $disp.Top = 100; $disp.Width = 390; $disp.Height = 34
  $disp.ReadOnly = $true; $disp.TextAlign = 'Center'
  $disp.Font = New-Object System.Drawing.Font('Consolas', 16, [System.Drawing.FontStyle]::Bold)
  $disp.Text = '等待按键…'

  $btnOK = New-Object System.Windows.Forms.Button
  $btnOK.Text = '确定'; $btnOK.Left = 254; $btnOK.Top = 146; $btnOK.Width = 76; $btnOK.Height = 30
  $btnOK.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $btnOK.Enabled = $false
  $btnCancel = New-Object System.Windows.Forms.Button
  $btnCancel.Text = '使用默认'; $btnCancel.Left = 338; $btnCancel.Top = 146; $btnCancel.Width = 76; $btnCancel.Height = 30
  $btnCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

  $script:wizardCaptured = $null
  $form.Add_KeyDown({
    param($s, $e)
    # 忽略纯修饰键本身
    if ($e.KeyCode -in @('ControlKey','Shift','Alt','Menu','LControlKey','RControlKey','LShiftKey','RShiftKey','LMenu','RMenu')) { return }
    $m = 0
    if ($e.Control) { $m = $m -bor $MOD_CONTROL }
    if ($e.Shift)   { $m = $m -bor $MOD_SHIFT }
    if ($e.Alt)     { $m = $m -bor $MOD_ALT }
    if ($m -eq 0) { $disp.Text = '请加上 Ctrl / Alt / Shift / Win'; return }
    $vk = [int]$e.KeyCode
    $name = Vk-Name $vk $m
    $disp.Text = $name
    $script:wizardCaptured = @{ Name = $name; Mod = $m; Vk = $vk }
    $btnOK.Enabled = $true
  })

  $form.Controls.Add($lbl1) | Out-Null
  $form.Controls.Add($lbl2) | Out-Null
  $form.Controls.Add($disp) | Out-Null
  $form.Controls.Add($btnOK) | Out-Null
  $form.Controls.Add($btnCancel) | Out-Null
  $form.AcceptButton = $btnOK
  $form.CancelButton = $btnCancel

  if ($form.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK -and $script:wizardCaptured) {
    $form.Dispose()
    return $script:wizardCaptured
  }
  $form.Dispose()
  return $null
}

# ---------- 托盘图标 ----------
$tray = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path $ICON_FILE) {
  try { $tray.Icon = New-Object System.Drawing.Icon($ICON_FILE) }
  catch { $tray.Icon = [System.Drawing.SystemIcons]::Information; Log "自定义图标加载失败: $($_.Exception.Message)" }
} else {
  $tray.Icon = [System.Drawing.SystemIcons]::Information
}
$tray.Text = "WordLens 翻译`n正在注册热键…"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$mDesk   = $menu.Items.Add('打开 WordLens 工作台')
$mDesk.Add_Click({ Open-Workbench }) | Out-Null
$mShow    = $menu.Items.Add('显示 / 收起翻译窗口')
$mShow.Add_Click({ Show-Popup }) | Out-Null
$mOpen    = $menu.Items.Add('打开完整词典页面')
$mOpen.Add_Click({ Start-Process 'http://localhost:7788/' }) | Out-Null
$menu.Items.Add('-') | Out-Null
$mRestart = $menu.Items.Add('重启后端服务')
$mRestart.Add_Click({ Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500; Ensure-Server | Out-Null; [System.Windows.Forms.MessageBox]::Show('后端服务已重启','WordLens') }) | Out-Null
$mHotkey  = $menu.Items.Add('更改唤起热键…')
$mHotkey.Add_Click({
  $wiz = Show-HotkeyWizard
  if ($wiz) {
    Save-HotkeyConfig $wiz
    # 重新注册：先注销旧键，注册新键
    if ($script:registered) { [WinApi]::UnregisterHotKey($script:hwnd, $HOTKEY_ID) | Out-Null }
    $ok = [WinApi]::RegisterHotKey($script:hwnd, $HOTKEY_ID, [uint32]$wiz.Mod, [uint32]$wiz.Vk)
    if (-not $ok) {
      # 新键被占用，尝试候选
      foreach ($hk in $HK_CANDIDATES) {
        $ok = [WinApi]::RegisterHotKey($script:hwnd, $HOTKEY_ID, [uint32]$hk.Mod, [uint32]$hk.Vk)
        if ($ok) { $wiz = $hk; break }
      }
    }
    if ($ok) {
      $script:ACTIVE_HK = $wiz
      $script:registered = $true
      Save-HotkeyConfig $wiz
      $tray.Text = "WordLens 翻译`n$($wiz.Name) 唤起/收起"
      Log "热键已更改为: $($wiz.Name)"
      [System.Windows.Forms.MessageBox]::Show("热键已更改为 $($wiz.Name)",'WordLens')
    } else {
      [System.Windows.Forms.MessageBox]::Show('该组合键被其他程序占用，请换一个。','WordLens')
    }
  }
}) | Out-Null
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

  # 读取配置：首次启动弹向导，之后直接用保存的热键
  $saved = Load-HotkeyConfig
  $tryOrder = @()
  if ($saved) {
    $tryOrder += $saved
    Log "使用已保存热键: $($saved.Name)"
  } else {
    Log '首次启动，弹出热键配置向导'
    $wizard = Show-HotkeyWizard
    if ($wizard) {
      Save-HotkeyConfig $wizard
      $tryOrder += $wizard
      Log "用户设置热键: $($wizard.Name)（已保存）"
    } else {
      Log '用户选择使用默认热键'
    }
  }
  # 无论配置如何，都追加候选列表兜底（配置键被占用时自动降级）
  foreach ($hk in $HK_CANDIDATES) {
    if (-not ($tryOrder | Where-Object { $_.Mod -eq $hk.Mod -and $_.Vk -eq $hk.Vk })) { $tryOrder += $hk }
  }

  foreach ($hk in $tryOrder) {
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
