$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (-not $env:MC_JAVA_HOME) { throw 'Set MC_JAVA_HOME to a Java 17 JDK' }
$classpath = 'observer/javassist.jar;' + (Get-Content native-client/classpath.txt -Raw -Encoding UTF8).Trim()
& "$env:MC_JAVA_HOME\bin\javac.exe" --release 17 -cp $classpath -d native-client/classes (Get-ChildItem native-client/*.java).FullName
if ($LASTEXITCODE) { exit $LASTEXITCODE }
& "$env:MC_JAVA_HOME\bin\jar.exe" cfm native-client/native-view-agent.jar native-client/MANIFEST.MF -C native-client/classes .
exit $LASTEXITCODE
