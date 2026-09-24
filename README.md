# Astra and JEV Minecraft agent

This project uses GPT-6 Astra or GPT-5.6 Sol to plan and JEV to select player actions in Minecraft Java 1.16.5. It uses the official vanilla server and Mineflayer. A read-only Java sensor can report the exact dragon head position. It does not change game rules or entity state. Each selected action is sent to the game through the normal player protocol.

## Latest verified result

The latest run, `nether-final-08`, completed in **8 minutes 43.300 seconds**. The previous video took 14 minutes 31.800 seconds. The new run was 40% shorter. The End combat stage took 152 seconds instead of 332 seconds. Dragon flight and landing times can vary between runs.

The agent started with an empty inventory in a fresh Survival/Peaceful world. Astra planned and JEV selected the actions. It used the Nether for travel, killed the dragon with six bed explosions on the first landing, and reached the exit with full health and no deaths. There was no restart, source change, or operator repair during the run.

The run used 131 JEV decisions and 35 Astra calls. All 17 run checks, eight route/camera/screen checks, and 29 local tests passed. The full earlier video and action log were reviewed before the local tests and new recording.

Camera control uses continuous turns, with a limit of 240 degrees per second on each axis and acceleration of 960 degrees per second squared. A hidden native Minecraft client renders the game without desktop input. The capture includes health, hunger, hotbar, held items, inventory, crafting, and native animations.

The video is 960 × 540 at 20 frames per second, without audio. A translucent full-width top banner uses Menlo and shows the model names, elapsed time in milliseconds, XYZ coordinates, planner objective, and selected action. These labels use recorded responses and game events.

**Recordings and generated evidence remain local and are excluded from Git.** The local video is `runs/nether-final-08/full-playthrough-banner.mp4`. Its verification, timing comparison, and action log are in the same run directory. This repository contains the code, tests, build scripts, and route data. It does not include Minecraft binaries, downloaded runtimes, saved worlds, or credentials.

## Credentials and model endpoints

Keys are read from environment variables and kept in process memory. Do not place keys in source files or run logs.

| Variable | Default | Purpose |
|---|---|---|
| `PLANNER_BASE_URL` | `https://openrouter.ai/api` | Planner base URL; requests go to `{base}/v1/chat/completions` (OpenAI-compatible) |
| `PLANNER_API_KEY` | required | Planner bearer key |
| `PLANNER_MODEL` | `openai/gpt-6-astra` | Planner model ID |
| `DECISION_BASE_URL` | `https://api.typesafe.ai` | Action selector base URL; requests go to `{base}/v1/systemone` (TypeSafe System One API) |
| `DECISION_API_KEY` | falls back to `TYPESAFE_API_KEY` | Action selector bearer key |
| `DECISION_MODEL` | `jev-latest` | Action selector model ID, for example `jev-1.13.0` |
| `MODEL_RELAY` | unset | Optional, `http://127.0.0.1:3099` routes both calls through `node model-relay.mjs`, which adds a delayed backup request |

Run `node probe.mjs` to check both endpoints. Every endpoint setting also applies to the relay, so start the relay with the same variables.

The native renderer and launch scripts were first developed on macOS; see "Windows" below for the Windows setup. Historical review notes describe earlier versions; use the current code and the result above for the latest behavior.

## Game settings

- Seed: `8398967436125155523`
- Mode: Survival
- Difficulty: Peaceful for this recording
- Verified active End portal center: `-1130, 34, 856`
- Main server: `127.0.0.1:25576`
- Native display: hidden read-only Minecraft client
- Status: `http://127.0.0.1:3078`

The selected seed has a village, three supply chests with 21 obsidian, and a naturally active End portal. The route uses the Nether as a travel shortcut and requires entry and exit before combat. It does not need blaze rods. This is a useful speedrun seed, not proof of the easiest possible seed. The route was surveyed in a separate test world. Final-run placements and movement use normal player interactions.

## Model roles

