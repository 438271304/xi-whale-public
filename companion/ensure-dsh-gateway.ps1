$ErrorActionPreference='Stop'
function GatewayReady {
 try{$h=Invoke-RestMethod 'http://127.0.0.1:3091/health' -TimeoutSec 2;return ($h.status -eq 'ready' -and $h.daily_cap_cny -eq 1 -and $h.model -eq 'deepseek-flash' -and $h.max_output_tokens -eq 1024)}catch{return $false}
}
if(GatewayReady){Write-Output 'Existing independent 1 CNY DSH gateway ready';exit 0}
if(Get-NetTCPConnection -LocalPort 3091 -State Listen -ErrorAction SilentlyContinue){throw 'Gateway port occupied by unverified service; no second start'}
# Original stop validates every recorded PID before stopping; never kill an unrelated reused PID.
if(Test-Path -LiteralPath D:/Deepseek/processes.json){& D:/Deepseek/Stop-DSH.ps1;if(-not $?){throw 'Prior DSH receipt needs inspection'}}
try{& D:/Deepseek/Start-DSH.ps1}catch{if(-not (GatewayReady)){throw}}
if(-not (GatewayReady)){throw 'Independent DSH gateway unavailable; no direct-provider fallback'}
Write-Output 'Independent DSH gateway restored; original budget and credentials unchanged'
