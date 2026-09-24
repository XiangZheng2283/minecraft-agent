$env:MC_JAVA_HOME='D:\java\jdk17'
$env:MINECRAFT_DIR='D:\GAME\PCL2\.minecraft'
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not $env:MC_JAVA_HOME) { throw 'Set MC_JAVA_HOME to a Java 17 installation' }
Set-Location server
& "$env:MC_JAVA_HOME\bin\java.exe" '-javaagent:../observer/dragon-observer.jar=3093' -Xms512M -Xmx2G -jar server.jar nogui
exit $LASTEXITCODE