The planner sets the current objective, item targets, and a travel waypoint. JEV selects one available action from current game observations. Actions include travel, mining one block, collecting a drop, crafting, opening a chest, eating, sleeping, and combat interactions. Mineflayer handles the movement path and game protocol. This is structured-state control, not control from screenshots or individual key presses. The models can see blocks in loaded chunks. Known seed coordinates are supplied.

Model IDs are configurable (see "Credentials and model endpoints"):

- Planner: `openai/gpt-6-astra` (default) or `openai/gpt-5.6-sol` (`PLANNER_MODEL`), through `{PLANNER_BASE_URL}/v1/chat/completions`
- Action selector: `jev-latest` by default (`DECISION_MODEL`), through `{DECISION_BASE_URL}/v1/systemone`. The recorded runs used `typesafe/jev-1.13` through OpenRouter's `/api/alpha/decisions`.

Keys are not written to run logs.

## Files and evidence

`runs/<run>/events.jsonl` stores the requests, model responses, selected actions, game results, and completion events. `status.json` stores current progress. A `victory.json` file requires dragon-death evidence and the exit-portal event. Death evidence is either the kill advancement or server-supplied zero health with the dragon dying phase. The Java 1.16.5 exit event uses numeric reason 4. Final review must also check the world DragonFight state and the video. Bed kills can omit the kill advancement.

New recordings use the official Minecraft Java 1.16.5 client. A read-only local protocol mirror sends the game state to this client. The video includes native entity models, textures, movement, digging and hand animations, the hotbar, held item, health, hunger, air, and dragon health. Capture is 960 × 540 at 20 frames per second, without audio. The window is hidden; focus and cursor control are disabled. Capture reads the game frame buffer, not the desktop. The older `recorded-06` video used Prismarine Viewer and a custom HUD.

The `combat-lab` directory is a separate test server. It can use prepared items and positions to test combat code. A combat-lab result does not qualify as a full Survival run.

## Start a run

Install dependencies with `npm install`. Start `server/server.jar` from the `server` directory with a compatible Java runtime. The installed Minecraft Java runtime works for this server.

Use `./start-server.sh` to start the main server with its read-only sensor. For a fresh recording, first choose an unused world name in `server/server.properties`. Use a new log directory with the same name. Start the agent from this directory:

```sh
node optimization/nether/freeze-run.mjs NEW_RUN
PLANNER_MODEL=openai/gpt-6-astra RUN_ID=NEW_RUN \
NATIVE_VIEW=1 WAIT_NATIVE=1 NATIVE_RECORD=1 \
DRAGON_SENSOR_URL=http://127.0.0.1:3093 node nether-agent.mjs
```

When the local mirror is listening on port 25578, start `python3 native-client/launch.py`. The agent waits for the hidden client and recorder before the first action. The native client uses an isolated game directory. It does not change the user's Minecraft settings. The recorder stops after the exit portal event. To stop a test at an action boundary, create `runs/NEW_RUN/stop`. Wait for `full-playthrough.mp4.finished.json` before closing the native client. The native client serves its own live WebRTC view: after `launch.py` starts, open `http://127.0.0.1:25590/` (VP8, 30 fps, local only). No separate preview process is needed. The client only encodes the stream while a browser is connected. `NATIVE_WEBRTC_PORT` changes the port and `0` disables it; `http://127.0.0.1:25590/stats` shows viewers and per-sink frame counts.

Capture reads each frame through an asynchronous pixel buffer, so the render thread does not wait for the GPU. The recording, the 2-second `native-preview.png` snapshot and the live view each run on their own thread and keep only the newest frame. A slow consumer drops its own frames instead of delaying the others. On a 960 × 540 test with a recording running, the median end-to-end live view latency fell from about 60 ms to 31–39 ms, and p99 from about 90–110 ms to 55–70 ms, compared with the earlier ffmpeg/Node relay. `NATIVE_LATENCY_PROBE=1` stamps capture times into the frames and logs render timing for such measurements.

The earlier relay remains as a fallback: set `NATIVE_WEBRTC_PORT=0` for the client, then run `npm run preview` (H.264 through ffmpeg). `NATIVE_PREVIEW_PORT` and `NATIVE_PREVIEW_RTP_PORT` (default 25592) change its ports.

