# The pinned QQ plugin's first lamp is the protocol link; the roster lamp is
# independent and may remain online while the bridge is disconnected.
function Test-WhaleQQConnected($Worlds) {
 $qq=@($Worlds.worlds | Where-Object id -eq 'qq')
 return [bool]($qq.Count -eq 1 -and $qq[0].status -eq 'active' -and @($qq[0].lamps).Count -ge 1 -and $qq[0].lamps[0].state -eq 'online')
}
