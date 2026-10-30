$ErrorActionPreference='Stop';$root='D:/Deepseek'
if(-not (Test-Path "$root/processes.json")){Write-Output 'No DSH start receipt';exit 0}
$state=Get-Content "$root/processes.json" -Raw | ConvertFrom-Json
foreach($id in @($state.web_pid,$state.guard_pid)){
 $process=Get-CimInstance Win32_Process -Filter "ProcessId = $id"
 if(-not $process){continue}
 if($process.CommandLine -notmatch 'D:[/\\]Deepseek[/\\]'){throw 'PID no longer belongs to this DSH installation; not stopped'}
 Stop-Process -Id $id
}
Move-Item -LiteralPath "$root/processes.json" -Destination "$root/logs/stopped-$((Get-Date).ToString('yyyyMMdd-HHmmss')).json"
Write-Output 'DSH stopped; data and installed packages retained'
