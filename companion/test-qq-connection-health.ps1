$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'qq-connection-health.ps1')
foreach($case in @(
 @{status='active';lamps=@(@{state='online'},@{state='offline'});expected=$true},
 @{status='active';lamps=@(@{state='error'},@{state='online'});expected=$false},
 @{status='active';lamps=@();expected=$false},
 @{status='inactive';lamps=@(@{state='online'});expected=$false}
)){
 $worlds=[pscustomobject]@{worlds=@([pscustomobject]@{id='qq';status=$case.status;lamps=$case.lamps})}
 if((Test-WhaleQQConnected $worlds) -ne $case.expected){throw 'QQ module/protocol distinction failed'}
}
Write-Output 'PASS actual protocol online required; active module with roster-only online, missing protocol and inactive module all refuse readiness'
