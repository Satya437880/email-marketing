# Starts everything the app needs and makes it reachable from the internet through the permanent Vercel address.
#
# What it does (safe to run again: anything already running is left alone):
#   1. starts Redis (Memurai), the API, the website (for local use) and the workers
#   2. opens a Cloudflare tunnel to the API (its address changes every time it starts)
#   3. if the tunnel address changed, writes it into apps/web/vercel.json, commits and pushes, so Vercel forwards to the new address
#
# The permanent address people use is the Vercel one (https://email-marketings.vercel.app). The computer must stay on.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$logs = Join-Path $root ".logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"

function Test-Port($port) { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
function Say($msg) { Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg) }

# 1. Redis (the queue)
if (-not (Test-Port 6379)) {
  Say "Starting Redis (Memurai)..."
  Start-Process -WindowStyle Hidden -FilePath "C:\Program Files\Memurai\memurai.exe" -ArgumentList "memurai.conf" -WorkingDirectory (Join-Path $root ".memurai")
  Start-Sleep -Seconds 3
} else { Say "Redis already running." }

# The API (the server)
if (-not (Test-Port 4000)) {
  Say "Starting the API..."
  Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList ('"' + (Join-Path $root "node_modules\tsx\dist\cli.mjs") + '"'), "src\server.ts" -WorkingDirectory (Join-Path $root "apps\api") `
    -RedirectStandardOutput (Join-Path $logs "api.out.log") -RedirectStandardError (Join-Path $logs "api.err.log")
  for ($i = 0; $i -lt 30 -and -not (Test-Port 4000); $i++) { Start-Sleep -Seconds 1 }
} else { Say "API already running." }

# The website for use on this computer (localhost:5173)
if (-not (Test-Port 5173)) {
  Say "Starting the website for local use..."
  Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "node_modules\vite\bin\vite.js" -WorkingDirectory (Join-Path $root "apps\web") `
    -RedirectStandardOutput (Join-Path $logs "web.out.log") -RedirectStandardError (Join-Path $logs "web.err.log")
} else { Say "Website already running." }

# The workers (sending and reading replies)
$workers = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match "worker\.js|apps.workers" }
if (-not $workers) {
  Say "Starting the workers..."
  Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "worker.js" -WorkingDirectory $root `
    -RedirectStandardOutput (Join-Path $logs "workers.out.log") -RedirectStandardError (Join-Path $logs "workers.err.log")
} else { Say "Workers already running." }

# 2. The tunnel to the API (always restarted, so we know its log and address)
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
$tunnelLog = Join-Path $logs "tunnel.err.log"
Remove-Item $tunnelLog -ErrorAction SilentlyContinue
Say "Opening the tunnel..."
Start-Process -WindowStyle Hidden -FilePath $cloudflared -ArgumentList "tunnel", "--url", "http://localhost:4000" `
  -RedirectStandardOutput (Join-Path $logs "tunnel.out.log") -RedirectStandardError $tunnelLog
$url = $null
for ($i = 0; $i -lt 40 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $tunnelLog) { $m = Select-String -Path $tunnelLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1; if ($m) { $url = $m.Matches[0].Value } }
}
if (-not $url) { Say "The tunnel did not give an address. Check .logs\tunnel.err.log"; exit 1 }
Say "Tunnel address: $url"

# 3. Tell Vercel's forwarding rules about it
$file = Join-Path $root "apps\web\vercel.json"
$text = [IO.File]::ReadAllText($file)
if ($text -notmatch [regex]::Escape($url)) {
  [IO.File]::WriteAllText($file, [regex]::Replace($text, "https://[a-z0-9-]+\.trycloudflare\.com", $url))
  # git writes progress to stderr, which PowerShell treats as an error, so run it through cmd and check the exit code instead.
  cmd /c 'git add apps/web/vercel.json >nul 2>&1'
  cmd /c 'git commit -q -m "Update the API tunnel address" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" >nul 2>&1'
  cmd /c 'git push origin master >nul 2>&1'
  if ($LASTEXITCODE -eq 0) { Say "vercel.json updated and pushed. Vercel needs about a minute to publish it." }
  else { Say "WARNING: the push to GitHub failed, so Vercel will not see the new address. Run 'git push origin master' in this folder and check your internet and GitHub login." }
} else { Say "vercel.json already points to this address." }

Say "Done. Share this address: https://email-marketings.vercel.app"
