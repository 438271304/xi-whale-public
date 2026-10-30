$ErrorActionPreference='Stop'
if(Get-NetTCPConnection -LocalPort 17790 -State Listen -ErrorAction SilentlyContinue){Write-Output 'Port 17790 already in use; no second server started.';exit 0}
Start-Process -FilePath 'C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -ArgumentList '-X','utf8','server.py' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput "$PSScriptRoot/server.log" -RedirectStandardError "$PSScriptRoot/server-error.log"
Write-Output 'Home starting at http://127.0.0.1:17790 ; no automatic startup registration.'