The native client dependencies, including the webrtc-java library for the live view, are installed with `python3 native-client/install.py`; build the display and capture adapter with `./native-client/build.sh`. Set `MC_JAVA_HOME` to a Java 17 JDK for the server, build, and launch scripts. `install.py` reuses assets from an existing `.minecraft` directory when available: pass `--minecraft-dir PATH` or set `MINECRAFT_DIR`; the default is the platform's standard location. Model access requires credit with the configured providers.

## Configurable agents

Besides the seeded dragon speedrun, the project can run general-purpose bots. Each bot is one directory under `agents/`:

```
agents/<name>/agent.json   configuration (checked in)
agents/<name>/data/        world.db, events.jsonl, auth cache (local, ignored by Git)
data/knowledge/            shared knowledge: *.md guides (checked in) and knowledge.db (local)
```

Start them with `node run-agent.mjs helper`, several at once with `node run-agent.mjs helper miner`, or every enabled agent with `node run-agent.mjs --all`. `node run-agent.mjs --list` validates and lists the configs. Each bot runs in its own process.

On Windows, `./start-agent.ps1` starts `helper` with an offline player name. It selects `HELPER_USERNAME` first, then `MC_USERNAME`, then its default `test_bot_1`; it passes the selected name to the helper config before launching Node. For example, set `$env:HELPER_USERNAME = 'MyHelper'` before running the script to override the default. `MC_USERNAME` is a compatibility input for this script, not a global override for every agent. Direct `node run-agent.mjs helper` reads `HELPER_USERNAME` and defaults to `Helper`; `miner` reads `MINER_USERNAME` and defaults to `Miner`. `HELPER_OWNER`, `RUN_ID`, and the `helper` directory name do not set the login name.

Offline player names must contain 3–16 ASCII letters, digits, or underscores; invalid names fail config validation before connecting. Microsoft authentication uses the account's actual profile and cannot assign an arbitrary offline name. `--list` and `/status.configuredPlayer` show the requested name; before spawn, `/status.player` is null. After spawn, `/status.player` reflects the bot's actual username and `/status.loginMatchesConfigured` reports whether it matches the requested name. Confirm the connected name from a new `spawned.username` event and the server player list. Changing an offline name may select another server player save; the launcher does not move old saves or rewrite earlier logs.

### agent.json

Any string may use `${VAR}` or `${VAR:-default}` to read the environment. The helper and miner configs each provide their own default account name.

| Field | Meaning |
|---|---|
| `role`, `duties`, `goals` | What the bot is for. They go into the planner and JEV prompts. |
| `account.username`, `account.auth` | The bot's own login. `offline` uses the name as is; `microsoft` signs in and caches tokens in `data/auth`. |
| `server.host`, `server.port`, `server.version` | Server to join (default `127.0.0.1:25565`, `1.16.5`). |
| `owners` | Players whose chat commands the bot obeys. An empty list turns chat control off. |
| `api.port` | Local HTTP API port on 127.0.0.1; `0` disables it. |
| `models.planner`, `models.decision` | `baseUrl`, `model`, `apiKeyEnv` per bot. The defaults are the global `PLANNER_*` and `DECISION_*` variables. |
| `actions.allow`, `actions.deny` | Skill whitelist and blacklist; `*` and prefixes such as `combat_*` work. |
| `mode` | `general`, or `dragon-speedrun` to run the tuned `nether-agent.mjs` with this bot's name and models. |
| `planIntervalMs`, `observe.radius`, `observe.intervalMs` | Replanning interval and world scan settings. |

Examples: `agents/helper` (follows owner requests), `agents/miner` (ores, different JEV model, no following), and `agents/speedrun` (the existing speedrun, disabled by default).

### How a general agent decides

The planner keeps the JEV split. It receives the observation and returns an objective, item targets, an optional waypoint and preferred skills. Before answering it can call three tools:

