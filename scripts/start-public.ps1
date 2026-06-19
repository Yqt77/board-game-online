$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Write-Info([string]$Message) {
  Write-Host "[board-game] $Message"
}

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

$installedCloudflared = Join-Path $env:LOCALAPPDATA 'cloudflared\cloudflared.exe'
$wingetCloudflared = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe'

if (-not (Test-Path (Join-Path $projectRoot 'server.js'))) {
  throw 'server.js not found. Run this script from the project folder.'
}

if (-not (Test-Command 'cloudflared')) {
  Write-Info 'cloudflared not found. Installing it first...'
  & (Join-Path $PSScriptRoot 'install-cloudflared.ps1')
}

if (-not (Test-Command 'cloudflared') -and -not (Test-Path $installedCloudflared)) {
  if (-not (Test-Path $wingetCloudflared)) {
    throw 'cloudflared is still missing after install.'
  }
}

function Resolve-CloudflaredPath([string]$Path) {
  if (-not (Test-Path $Path)) {
    return $null
  }
  $item = Get-Item $Path
  if ($item.Target -is [array] -and $item.Target.Count -gt 0) {
    return $item.Target[0]
  }
  return $Path
}

if (-not (Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue)) {
  Write-Info 'Starting local game server on port 3000...'
  Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $projectRoot | Out-Null
  Start-Sleep -Seconds 2
}

Write-Info 'Starting Cloudflare quick tunnel...'
Write-Info 'Copy the https://xxxx.trycloudflare.com address and paste it into the "公网地址" field in the app.'
if (Test-Command 'cloudflared') {
  cloudflared tunnel --url http://127.0.0.1:3000
} elseif (Test-Path $wingetCloudflared) {
  $resolved = Resolve-CloudflaredPath $wingetCloudflared
  & $resolved tunnel --url http://127.0.0.1:3000
} else {
  $resolved = Resolve-CloudflaredPath $installedCloudflared
  & $resolved tunnel --url http://127.0.0.1:3000
}
