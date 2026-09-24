#!/bin/sh
# Linux 版 start-agent.ps1：启动 agent，并把原生视图镜像（mirror）对外开放在 0.0.0.0:25578。
# Windows 上运行 start-native.ps1 连接它，由 Windows 的原生客户端提供 WebRTC 画面。
# Linux 端不需要 Java 客户端、显示或 ffmpeg。
# 用法：CPA_API_KEY=... TYPE_SAFE_API_KEY=... ./start-agent.sh [agent 名称...]
set -eu
cd "$(dirname "$0")"

export PLANNER_BASE_URL="${PLANNER_BASE_URL:-https://www.xzaiweb.cn}"
export PLANNER_API_KEY="${PLANNER_API_KEY:-${CPA_API_KEY:-}}"
export PLANNER_MODEL="${PLANNER_MODEL:-gpt-6-luna}"

export REVIEWER_BASE_URL="${REVIEWER_BASE_URL:-https://www.xzaiweb.cn}"
export REVIEWER_API_KEY="${REVIEWER_API_KEY:-${CPA_API_KEY:-}}"
export REVIEWER_MODEL="${REVIEWER_MODEL:-gpt-6-luna}"

export DECISION_BASE_URL="${DECISION_BASE_URL:-https://api.typesafe.ai}"
export DECISION_API_KEY="${DECISION_API_KEY:-${TYPE_SAFE_API_KEY:-}}"
export DECISION_MODEL="${DECISION_MODEL:-jev-latest}"

# 需要代理时在外部设置 HTTP_PROXY / HTTPS_PROXY；这里只补默认的 NO_PROXY。
export NO_PROXY="${NO_PROXY:-*.xzaiweb.cn,localhost,127.0.0.1,::1}"
export MC_PORT="${MC_PORT:-25565}"

export HELPER_OWNER="${HELPER_OWNER:-command2283}"
export HELPER_USERNAME="${HELPER_USERNAME:-${MC_USERNAME:-test_bot_1}}"
export RUN_ID="${RUN_ID:-test_bot_2}"

# export DRAGON_SENSOR_URL='http://127.0.0.1:3093'
[ "$#" -gt 0 ] || set -- helper

# 原生视图：mirror 对外监听，客户端在 Windows 上。只镜像一个 bot，默认第一个 agent。
export NATIVE_VIEW="${NATIVE_VIEW:-1}"
# 默认不录屏（不需要 ffmpeg）。远程模式本来也不支持录屏。
export NATIVE_RECORD=0
export NATIVE_MIRROR_HOST="${NATIVE_MIRROR_HOST:-0.0.0.0}"
export NATIVE_MIRROR_PORT="${NATIVE_MIRROR_PORT:-25578}"
export NATIVE_MIRROR_REMOTE="${NATIVE_MIRROR_REMOTE:-1}"
export NATIVE_MIRROR_BOT="${NATIVE_MIRROR_BOT:-$1}"

exec node run-agent.mjs "$@"
