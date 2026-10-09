# Jalankan Mesin Agen (Windows PowerShell): router model + OpenCode, dari folder repo.
#   powershell -ExecutionPolicy Bypass -File mesin-agen\mulai.ps1            -> layar kerja di browser (bawaan)
#   powershell -ExecutionPolicy Bypass -File mesin-agen\mulai.ps1 terminal   -> layar kerja di terminal
#   powershell -ExecutionPolicy Bypass -File mesin-agen\mulai.ps1 run "..."  -> satu perintah lalu selesai
$ErrorActionPreference = 'Stop'

$LitellmVersi = '1.104.2'
$OpencodeVersi = '1.18.35'

$MesinDir = $PSScriptRoot
$RepoDir = Split-Path $MesinDir -Parent
$Rumah = Join-Path $HOME '.maxi-mesin'
New-Item -ItemType Directory -Force -Path $Rumah | Out-Null

$EnvFile = Join-Path $MesinDir '.env'
if (-not (Test-Path $EnvFile)) {
  Write-Host 'Belum ada mesin-agen\.env. Salin mesin-agen\.env.example menjadi mesin-agen\.env, lalu isi kuncinya.'
  exit 1
}
foreach ($baris in Get-Content $EnvFile) {
  if ($baris -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process')
  }
}
if (-not $env:OPENROUTER_API_KEY) { Write-Host 'OPENROUTER_API_KEY di mesin-agen\.env masih kosong.'; exit 1 }
if (-not $env:MAXI_AGENT_BUS_TOKEN) { Write-Host 'Catatan: MAXI_AGENT_BUS_TOKEN kosong -- mesin jalan tanpa papan tugas agen.' }

$Venv = Join-Path $Rumah 'venv'
$Litellm = Join-Path $Venv 'Scripts\litellm.exe'
if (-not (Test-Path $Litellm)) {
  Write-Host 'Memasang router (sekali saja)...'
  python -m venv $Venv
  & (Join-Path $Venv 'Scripts\pip.exe') install --quiet "litellm[proxy]==$LitellmVersi"
}

$env:PYTHONUTF8 = '1'   # router membaca file berbahasa Indonesia; Windows bawaan bukan UTF-8
if (-not $env:MESIN_ROUTER_PORT) { $env:MESIN_ROUTER_PORT = '4000' }
# Kunci lokal mesin<->router, baru setiap kali jalan; tidak disimpan di mana pun.
$env:LITELLM_MASTER_KEY = 'sk-lokal-' + [guid]::NewGuid().ToString('N')

$Log = Join-Path $Rumah 'router.log'
$Router = Start-Process -FilePath $Litellm -PassThru -WindowStyle Hidden `
  -ArgumentList @('--config', ('"' + (Join-Path $MesinDir 'router.yaml') + '"'), '--host', '127.0.0.1', '--port', $env:MESIN_ROUTER_PORT) `
  -RedirectStandardOutput $Log -RedirectStandardError "$Log.err"

try {
  $siap = $false
  for ($i = 0; $i -lt 60 -and -not $siap; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$($env:MESIN_ROUTER_PORT)/health/liveliness" | Out-Null; $siap = $true }
    catch {
      if ($Router.HasExited) { Write-Host "Router gagal menyala. Lihat $Log.err"; exit 1 }
      Start-Sleep -Seconds 1
    }
  }

  # Tanpa argumen: buka layar kerja di browser. "terminal": layar kerja di terminal.
  $Perintah = @($args)
  if ($Perintah.Count -eq 0) {
    $WebPort = if ($env:MESIN_WEB_PORT) { $env:MESIN_WEB_PORT } else { '4096' }
    Write-Host "Layar Mesin dibuka di browser: http://127.0.0.1:$WebPort"
    Write-Host 'Biarkan jendela ini terbuka selama Mesin dipakai. Tutup jendela ini untuk mematikan Mesin.'
    $Perintah = @('web', '--hostname', '127.0.0.1', '--port', $WebPort)
  } elseif ($Perintah[0] -eq 'terminal') {
    $Perintah = @($Perintah | Select-Object -Skip 1)
  }

  $env:OPENCODE_CONFIG = Join-Path $MesinDir 'opencode\opencode.json'
  $env:OPENCODE_CONFIG_DIR = Join-Path $MesinDir 'opencode'
  Set-Location $RepoDir
  if (Get-Command opencode -ErrorAction SilentlyContinue) { opencode @Perintah }
  else { npx --yes "opencode-ai@$OpencodeVersi" @Perintah }
}
finally {
  if (-not $Router.HasExited) { Stop-Process -Id $Router.Id -Force }
}
