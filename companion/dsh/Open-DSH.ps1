$ErrorActionPreference='Stop'
$log='D:/Deepseek/logs/web-out.log'
if(-not (Test-Path $log)){throw 'Run Start-DSH.ps1 first'}
for($i=0;$i -lt 20;$i++){$line=(Get-Content $log | Select-String 'dsh web: http://127.0.0.1:3080/' | Select-Object -Last 1).Line;if($line){break};Start-Sleep -Milliseconds 250}
if(-not $line){throw 'No local authenticated DSH entry found; inspect startup logs'}
$url=$line.Substring($line.IndexOf('http://'));$uri=[uri]$url
if($uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1' -or $uri.Port -ne 3080){throw 'Unexpected DSH entry address'}
Start-Process -FilePath $url
Write-Output 'Opened the authenticated local DSH page; token not printed'
