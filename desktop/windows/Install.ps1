param(
  [Parameter(Mandatory=$true)][string]$BackendRoot,
  [string]$Distro='Ubuntu', [string]$ProfilePath='', [string]$RelayUrl='',
  [string]$TargetDirectory=(Join-Path $env:LOCALAPPDATA 'DSHSuite'),
  [switch]$CreateShortcut
)
$ErrorActionPreference='Stop'
if (!$BackendRoot.StartsWith('/') -or $BackendRoot.IndexOfAny([char[]]"`r`n`0") -ge 0) { throw 'BackendRoot must be an absolute Linux path' }
if ($ProfilePath -and !$ProfilePath.StartsWith('/')) { throw 'ProfilePath must be absolute' }
if ($RelayUrl) { $relayUri=[Uri]$RelayUrl; if ($relayUri.Scheme -ne 'https' -or $relayUri.UserInfo -or $relayUri.Query -or $relayUri.Fragment) { throw 'Use a plain HTTPS relay URL, never a DR2 code' } }
$TargetDirectory=[IO.Path]::GetFullPath($TargetDirectory)
$settingsFile=Join-Path $TargetDirectory 'desktop.settings.json'
if (Test-Path -LiteralPath (Join-Path $TargetDirectory 'DSHarness.exe')) { throw 'Target already has an installation. Choose a new version directory; existing files were not changed.' }
New-Item -ItemType Directory -Force -Path $TargetDirectory | Out-Null
foreach($file in @('DSHarness.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','widget.js','splash-logo.png')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $TargetDirectory
}
if (!(Test-Path -LiteralPath $settingsFile)) {
  @{ Distro=$Distro; BackendRoot=$BackendRoot; ProfilePath=$ProfilePath; DshUrl='http://127.0.0.1:3080/'; RelayUrl=$RelayUrl; StopOnClose=$true } | ConvertTo-Json | Set-Content -LiteralPath $settingsFile -Encoding UTF8
}
if ($CreateShortcut) {
  $shortcutPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'DSH Suite.lnk'
  if (Test-Path -LiteralPath $shortcutPath) { Write-Warning 'Existing shortcut preserved.' }
  else { $shell=New-Object -ComObject WScript.Shell; $link=$shell.CreateShortcut($shortcutPath); $link.TargetPath=Join-Path $TargetDirectory 'DSHarness.exe'; $link.WorkingDirectory=$TargetDirectory; $link.Save() }
}
Write-Host 'Desktop installed. Initialize the Linux suite profile before first launch; see docs/suite.md.'
