$ErrorActionPreference = 'Stop'

function Write-Info([string]$Message) {
  Write-Host "[cloudflared] $Message"
}

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-WingetCloudflaredPath {
  $candidate = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe'
  if (Test-Path $candidate) {
    $item = Get-Item $candidate
    if ($item.Target -is [array] -and $item.Target.Count -gt 0) {
      return $item.Target[0]
    }
    return $candidate
  }
  return $null
}

if (Test-Command 'cloudflared') {
  Write-Info "cloudflared is already installed: $(cloudflared --version)"
  exit 0
}

$wingetPath = Get-WingetCloudflaredPath
if ($wingetPath) {
  Write-Info "cloudflared is already installed at $wingetPath"
  Write-Info "Version: $(& $wingetPath --version)"
  exit 0
}

if (Test-Command 'winget') {
  Write-Info 'Installing cloudflared with winget...'
  winget install --id Cloudflare.cloudflared -e --accept-package-agreements --accept-source-agreements
  if (Test-Command 'cloudflared') {
    Write-Info "Installed successfully: $(cloudflared --version)"
    exit 0
  }
  $wingetPath = Get-WingetCloudflaredPath
  if ($wingetPath) {
    Write-Info "Installed successfully at $wingetPath"
    Write-Info "Version: $(& $wingetPath --version)"
    exit 0
  }
  Write-Info 'winget finished, but cloudflared is still not on PATH. Falling back to manual download.'
}

$targetDir = Join-Path $env:LOCALAPPDATA 'cloudflared'
$targetFile = Join-Path $targetDir 'cloudflared.exe'
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

Write-Info 'Downloading the latest Windows amd64 release from GitHub...'
try {
  $downloadUrl = (Invoke-RestMethod -Headers @{ 'User-Agent' = 'board-game-online-installer' } `
    -Uri 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest').assets |
    Where-Object { $_.name -eq 'cloudflared-windows-amd64.exe' } |
    Select-Object -First 1 |
    Select-Object -ExpandProperty browser_download_url
  if (-not $downloadUrl) {
    throw 'Could not find cloudflared-windows-amd64.exe in the latest GitHub release.'
  }
  Invoke-WebRequest -Uri $downloadUrl -OutFile $targetFile
} catch {
  throw "Manual download failed. cloudflared is likely already available at the winget path. Error: $($_.Exception.Message)"
}

Write-Info "Downloaded to $targetFile"
Write-Info 'If this PowerShell session does not see cloudflared yet, open a new terminal.'
Write-Info "Version: $(& $targetFile --version)"
