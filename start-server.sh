#!/bin/sh
# 启动 1.16.5 服务器（Linux / macOS / Git Bash）。
# MC_JAVA_HOME 指向 Java 17；未设置时使用 PATH 里的 java。
# 服务器端口见 server/server.properties（server-port，默认 25565）。
set -eu
cd "$(dirname "$0")"
if [ -n "${MC_JAVA_HOME:-}" ]; then JAVA="$MC_JAVA_HOME/bin/java"; else JAVA="$(command -v java || true)"; fi
[ -n "$JAVA" ] && [ -x "$JAVA" ] || { echo "找不到 java：请设置 MC_JAVA_HOME 为 Java 17 安装目录" >&2; exit 1; }
[ -f server/server.jar ] || { echo "缺少 server/server.jar（1.16.5 服务端），请先放入 server/ 目录" >&2; exit 1; }
cd server
# 观察器 jar 存在时才挂载（为 DRAGON_SENSOR_URL 提供 127.0.0.1:3093）
AGENT=""
[ -f ../observer/dragon-observer.jar ] && AGENT="-javaagent:../observer/dragon-observer.jar=3093"
exec "$JAVA" $AGENT -Xms512M -Xmx${MC_SERVER_XMX:-2G} -jar server.jar nogui
