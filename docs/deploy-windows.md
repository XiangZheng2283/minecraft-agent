# Windows 部署指南

Windows 有两种用法：

- **方案 A，单机**：服务器、agent、原生客户端都在这台 Windows 上。
- **方案 B，只看画面**：服务器和 agent 在 Linux 上（见 [deploy-linux.md](deploy-linux.md)），Windows 只运行原生客户端，提供 WebRTC 画面。

两种方案都只在本机打开 `http://127.0.0.1:25590/` 看画面。

## 1. 环境要求

| 软件 | 说明 |
|---|---|
| Windows 10/11 x64 | 需要能跑 OpenGL 的显卡驱动 |
| Java 17 JDK | 需要 JDK，只有 JRE 不行，因为编译要用 `javac` 和 `jar`。例如 `winget install EclipseAdoptium.Temurin.17.JDK` |
| Node.js 18+ | 方案 A 需要；方案 B 只在跑测试时需要 |
| Python 3 | 用于 `install.py` / `launch.py` |
| Git | 克隆仓库 |
| ffmpeg | 只有录屏（`NATIVE_RECORD=1`）时需要，例如 `winget install Gyan.FFmpeg` |

## 2. 获取代码

```powershell
git clone https://github.com/XiangZheng2283/minecraft-agent.git
cd minecraft-agent
```

## 3. 设置 Java 路径

```powershell
$env:MC_JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-17'   # 换成你的 JDK 目录
$env:MINECRAFT_DIR = 'D:\Games\.minecraft'                        # 可选：复用已下载的游戏资源，能省下约 300 MB 下载
```

注意：`start-agent.ps1`、`start-server.ps1`、`start-native.ps1` 里写了作者本机的默认路径（`D:\java\jdk17`），请改成你自己的路径，或者每次运行前先设置好环境变量。

## 4. 一次性安装原生客户端（方案 A 和 B 都要做）

```powershell
.\build-observer.ps1                 # 下载 observer/javassist.jar，编译服务器观察器（客户端编译也要用 javassist）
python native-client\install.py      # 下载 1.16.5 客户端、库、natives、webrtc-java 和游戏资源
.\native-client\build.ps1            # 编译 native-client\native-view-agent.jar
```

上面这些命令的产物都在 .gitignore 里，不会提交。换一台机器要重新执行一遍。

## 5A. 方案 A：单机运行

1. 放入官方 1.16.5 `server.jar`，路径为 `server\server.jar`。第一次启动服务器后要把 `server\eula.txt` 改成 `eula=true`。`online-mode=false` 才能使用离线账号。
2. 安装 Node 依赖：

   ```powershell
   npm install
   ```

3. 开三个 PowerShell 窗口，按顺序执行：

   ```powershell
   # 窗口 1：服务器
   .\start-server.ps1

   # 窗口 2：agent（需要模型 key）
   $env:CPA_API_KEY = '...'
   $env:TYPE_SAFE_API_KEY = '...'
   .\start-agent.ps1

   # 窗口 3：原生客户端
   .\start-native.ps1
   ```

4. 窗口 2 出现 `Native read-only viewer ready` 后，agent 才开始行动。之后在浏览器打开 `http://127.0.0.1:25590/`。

`start-agent.ps1` 里默认 `NATIVE_VIEW=1`，并且设置了代理 `HTTP_PROXY=http://127.0.0.1:7890`。如果你不用代理，把这一行删掉。

## 5B. 方案 B：连接 Linux 上的 agent

前提是 Linux 端已经按 [deploy-linux.md](deploy-linux.md) 启动，日志里有 `Native mirror listening on 0.0.0.0:25578`。

```powershell
Test-NetConnection <Linux IP> -Port 25578   # TcpTestSucceeded 应为 True
.\start-native.ps1 -MirrorHost <Linux IP>
```

Linux 端日志出现 `Native read-only viewer ready` 后，在 Windows 浏览器打开 `http://127.0.0.1:25590/`。

## 6. 常用变量

| 变量 | 默认值 | 作用 |
|---|---|---|
| `NATIVE_MIRROR_HOST` | `127.0.0.1` | 客户端要连接的 mirror 地址（方案 B 填 Linux IP） |
| `NATIVE_MIRROR_PORT` | `25578` | mirror 端口 |
| `NATIVE_WEBRTC_PORT` | `25590` | WebRTC 画面端口，设为 `0` 表示关闭 |
| `WAIT_NATIVE` | 开启 | agent 等客户端就绪后才行动；设为 `0` 表示不等待 |
| `NATIVE_MIRROR_BOT` | 全部 | 同时有多个 agent 时，指定镜像哪一个 |

## 7. 排错

| 现象 | 处理 |
|---|---|
| `Java not found` | 检查 `MC_JAVA_HOME` 是否指向 JDK 17 |
| `build.ps1` 报找不到 javassist | 先执行 `.\build-observer.ps1` |
| agent 一直停在 `Waiting for the native client...` | 客户端没启动或没连上：检查 `start-native.ps1` 窗口的输出，方案 B 还要检查 Linux 防火墙是否放行了 25578 |
| `Native viewer: read ECONNRESET` | 客户端崩溃或被关掉了。agent 会自动暂停，重新执行 `start-native.ps1` 后会自动恢复。请看客户端窗口里的异常信息 |
| 画面缺区块（方案 B） | 在 Linux 端调大 `NATIVE_MIRROR_READY_DELAY_MS`，例如 `40000` |
| 页面提示 WebRTC is disabled | 浏览器策略或扩展禁用了 WebRTC，换一个浏览器 |
