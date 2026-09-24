# Linux 部署指南

在 Linux 上只运行 **服务器和 agent**，不运行原生 Minecraft 客户端。因此不需要显示环境、Xvfb 或 ffmpeg。

agent 会把原生视图镜像（mirror）开放在 `0.0.0.0:25578`。Windows 运行原生客户端连接这个端口，并在 Windows 本机提供 WebRTC 画面，Windows 端的步骤见 [deploy-windows.md](deploy-windows.md) 的方案 B。

```
Linux:   server:25565  <-  agent (mineflayer)  --mirror-->  0.0.0.0:25578
                                                              | Minecraft 协议 (TCP)
Windows: start-native.ps1 -> 原生 1.16.5 客户端 ---------------+
                              +- WebRTC -> 浏览器 http://127.0.0.1:25590/
```

## 1. 环境要求

| 软件 | 说明 |
|---|---|
| Java 17 | 运行服务器需要；JRE 就够，只有编译 observer 时才需要 JDK |
| Node.js 18+ | 运行 agent |
| 编译工具 | `npm install` 会编译 `canvas` |
| Git | 克隆仓库 |

Debian / Ubuntu 可以这样安装：

```sh
sudo apt update
sudo apt install -y openjdk-17-jdk git curl build-essential \
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
# Node.js 18+：使用 NodeSource 或 nvm，例如
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
```

## 2. 获取代码并安装依赖

```sh
git clone https://github.com/XiangZheng2283/minecraft-agent.git
cd minecraft-agent
npm install
export MC_JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64   # 可选，不设置时使用 PATH 里的 java
```

## 3. 准备服务器

1. 把官方 1.16.5 `server.jar` 放到 `server/server.jar`。
2. 第一次执行 `./start-server.sh` 会生成 `server/eula.txt`，把它改成 `eula=true` 后再启动一次。
3. 修改 `server/server.properties`：必须设置 `online-mode=false`，因为 agent 使用离线账号；端口使用 `server-port`，默认 25565。
4. 可选：执行 `./build-observer.sh` 编译龙战观察器（需要 JDK）。`start-server.sh` 只在 `observer/dragon-observer.jar` 存在时才挂载它，普通 helper 用不到。

## 4. 启动

开两个终端（或使用 tmux / screen）：

```sh
# 终端 1：服务器
./start-server.sh

# 终端 2：agent，默认启动 helper，也可以传其他 agent 名
CPA_API_KEY=... TYPE_SAFE_API_KEY=... ./start-agent.sh
```

启动后的日志顺序：

1. `Native mirror listening on 0.0.0.0:25578 (remote client, 20000 ms resource delay)`：mirror 已开放。
2. `Waiting for the native client to load and join before acting`：agent 进服后在等客户端，这时不会行动。
3. Windows 执行 `start-native.ps1 -MirrorHost <本机 IP>` 后，依次出现 `Native display connected from <Windows IP>` 和 `Native read-only viewer ready`，然后 agent 开始行动。

客户端断开时，agent 会自动暂停（日志记录 `native_lost` 事件）；客户端重连并就绪后，agent 自动恢复。如果希望不连客户端也能直接跑，启动时加上 `WAIT_NATIVE=0`：

```sh
WAIT_NATIVE=0 CPA_API_KEY=... TYPE_SAFE_API_KEY=... ./start-agent.sh
```

如果完全不要画面，改用 `NATIVE_VIEW=0`。

## 5. 防火墙

mirror 端口没有鉴权，同一时间只能有一个客户端连接。请只放行 Windows 的 IP：

```sh
# ufw
sudo ufw allow from <Windows IP> to any port 25578 proto tcp
# firewalld
sudo firewall-cmd --permanent --add-rich-rule='rule family=ipv4 source address=<Windows IP> port port=25578 protocol=tcp accept' && sudo firewall-cmd --reload
```

agent 的 HTTP API（`agents/*/agent.json` 里的 `api.port`，helper 为 3101）只监听 127.0.0.1，不需要对外开放。

## 6. 常用变量

| 变量 | `start-agent.sh` 默认值 | 作用 |
|---|---|---|
| `NATIVE_VIEW` | `1` | 开启原生视图镜像 |
| `NATIVE_MIRROR_HOST` | `0.0.0.0` | mirror 监听地址 |
| `NATIVE_MIRROR_PORT` | `25578` | mirror 端口 |
| `NATIVE_MIRROR_REMOTE` | `1` | 客户端在另一台机器上：不读本地的 resources-ready 文件，改为按固定延时判断客户端资源已加载 |
| `NATIVE_MIRROR_READY_DELAY_MS` | `20000` | 客户端登录后等待资源加载的时间；画面缺区块时调大 |
| `NATIVE_MIRROR_BOT` | 第一个 agent 名 | 只镜像这个 agent |
| `WAIT_NATIVE` | 开启 | 设为 `0` 时 agent 不等客户端 |
| `MC_PORT` | `25565` | 游戏服务器端口 |
| `HELPER_USERNAME` / `HELPER_OWNER` | `test_bot_1` / `command2283` | bot 名称和主人（主人可以在聊天里给 bot 下指令） |
| `HTTP_PROXY` / `HTTPS_PROXY` | 不设置 | 访问模型 API 需要代理时，在外部设置 |

## 7. 限制

- 远程模式下，客户端机器上的文件在 Linux 上读不到，所以不支持 `NATIVE_RECORD` 录屏，也不支持 speedrun 的录制健康检查。这些功能需要在 Windows 单机上运行。
- 只能镜像一个 bot。

## 8. 排错

| 现象 | 处理 |
|---|---|
| `npm install` 编译 canvas 失败 | 安装第 1 节列出的 `lib*-dev` 包 |
| Windows 连不上 25578 | 在 Linux 上执行 `ss -lnt \| grep 25578`，确认监听的是 `0.0.0.0`；检查防火墙和云服务器安全组 |
| 一直停在 `Waiting for the native client...` | Windows 客户端还没连上；如果只是测试，可以先用 `WAIT_NATIVE=0` |
| `Native resources failed to load` | 客户端在等待时间内没有就绪，检查 Windows 端客户端窗口的输出 |
| bot 进服被踢 | 检查 `online-mode=false`，以及用户名是否是 3 到 16 位字母、数字或下划线 |
