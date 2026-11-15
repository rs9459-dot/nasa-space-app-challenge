<#
Start the FarmLine engine on this laptop, open it to the internet with a free Cloudflare
quick tunnel, and point the deployed Worker at it. Run from anywhere:

    powershell -ExecutionPolicy Bypass -File engine\start-local.ps1           # start (or restart)
    powershell -ExecutionPolicy Bypass -File engine\start-local.ps1 -Stop     # stop both
    powershell -ExecutionPolicy Bypass -File engine\start-local.ps1 -NoWorker # don't touch the Worker

What it does:
  1. Stops an engine/tunnel this script started before.
  2. Reads ENGINE_API_TOKEN from engine\.env (gitignored), making one if there is none.
  3. Starts the engine (uvicorn, port 8000) in the background and waits for /health.
  4. Starts `cloudflared tunnel --url` and reads its https://....trycloudflare.com address.
  5. Sets the Worker secrets ENGINE_URL and ENGINE_API_TOKEN (wrangler secret put), so texts
     reach this laptop. The address changes every time the tunnel restarts; rerun this script.
  6. Waits until every field has finished warming up, then prints each field's state.

Logs: %TEMP%\farmline\. During judging keep the laptop plugged in, awake and online.
#>
param([switch]$Stop, [switch]$NoWorker, [int]$Port = 8000)

$ErrorActionPreference = "Stop"
$Repo = Split-Path $PSScriptRoot -Parent
$Logs = Join-Path $env:TEMP "farmline"
New-Item -ItemType Directory -Force $Logs | Out-Null
$PidFile = Join-Path $Logs "pids.json"

function Stop-Started {
    if (Test-Path $PidFile) {
        $old = Get-Content $PidFile -Raw | ConvertFrom-Json
        foreach ($p in $old.PSObject.Properties) {
            try { Stop-Process -Id $p.Value -Force -ErrorAction Stop; Write-Host "Stopped $($p.Name) (pid $($p.Value))" } catch {}
        }
        Remove-Item $PidFile -Force
    }
}

function Wait-For([scriptblock]$Test, [int]$Seconds, [string]$What) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try { $r = & $Test; if ($r) { return $r } } catch {}
        Start-Sleep -Milliseconds 700
    }
    throw "Timed out waiting for $What (see logs in $Logs)"
}

Stop-Started
if ($Stop) { Write-Host "FarmLine engine and tunnel stopped."; return }

# --- token --------------------------------------------------------------------------------
$EnvFile = Join-Path $Repo "engine\.env"
$Token = $null
if (Test-Path $EnvFile) {
    $line = Get-Content $EnvFile | Where-Object { $_ -like "ENGINE_API_TOKEN=*" } | Select-Object -First 1
    if ($line) { $Token = $line.Substring("ENGINE_API_TOKEN=".Length).Trim() }
}
if (-not $Token) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $Token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
    Add-Content -Path $EnvFile -Value "ENGINE_API_TOKEN=$Token" -Encoding ascii
    Write-Host "Made a new ENGINE_API_TOKEN in engine\.env"
}
$env:ENGINE_API_TOKEN = $Token

# --- engine -------------------------------------------------------------------------------
$Python = Join-Path $Repo "engine\.venv\Scripts\python.exe"
if (-not (Test-Path $Python)) { throw "No engine virtualenv at $Python (see engine/requirements.txt)" }
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) { throw "Port $Port is already in use (pid $($busy[0].OwningProcess)); stop that first" }

$engine = Start-Process -FilePath $Python -WorkingDirectory $Repo -WindowStyle Hidden -PassThru `
    -ArgumentList "-m", "uvicorn", "engine.app:app", "--host", "127.0.0.1", "--port", "$Port" `
    -RedirectStandardOutput (Join-Path $Logs "engine.log") -RedirectStandardError (Join-Path $Logs "engine.err.log")
@{ engine = $engine.Id } | ConvertTo-Json | Set-Content $PidFile
Wait-For { Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 3 } 60 "the engine to start" | Out-Null
Write-Host "Engine running on http://127.0.0.1:$Port (pid $($engine.Id))"

# --- tunnel -------------------------------------------------------------------------------
$Cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $Cloudflared) { $Cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe" }
if (-not (Test-Path $Cloudflared)) { throw "cloudflared not found; install it: winget install Cloudflare.cloudflared" }
$TunnelLog = Join-Path $Logs "tunnel.log"
Remove-Item $TunnelLog -ErrorAction SilentlyContinue
$tunnel = Start-Process -FilePath $Cloudflared -WindowStyle Hidden -PassThru `
    -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:$Port" `
    -RedirectStandardError $TunnelLog -RedirectStandardOutput (Join-Path $Logs "tunnel.out.log")
@{ engine = $engine.Id; tunnel = $tunnel.Id } | ConvertTo-Json | Set-Content $PidFile

$Url = Wait-For {
    $m = Select-String -Path $TunnelLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $m.Matches[0].Value }
} 60 "the tunnel address"
Wait-For { Invoke-RestMethod "$Url/health" -TimeoutSec 5 } 90 "the tunnel to reach the engine" | Out-Null
Write-Host "Public address: $Url"
Set-Content -Path (Join-Path $Logs "engine_url.txt") -Value $Url

# --- Worker -------------------------------------------------------------------------------
if (-not $NoWorker) {
    Push-Location (Join-Path $Repo "worker")
    try {
        $Url | npx.cmd wrangler secret put ENGINE_URL | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "wrangler could not set ENGINE_URL (logged in? npx wrangler login)" }
        $Token | npx.cmd wrangler secret put ENGINE_API_TOKEN | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "wrangler could not set ENGINE_API_TOKEN" }
        Write-Host "Worker farmline-messaging now calls $Url"
    } finally { Pop-Location }
}

# --- warm-up ------------------------------------------------------------------------------
Write-Host "Preparing fields (the first time takes ~15 s per field)..."
$health = Wait-For {
    $h = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 5
    $states = @($h.fields.PSObject.Properties | ForEach-Object { $_.Value })
    if ($states -notcontains "warming") { $h }
} 300 "the fields to finish warming up"
foreach ($f in $health.fields.PSObject.Properties) { Write-Host ("  {0}: {1}" -f $f.Name, $f.Value) }
Write-Host "Model: $($health.model)"
Write-Host ""
Write-Host "FarmLine engine is live at $Url. Keep this laptop plugged in, awake and online."
Write-Host "Stop it with: powershell -ExecutionPolicy Bypass -File engine\start-local.ps1 -Stop"