- `query_world`: places this bot has seen, nearest first. The R-tree index in `world.db` answers it.
- `search_notes`: the bot's own notes, such as chest contents, deaths, failures and owner instructions.
- `recall_experience`: shared knowledge, which holds all 1.16.5 crafting recipes, `data/knowledge/*.md` and lessons from every bot's earlier runs.

The skills in `bot/skills.mjs` then offer concrete, bounded actions: eat, fight or flee, sleep, follow or give to the owner, mine a visible or remembered source, craft, smelt, place a table or furnace, loot a chest, pick up drops, travel, explore and wait. JEV chooses one. A failed action is cooled down for 30 seconds and written back as an experience that other bots can recall.

The world database contains only what the bot has loaded as a normal client. It does not read save files. Blocks that change are marked gone.

### Shared knowledge and retrieval

Keyword search (SQLite FTS5 trigram, which also matches Chinese) always works. Set these variables to add vector search and reranking:

| Variable | Purpose |
|---|---|
| `EMBED_BASE_URL`, `EMBED_API_KEY`, `EMBED_MODEL` | OpenAI-compatible `/v1/embeddings` |
| `RERANK_BASE_URL`, `RERANK_API_KEY`, `RERANK_MODEL` | Jina/Cohere/SiliconFlow-style `/v1/rerank` |
| `KNOWLEDGE_DB` | Knowledge database path (default `data/knowledge/knowledge.db`) |

New documents can be found by keyword at once. They are embedded in the background in batches, which gives real-time indexing. Results from keyword and vector search are merged with reciprocal rank fusion and then reranked. If either service fails, search falls back to the remaining methods.

### Owner control

In game, owners can type `!goal <text>`, `<botname>, <request>`, `!come`, `!follow`, `!stop`, `!resume`, `!status`, `!where <block>`, `!remember <text>`, `!received` and `!help`. The bot answers by whisper.

For a delivery request, the bot drops items near the owner and waits for confirmation before marking the request complete. `/status.request.deliveryPending` is true while it waits. The owner confirms in chat with `!received`; an API-origin request can be confirmed through the local `POST /received` endpoint.

The HTTP API on `api.port` provides:

- `GET /status` and `GET /plan`
- `POST /goal {"text": ...}`, `POST /stop`, `POST /resume` and `POST /received`
- `GET /world?name=iron_ore&radius=128` and `GET /world/summary`
- `GET /notes?q=` and `GET /knowledge?q=`

Only one native client is mirrored. With `NATIVE_VIEW=1`, set `NATIVE_MIRROR_BOT=<agent name>` to choose which bot the live view and recording follow.

Run `node --test bot/*.test.mjs` for the agent framework tests.

## 平台方案（Windows / Linux）

代码只有一份，平台差异只在启动脚本里：

| 方案 | 服务器 + agent | 原生客户端 + WebRTC 画面 | 用到的脚本 |
|---|---|---|---|
| A. Windows 单机 | Windows | Windows，打开 `http://127.0.0.1:25590/` | `start-server.ps1`、`start-agent.ps1`、`start-native.ps1` |
| B. Linux 跑 agent，Windows 看画面 | Linux，mirror 监听 `0.0.0.0:25578` | Windows，`start-native.ps1 -MirrorHost <Linux IP>` | Linux：`start-server.sh`、`start-agent.sh`；Windows：`start-native.ps1` |

两种方案都开启 `NATIVE_VIEW=1`：agent 会等原生客户端加载完成、进入游戏后才开始行动；客户端断开时 agent 暂停，重新连上后自动恢复（`WAIT_NATIVE=0` 可关闭这个行为）。Linux 上不运行原生客户端。

不提交到 Git 的内容（由脚本在各平台本地生成）：`node_modules/`，`server/`，`native-client/` 下的 `assets`、`libraries`、`natives`、`webrtc`、`classes`、`client.jar`、`native-view-agent.jar`、`classpath.txt`、`config.json`，以及 `agents/*/data/`、`runs/`、`data/knowledge/*.db`。换一台机器后，重新运行 `npm install`；如果这台机器要跑原生客户端，再运行 `python native-client/install.py` 和 `native-client/build.*`。

