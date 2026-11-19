# 由 修复_FlClash启动_SAC.bat 调用；非管理员时自我提权
$path = 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy'
$name = 'VerifiedAndReputablePolicyState'
$log  = 'C:/Users/ceprei/WorkBuddy/2026-11-19-09-13-35/WordLens/sac_fix.log'

function WLog($m){
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $m`r`n"
  [System.IO.File]::AppendAllText($log,$line,(New-Object System.Text.UTF8Encoding($false)))
}

# 非管理员 -> 自我提权（弹 UAC），然后退出当前进程
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  WLog "非管理员，请求 UAC 提权"
  $script = $MyInvocation.MyCommand.Path
  Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',("`"$script`"")) -Verb RunAs -Wait
  exit 0
}

try {

  $old = (Get-ItemProperty -Path $path -Name $name -ErrorAction Stop).$name
  WLog "原值: $old"

  if ($old -eq 0) {
    WLog "SAC 已是关闭状态，无需修改"
  } else {
    Set-ItemProperty -Path $path -Name $name -Value 0 -Type DWord -ErrorAction Stop
    $new = (Get-ItemProperty -Path $path -Name $name -ErrorAction Stop).$name
    WLog "修改后: $new"
    if ($new -ne 0) { throw "写入后校验失败" }
    WLog "成功：智能应用控制已关闭（25H2 可从设置重新开启）"
  }

  # 用 citool 刷新代码完整性策略，使其立即生效（免重启）
  try {
    $ci = 'C:/Windows/System32/citool.exe'
    if (Test-Path $ci) {
      $out = & $ci -r 2>&1
      WLog "citool -r 刷新完成: $($out -join ' ')"
    } else {
      WLog "未找到 citool，需重启生效"
    }
  } catch { WLog "citool 刷新跳过: $($_.Exception.Message)" }

  # 验证最终状态
  try {
    $final = (Get-ItemProperty -Path $path -Name $name -ErrorAction Stop).$name
    WLog "最终 VerifiedAndReputablePolicyState = $final (0=关闭)"
  } catch {}

} catch {
  WLog "失败: $($_.Exception.Message)"
}
