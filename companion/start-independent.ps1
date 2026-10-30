param([switch]$ShowHome)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'qq-connection-health.ps1')
$project=Split-Path $PSScriptRoot -Parent
$runtime='C:/Users/USER/PersonalAgentRuntime/whale-v1'
$mutex=New-Object System.Threading.Mutex($false,'Local\PersonalAgentWhaleIndependent')
if(-not $mutex.WaitOne(0)){exit 0}
function Save-State($state,$detail){
 @{at=[DateTimeOffset]::Now.ToString('o');state=$state;detail=$detail;pid=$PID} | ConvertTo-Json | Set-Content "$runtime/independent-start.json" -Encoding UTF8
}
function Listening($port){return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)}
try {
 Set-Location $project
 Save-State 'starting' 'Windows task owns launcher; no Codex API used.'
 if(-not (Listening 17790)){
  Start-Process -FilePath 'C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -ArgumentList '-X','utf8','server.py' -WorkingDirectory "$PSScriptRoot/home" -WindowStyle Hidden -RedirectStandardOutput "$runtime/home.log" -RedirectStandardError "$runtime/home-error.log"
 }
 $bridge=Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq 'D:\SnowLuma-v2.1.1-win-x64\node.exe'}
 try{& (Join-Path $PSScriptRoot 'ensure-dsh-gateway.ps1')}catch{Write-Warning 'Independent DSH gateway unavailable; QQ startup continues without DSH'}
 if(-not $bridge){
  Start-Process -FilePath 'D:/SnowLuma-v2.1.1-win-x64/node.exe' -ArgumentList 'index.mjs' -WorkingDirectory 'D:/SnowLuma-v2.1.1-win-x64' -WindowStyle Hidden -RedirectStandardOutput "$runtime/bridge.log" -RedirectStandardError "$runtime/bridge-error.log"
 }
 if($ShowHome){Start-Process 'http://127.0.0.1:17790/'}
 # Only wait for the existing authorized bridge; do not enable injection for other QQ accounts.
 while(-not (Listening 3001)){
  Save-State 'waiting_for_qq' 'Open http://127.0.0.1:5099/ and restore the existing QQ connection.'
  Start-Sleep -Seconds 30
 }
 if(-not (Listening 17789)){
  $shell=(Get-Process -Id $PID).Path
  $starter=Start-Process -FilePath $shell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSScriptRoot+'/start-whale.ps1"') -WindowStyle Hidden -PassThru -RedirectStandardOutput "$runtime/start.log" -RedirectStandardError "$runtime/start-error.log"
  $starter.WaitForExit()
  $starter.Refresh()
  # Some Windows PowerShell Process wrappers lose ExitCode after exit; verify live readiness.
  $health=Invoke-RestMethod 'http://127.0.0.1:17789/api/status'
  $worldState=Invoke-RestMethod 'http://127.0.0.1:17789/api/worlds'
  if($health.loop.paused -ne $false -or -not (Test-WhaleQQConnected $worldState)){throw 'Core or QQ protocol link not ready; see start-error.log. No repeated launch.'}
 }
 Save-State 'running' 'Core and home started independently. No automatic resume after intentional pause.'
 # Keep the task host alive. Do not restart a core deliberately stopped for maintenance.
 while(Listening 17789){Start-Sleep -Seconds 30}
 Save-State 'core_stopped' 'Core stopped; use the desktop start shortcut to restart after maintenance.'
} catch {Save-State 'failed' $_.Exception.Message; throw}
finally {$mutex.ReleaseMutex();$mutex.Dispose()}