## Windows

Requirements: Windows 10/11 x64, Java 17 JDK, Node.js 18+, Python 3, and `ffmpeg`/`ffprobe` on `PATH` (for example `winget install Gyan.FFmpeg`). Set `FFMPEG` if ffmpeg is not on `PATH`. Place the official 1.16.5 `server.jar` in `server/`.

```powershell
$env:MC_JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-17'
$env:MINECRAFT_DIR = 'D:\Games\.minecraft'   # optional, reuses downloaded assets
npm install
python native-client\install.py
.\build-observer.ps1
.\native-client\build.ps1
.\start-server.ps1
```

Then set the model variables and start the agent from another PowerShell window, and run `python native-client\launch.py` when the mirror is listening. The `.sh` scripts also work from Git Bash. Banner and overlay text use Consolas and Arial from `C:\Windows\Fonts`. The debugging helpers `native-client/windows.m`, `native-client/windows.swift`, and the `optimization/eyes/relay-*.mjs` injection scripts are macOS/OpenRouter-specific and are not ported.

A new log directory alone does not reset the world. Stop the server, choose a new unused `level-name`, and start it again with the same seed. Keep the old world as evidence.

Run `node --test evidence.test.mjs native-mirror.test.mjs optimization/*.test.mjs optimization/pass-2/policy.test.mjs optimization/nether/*.test.mjs` to check completion events, native packets, action policy, and pathfinder cancellation. Live server tests remain necessary for movement, crafting, combat, and recording.

## Linux 跑 agent，Windows 看原生画面

Linux 只运行服务器和 agent，并把原生视图镜像（mirror）开放在 `0.0.0.0:25578`；Windows 运行隐藏的官方 1.16.5 客户端连接它，画面通过客户端内置的 WebRTC 在 Windows 本机查看。Linux 端不需要 Java 客户端、显示或 ffmpeg。

Linux（需要 Java 17、Node.js 18+，官方 1.16.5 `server.jar` 放进 `server/`；`npm install` 会编译 `canvas`，Debian/Ubuntu 需先安装 `build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`）：

```sh
npm install
./start-server.sh                                          # 终端 1
CPA_API_KEY=... TYPE_SAFE_API_KEY=... ./start-agent.sh     # 终端 2，默认 helper；日志出现 "Native mirror listening on 0.0.0.0:25578"
```

Windows（首次需要 `python native-client\install.py` 和 `.\native-client\build.ps1`，并设置 `MC_JAVA_HOME`）：

```powershell
.\start-native.ps1 -MirrorHost <Linux IP>
```

然后在 Windows 浏览器打开 `http://127.0.0.1:25590/`。Linux 日志出现 `Native read-only viewer ready` 即表示连接成功。

变量：`NATIVE_MIRROR_HOST`（Linux 端为监听地址，Windows 端为连接地址）、`NATIVE_MIRROR_PORT`（默认 25578）、`NATIVE_MIRROR_BOT`（镜像哪个 agent，默认第一个）、`NATIVE_MIRROR_READY_DELAY_MS`（远程模式下客户端登录后等待资源加载的时间，默认 20000；画面缺区块时调大）。远程模式（`NATIVE_MIRROR_REMOTE=1`）无法读取客户端机器上的文件，因此不支持 `NATIVE_RECORD` 录屏和 `WAIT_NATIVE`，这两项仍需单机运行。25578 端口没有鉴权，只能被一个客户端连接，请用防火墙只放行 Windows 的 IP。

## Sources

