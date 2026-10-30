$ErrorActionPreference='Stop'
$null=Invoke-RestMethod http://127.0.0.1:17789/api/run/pause -Method Post
for($i=0;$i -lt 30;$i++){
 $s=Invoke-RestMethod http://127.0.0.1:17789/api/status
 if($s.loop.phase.state -eq 'idle'){break}
 Start-Sleep -Milliseconds 500
}
if($s.loop.phase.state -ne 'idle'){throw 'Still working; left paused. Do not snapshot or force-kill.'}
$null=Invoke-RestMethod http://127.0.0.1:17789/api/run/shutdown -Method Post
for($i=0;$i -lt 30;$i++){
 $r=Get-Content 'C:/Users/USER/PersonalAgentRuntime/whale-v1/runtime.json' -Raw | ConvertFrom-Json
 $listener=Get-NetTCPConnection -LocalPort 17789 -State Listen -ErrorAction SilentlyContinue
 if($r.state -eq 'stopped' -and -not $listener){Write-Output 'Whale stopped and listener released.';exit 0}
 Start-Sleep -Milliseconds 500
}
throw 'Shutdown not yet confirmed; do not snapshot or start a second instance.'
