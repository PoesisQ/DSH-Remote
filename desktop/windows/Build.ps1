param([Parameter(Mandatory=$true)][string]$SdkPath, [string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
if (!$OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '..\..\dist\desktop' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('dsh-suite-build-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
foreach ($name in @('Program.cs','Settings.cs','SettingsTests.cs','MainOverlayTests.cs','app.manifest','make-icon.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $scratch }
$core = Join-Path $SdkPath 'Microsoft.Web.WebView2.Core.dll'
$forms = Join-Path $SdkPath 'Microsoft.Web.WebView2.WinForms.dll'
$loader = Join-Path $SdkPath 'WebView2Loader.dll'
if (!(Test-Path -LiteralPath $core)) {
  $core = Join-Path $SdkPath 'lib\net462\Microsoft.Web.WebView2.Core.dll'
  $forms = Join-Path $SdkPath 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
  $loader = Join-Path $SdkPath 'runtimes\win-x64\native\WebView2Loader.dll'
}
foreach ($file in @($core,$forms,$loader)) { if (!(Test-Path -LiteralPath $file)) { throw "Missing WebView2 SDK file: $file" } }
$compiler = Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
Push-Location $scratch
try {
  & (Join-Path $scratch 'make-icon.ps1') -OutputDirectory $scratch
  $cscArgs = @('/nologo','/target:winexe','/platform:x64','/optimize+','/codepage:65001',
    "/win32icon:$scratch\icon.ico", "/win32manifest:$scratch\app.manifest",
    '/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Core.dll','/r:System.Web.Extensions.dll',
    "/r:$core", "/r:$forms", "/out:$scratch\DSHarness.exe", "$scratch\Program.cs", "$scratch\Settings.cs")
  & $compiler @cscArgs
  if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed' }
  & $compiler /nologo /target:exe /codepage:65001 /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll "/out:$scratch\SettingsTests.exe" "$scratch\Settings.cs" "$scratch\SettingsTests.cs"
  if ($LASTEXITCODE -ne 0) { throw 'Desktop test compilation failed' }
  & "$scratch\SettingsTests.exe"
  if ($LASTEXITCODE -ne 0) { throw 'Desktop settings tests failed' }
  foreach ($file in @($core,$forms,$loader)) { Copy-Item -LiteralPath $file -Destination $scratch }
  & $compiler /nologo /target:exe /platform:x64 /codepage:65001 /main:DshDesktop.MainOverlayTests /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Core.dll /r:System.Web.Extensions.dll "/r:$core" "/r:$forms" "/out:$scratch\MainOverlayTests.exe" "$scratch\Program.cs" "$scratch\Settings.cs" "$scratch\MainOverlayTests.cs"
  if ($LASTEXITCODE -ne 0) { throw 'Main overlay test compilation failed' }
  & "$scratch\MainOverlayTests.exe"
  if ($LASTEXITCODE -ne 0) { throw 'Main overlay layout tests failed' }
  Copy-Item -LiteralPath (Join-Path $scratch 'DSHarness.exe') -Destination $OutputDirectory -Force
  Copy-Item -LiteralPath (Join-Path $scratch 'icon.png') -Destination (Join-Path $OutputDirectory 'splash-logo.png') -Force
  foreach ($file in @($core,$forms,$loader)) { Copy-Item -LiteralPath $file -Destination $OutputDirectory -Force }
  foreach ($name in @('widget.js','Install.ps1','desktop.settings.example.json')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $OutputDirectory -Force }
} finally {
  Pop-Location
  $resolvedScratch=[IO.Path]::GetFullPath($scratch)
  $tempPrefix=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\dsh-suite-build-'
  if ($resolvedScratch.StartsWith($tempPrefix,[StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolvedScratch -Recurse -Force }
}
Write-Host "Desktop package built: $OutputDirectory"
