$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not $env:MC_JAVA_HOME) { throw 'Set MC_JAVA_HOME to a Java 17 JDK' }
if (-not (Test-Path observer/javassist.jar)) {
  Invoke-WebRequest 'https://repo.maven.apache.org/maven2/org/javassist/javassist/3.30.2-GA/javassist-3.30.2-GA.jar' -OutFile observer/javassist.jar
}
& "$env:MC_JAVA_HOME\bin\javac.exe" -cp observer/javassist.jar observer/DragonObserver.java
if ($LASTEXITCODE) { exit $LASTEXITCODE }
& "$env:MC_JAVA_HOME\bin\jar.exe" cfm observer/dragon-observer.jar observer/MANIFEST.MF -C observer DragonObserver.class -C observer 'DragonObserver$1.class'
exit $LASTEXITCODE
