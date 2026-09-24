#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
: "${MC_JAVA_HOME:?Set MC_JAVA_HOME to a Java 17 JDK}"
SEP=:; case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) SEP=";";; esac
"$MC_JAVA_HOME/bin/javac" --release 17 -cp "observer/javassist.jar$SEP$(cat native-client/classpath.txt)" -d native-client/classes native-client/*.java
"$MC_JAVA_HOME/bin/jar" cfm native-client/native-view-agent.jar native-client/MANIFEST.MF -C native-client/classes .
