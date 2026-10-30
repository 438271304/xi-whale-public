$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'qq-connection-health.ps1')
$project='C:\Users\USER\.codex\.chatgpt-projects\g-p-6ac88a31ea188191a55f85ec633baa7c'
$port=Get-NetTCPConnection -LocalPort 17789 -State Listen -ErrorAction SilentlyContinue
if($port){throw 'Whale port already in use; inspect existing instance first'}
Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList 'companion/run-whale.mjs' -WorkingDirectory $project -WindowStyle Hidden
for($attempt=0;$attempt -lt 240;$attempt++){
 Start-Sleep -Milliseconds 500
 try{
  $receipt=Get-Content 'C:\Users\USER\PersonalAgentRuntime\whale-v1\runtime.json' -Raw | ConvertFrom-Json
  if($receipt.state -ne 'ready-paused'){continue}
  $listener=Get-NetTCPConnection -LocalPort 17789 -State Listen -ErrorAction SilentlyContinue
  if(-not $listener -or $listener.OwningProcess -ne $receipt.pid){continue}
  $worlds=Invoke-RestMethod http://127.0.0.1:17789/api/worlds
  if(-not (Test-WhaleQQConnected $worlds)){throw 'QQ protocol link not connected; remains paused'}
  $statusSnapshot=Invoke-RestMethod http://127.0.0.1:17789/api/status
  if($statusSnapshot.PSObject.Properties.Name -contains 'qq_route' -and $statusSnapshot.qq_route.ready -ne $true){throw 'QQ conversation route not ready; remains paused'}
  if($receipt.keyMissing){throw 'Provider key unavailable; remains paused'}
  $null=Invoke-RestMethod http://127.0.0.1:17789/api/run/resume -Method Post
  Write-Output 'Whale started and resumed.';exit 0
 }catch{if($attempt -eq 239){throw}}
}
throw 'Whale did not become ready; inspect runtime.log; no automatic retry'
