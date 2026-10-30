$ErrorActionPreference='Stop'
$root='D:/Deepseek'
$node='C:/Program Files/nodejs/node.exe'
if(Test-Path "$root/processes.json"){
 $prior=Get-Content "$root/processes.json" -Raw | ConvertFrom-Json
 $webListening=Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
 $guardListening=Get-NetTCPConnection -LocalPort 3091 -State Listen -ErrorAction SilentlyContinue
 if($webListening.OwningProcess -contains $prior.web_pid -and $guardListening.OwningProcess -contains $prior.guard_pid){Write-Output 'DSH is already running; no duplicate started';exit 0}
 throw 'A stale or incomplete start receipt exists. Inspect or run Stop-DSH.ps1 before restarting.'
}
foreach($port in @(3080,3091)){if(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue){throw "Port $port is occupied; no duplicate start"}}
$savedHome=$env:DSH_HOME;$savedKey=$env:DEEPSEEK_API_KEY;$savedBase=$env:DEEPSEEK_BASE_URL
try{
 $env:DSH_HOME="$root/data";$env:DEEPSEEK_API_KEY=(Get-Content "$root/data/proxy-token" -Raw).Trim();$env:DEEPSEEK_BASE_URL='http://127.0.0.1:3091'
 $guard=Start-Process -FilePath $node -ArgumentList @("$root/budget-proxy.mjs") -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput "$root/logs/guard-out.log" -RedirectStandardError "$root/logs/guard-error.log"
 $ready=$false
 for($i=0;$i -lt 30;$i++){Start-Sleep -Milliseconds 500;try{$health=Invoke-RestMethod 'http://127.0.0.1:3091/health' -TimeoutSec 1;if($health.status -eq 'ready'){$ready=$true;break}}catch{}}
 if(-not $ready){throw 'Budget guard did not become ready; inspect local logs without sharing secrets'}
 $web=Start-Process -FilePath $node -ArgumentList @("$root/app/node_modules/@deepseek-ai/dsh/lib/bin.js",'web','--host','127.0.0.1','--port','3080','--no-open') -WorkingDirectory "$root/projects" -WindowStyle Hidden -PassThru -RedirectStandardOutput "$root/logs/web-out.log" -RedirectStandardError "$root/logs/web-error.log"
 [ordered]@{at=(Get-Date -Format o);guard_pid=$guard.Id;web_pid=$web.Id;version='0.2.1-rc.2';url='http://127.0.0.1:3080'} | ConvertTo-Json | Set-Content "$root/processes.json" -Encoding utf8
 $webReady=$false
 for($i=0;$i -lt 40;$i++){
  Start-Sleep -Milliseconds 500
  $line=(Get-Content "$root/logs/web-out.log" -ErrorAction SilentlyContinue | Select-String 'dsh web: http://127.0.0.1:3080/' | Select-Object -Last 1).Line
  if($line){try{$r=Invoke-WebRequest $line.Substring($line.IndexOf('http://')) -TimeoutSec 2;if($r.StatusCode -eq 200){$webReady=$true;break}}catch{}}
  if($web.HasExited){break}
 }
 if(-not $webReady){throw 'DSH Web not ready; inspect receipt/logs before restarting'}
 Write-Output 'DSH started: http://127.0.0.1:3080 (loopback only; separate daily cap 1 CNY)'
}finally{$env:DSH_HOME=$savedHome;$env:DEEPSEEK_API_KEY=$savedKey;$env:DEEPSEEK_BASE_URL=$savedBase}
