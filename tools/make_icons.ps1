$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$cs  = Join-Path $root 'tools/IconForge.cs'
$pub = Join-Path $root 'public'
$assets = Join-Path $root 'assets'
Add-Type -ReferencedAssemblies 'System.Drawing' -TypeDefinition (Get-Content $cs -Raw -Encoding UTF8) -ErrorAction Stop
$src = (Get-ChildItem $assets -Filter 'Modern_flat_app_icon_*.png' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
$ico = [IconForge]::Build($src, $assets, $pub)
"src : $src"
"ico : $ico ($((Get-Item $ico).Length) bytes)"
Get-ChildItem $pub -Filter 'icon-*.png' | ForEach-Object { "png : $($_.Name) $($_.Length) bytes" }
# verify the ICO is loadable by WinForms tray
$test = New-Object System.Drawing.Icon($ico)
"icon load OK : $($test.Width)x$($test.Height)"
$test.Dispose()