- [Official TypeSafe introduction and Doom demo](https://typesafe.ai/blog/introducing-system-one-models-and-jev): structured game state, typed decisions, and a real-time action loop.
- [JEV Minecraft demo](https://www.reddit.com/r/accelerate/comments/1whk9oy/new_typesafe_ai_jev_model_playing_minecraft_wip/): the author describes JEV choices through Mineflayer.
- [Minecraft demo source](https://github.com/ellistev/typesafe-minecraft-demo): both bounded direct actions and earlier batch actions are documented.
- [Mario example](https://github.com/fhshaik/typesafe-mario): structured observations and a small legal action set.
- [StarCraft example](https://github.com/phyous/tsai-sc): bounded actions, recorded model probabilities, and explicit victory checks.
- [StarCraft Twitter post](https://x.com/literallydenis/status/2100622868878868603): found through the public JEV project index; direct retrieval was blocked by Twitter.
- [TypeSafe launch Twitter post](https://x.com/CompleteSkeptic/status/2099925682726002904): direct retrieval was blocked.
- [New seed human speedrun](https://www.speedrun.com/mc/runs/yoex3d0z).
- [Previous seed report](https://www.reddit.com/r/minecraftseeds/comments/m6vjbd/): Java 1.16 seed and portal coordinates.
- [One-cycle guide](https://mcsr.info/speedrunning/one-cycle): bed support, cover, and timing.
- [Mineflayer](https://github.com/PrismarineJS/mineflayer), [Pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder), and [Prismarine Viewer](https://github.com/PrismarineJS/prismarine-viewer).
- [Official Astra model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra).

## Combat implementation

`end-combat.mjs` offers one bounded bed attack. JEV chooses the action. The action places one bed, aims at it, and waits for the observed head to enter the attack window before one use command. It aborts if the player loses cover or breath enters cover. The local test improved from 11 to 46 damage per bed after aiming first and tightening the window. A later prepared test used seven beds to kill the dragon and ended with 13 health, without damage protection. Its evidence is `combat-lab/eight-bed-test-03.jsonl`. This test used a local test driver, prepared items, and a prepared dragon approach. The first full sequence with Sol and JEV succeeded in `practice-02`.

`observer/DragonObserver.java` adds a read-only observation call to the server dragon tick. Its HTTP endpoint is local only. Build it with `./build-observer.sh`. No part of this sensor grants items, moves the player, changes health, or changes the dragon AI.

`combat-probe.mjs` is a local test driver hardcoded to port 25577. It does not call either model and must never be presented as a model-controlled run. The `combat-lab` files include prepared positions, items, and other test changes.

The bed timing research also used [AltoClef's bed-combat source](https://github.com/gaucho-matrero/altoclef/blob/main/src/main/java/adris/altoclef/tasks/speedrun/KillEnderDragonWithBedsTask.java). The action implementation in this project is separate.

## Recording and control limits

The final route is fixed in `optimization/nether/config.json`. Astra receives game state and route observations; JEV selects bounded actions. Mineflayer performs pathfinding and timed block interactions. This is not screenshot-only or individual-key control. The native view mirrors the bot state. Its camera uses small turns, and its inventory screens show the current item and cursor state. The final run used no live operator guidance or repairs.

A recording can contain several capture files if the agent needs a code update. Preserve all active gameplay. Mark each update pause in the combined video. Report deaths and pauses; do not describe such a recording as a deathless or uninterrupted run.

The new native video is one continuous capture. Add the information strip with `node overlay.mjs nether-final-02`. Check it with `node verify-run.mjs nether-final-02 nether-final-02 full-playthrough-overlay.mp4`. To rebuild the older viewer video, run `node assemble-video.mjs recorded-06`; check it with `node verify-run.mjs recorded-06`. The raw capture files, action log, video manifest, and world are preserved. The older viewer manifest records its development pauses; those do not apply to the new continuous recording. The overlay marks the exit event as complete. The current code prevents another game action after victory.

A test in the separate lab showed that a long fall into an End portal can carry fall damage into the End. That proposed action was rejected. The recorded player used short, checked downward mining steps instead.

## General helper execution and reviewed memory

The general helper now supports staged plans, parameterized gameplay operations, recipe prerequisites, and a persistent review-memory queue. See [the implementation plan](docs/plans/agent-execution-memory-plan.md) and [the configuration and operation guide](docs/agent-execution-memory.md). Reviewer credentials are independent of the planner and JEV; without them, evidence remains queued locally. `npm test` runs offline `.test.mjs` files and excludes live-world setup scripts.
