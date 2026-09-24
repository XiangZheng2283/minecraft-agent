# Windows: start the hidden native 1.16.5 client against an agent mirror, usually on the Linux host.
# The client serves the WebRTC live view at http://127.0.0.1:25590/ on this machine.
# Usage: .\start-native.ps1 -MirrorHost 192.168.1.10
# One-time setup: python native-client\install.py ; .\native-client\build.ps1
param(
  [string]$MirrorHost = $(if ($env:NATIVE_MIRROR_HOST) { $env:NATIVE_MIRROR_HOST } else { '127.0.0.1' }),
  [string]$MirrorPort = $(if ($env:NATIVE_MIRROR_PORT) { $env:NATIVE_MIRROR_PORT } else { '25578' })
)
if (-not $env:MC_JAVA_HOME) { $env:MC_JAVA_HOME = 'D:\java\jdk17' }
$env:NATIVE_MIRROR_HOST = $MirrorHost
$env:NATIVE_MIRROR_PORT = $MirrorPort
python "$PSScriptRoot\native-client\launch.py"
exit $LASTEXITCODE
