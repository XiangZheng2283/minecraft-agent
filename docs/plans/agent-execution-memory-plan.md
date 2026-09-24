# 通用 Minecraft Agent 执行与审核记忆增强计划

日期：2026-09-24。状态：用户已批准方案及 GPT-6 Sol high 并发实施。

## 目标与约束

- 运行入口：start-agent.ps1 → run-agent.mjs helper → bot/main.mjs。
- 保留 Plan、JEV、审核模型三个角色；不增加方向决策模型。
- Plan 负责目标与阶段，本地执行器推进步骤并计算确定性的依赖，JEV 选择现场操作。
- 审核复盘必须保留：操作证据持久化、批量复盘、情境经验检索反馈给 Plan 和 JEV。
- 使用本地 Mineflayer、prismarine 配方、SQLite 和现有知识库，不引入非必要外部服务。
- 保留已有未提交改动和旧速通入口。不得重置工作区或修改真实游戏状态以伪造测试。
- 不自动 Git 提交、不启动真实游戏机器人、不调用计费模型 API 做测试；实机验收单独标记。

## ECC 流程

采用 agent-architecture-audit、cost-aware-llm-pipeline 与 orch-pipeline 的证据、计划、测试先行、实现、审查流程。规模 large。
用户本轮指令已满足计划实施批准；提交不在授权任务内。
并发模型固定 GPT-6 Sol，reasoning high。按文件所有权划分，交叉审查阶段再交接。

## 现状证据

- bot/skills.mjs 仅提供材料齐全时的合成候选，不能展开原木→木板→木棍→工作台→木镐依赖。
- gather_blocked 返回字符串，运行时将其记为 action_done；完整日志第 54/55 步无合成选项。
- bot/agent.mjs 将候选按 prefer 排序后取前 24 个；JEV 通过 /v1/systemone 选择 aN。
- bot/config.mjs 默认 planIntervalMs=20000；正常推进也会重复调用 Plan。
- bot/knowledge.mjs 已有 SQLite FTS、可选 embedding/rerank，但经验缺适用条件和验证证据。
- 旧 eyes-preparation.mjs 有工具准备能力，helper 未使用；应借鉴而非引入旧机器人全局流程。

## 架构及接口契约

```text
用户目标 → Plan → 本地阶段执行器 → JEV → 游戏操作适配器
                       ↑                    ↓
                       └────实际结果─────────┤
                                            ↓
本地经验检索 ← 情境经验 ← 审核模型 ← 持久化操作过程/审核队列
```

### 操作结果

操作结果使用对象：status、summary、reason、missing、evidence、retryable。
status 为 success / partial / blocked / failed / cancelled / unconfirmed。
只有经过相应状态核验的 success 才算实际成功；blocked 与 unconfirmed 不算任务完成。
兼容旧字符串技能，但不能把显式 gather_blocked 或失败状态当成功。
动作带任务版本及步骤标识；旧模型响应不得覆盖新任务。

### Plan

保留 objective、targets、additionalTargets、deliveryRequired、deliveryTargets、waypoint、prefer 的兼容。
增加可选 steps：每项有 id、description、targets（该阶段达到的绝对库存）、operations（明确参数的操作请求）。
操作请求形状为 { action, args }，action 必须来自操作注册表，参数运行前验证。
无 steps 的旧计划继续工作。阶段以库存或明确动作回执推进，不接受任意代码表达式。
新目标、计划不适用、持续无进展等事件触发 Plan；正常推进取消固定 20 秒重规划。
未知条件交还 Plan，不在本地执行器中硬编码业务策略。

### 游戏操作注册表

新增 bot/actions.mjs：导出 ACTION_CATALOG、createActionRegistry(bot, { skills, world, timeouts })。
实例提供 candidates(ctx)、describe()；候选沿用 { skill, key, description, fn }。
ctx.plan.operations 为当前阶段操作数组，本地阶段执行器负责投影。
候选 fn({signal}) 调用真实 Mineflayer 能力，返回结构化结果；不能通过模型输出执行任意 JS。
注册表与现有 skills 候选合并，沿用权限和冷却机制。

### 经验及审核服务

新增 bot/experience.mjs：openExperience({path, now})。
接口：record(event)、enqueue(episode)、retrieve(context,{limit})、stats()、close()。
队列操作供 review worker 使用：claim、complete、fail（实际函数签名由负责代理尽早通告）。
新增 bot/reviewer.mjs：createReviewer({store, review, config, log, now})；提供 kick()/flush()/stop()/stats()。
review 为注入的 async 模型函数，返回结构化复盘；模型网络封装统一由 models.mjs 实现。
审核不直接执行游戏操作。队列持久化、失败退避、同类失败合并，断网/无配置保留待审任务。
现场事实与跨世界经验隔离；未经证据支持的建议保留待验证状态。

## Step 1 — 真实结果与合成依赖

负责人：Sol high A。拥有 bot/skills.mjs、bot/skills.test.mjs、bot/recipe-planner.mjs 及其测试。

- 先复现只有原木时无法合成工具的故障。
- 通过真实配方展开中间材料，处理产物数量、配方替代、循环和有界搜索。
- 准备工作台、工具和采集前置材料；不只处理显式最终合成目标。
- 修复合成批次数量检查和结果核验。
- 缺少工具生成条件反馈，避免零耗时假成功。
- 测试从原木逐步得到木板、木棍、工作台与木镐；已有工作台、库存不足、循环配方及取消。

## Step 2 — 阶段执行、模型调用与成本

负责人：Sol high B。拥有 bot/agent.mjs、bot/models.mjs、bot/config.mjs、bot/main.mjs、bot/plan-executor.mjs，以及相应测试。

- 扩展阶段计划，兼容旧计划和交付语义。
- 按阶段生成候选，接入 actions 注册表及 experience/reviewer。
- Plan 与 JEV 接收本地筛选的少量相关经验；不调用 embedding/rerank 做高频经验检索。
- 成功推进阶段不触发定时 Plan；缺条件/无进展有界恢复与事件重规划。
- 增加 reviewer 独立模型配置，凭据缺失时不丢队列。
- 临时网络/429/5xx 有界退避，永久错误不热循环，模型请求不做无限修复调用。
- 统计角色、调用次数、延迟、token（不可得则明确 unknown）、重试和审核积压。
- 模型测试全部使用 fake fetch，不调用真实 API。

## Step 3 — 持久审核与情境记忆

负责人：Sol high C。拥有 bot/experience.mjs、bot/reviewer.mjs 及其测试。

- 复用 SQLite，使用新版本化表，不破坏现有知识文档和世界数据库。
- 保存前后状态、动作回执、任务版本及证据 ID。
- 审核任务持久化、去重、恢复、claim 租约、失败重试，重复事件不重复写入经验。
- 结构化记忆包含目标、条件、建议、禁用条件、证据、版本、范围和验证状态。
- 证据不充分不能标为已验证；复盘中的事实与推测分离。
- 本地检索按条件/版本/世界过滤，返回有限条简短经验。
- 测试重启恢复、非法证据拒绝、同类合并、建议与验证经验区分、跨世界隔离、审核失败退避。

## Step 4 — 全部游戏接口接入

负责人：主代理，随后交 Sol high 交叉审查。拥有 bot/actions.mjs 及其测试和操作覆盖文档。

| 领域 | 接入范围 | 验证要求 |
|---|---|---|
| 感知 | 背包、装备、周边方块/实体、容器、配方 | 只读事实带范围与时效 |
| 导航 | 坐标接近、跟随、停止、朝向、有限控制、载具 | 参数有界，终止清理控制 |
| 方块 | 挖掘、指定面放置、激活 | 工具/距离/目标复核 |
| 物品 | 各装备槽、使用、拾取、丢弃 | 名称/数量验证与库存核验 |
| 合成 | 指定数量、配方、工作台 | 材料校验与实际增量 |
| 容器 | 查看、存入、取出、物品转移 | 关闭窗口、部分结果、不超额取放 |
| 加工 | 熔炉、附魔台、铁砧、酿造支持情况 | 以库实际 API 为准，明确不支持状态 |
| 战斗生存 | 攻击、使用武器/盾牌、进食、睡觉 | 目标核验，可取消 |
| 生产 | 种植、收获、繁殖、钓鱼、交易 | 组合通用接口，真实结果核验 |
| 特殊交互 | 方块/实体交互、载具、传送门维度观察 | 不假定传送已完成 |

不能支持的版本或 API 明确返回 unsupported/blocked 并记录覆盖状态，不能声明已实机验证。
组合任务通过 Plan 与基本操作完成，不为每个复杂建筑写固定脚本。

## Step 5 — 集成、审查、回归与文档

- GPT-6 Sol high 对不归自己编写的模块交叉审查；数据库、模型网络与参数入口包含安全审查。
- 解决高优先级发现后运行 node --test bot/*.test.mjs 及项目完整测试。
- 针对木镐故障、阶段取消、旧响应、审核证据、重启队列、费用调用频率做集成验证。
- 修复 start-agent.ps1 的固定快照运行名启动错误；保留模型凭据仅来自环境变量。
- 更新覆盖表、配置示例、运行限制及实际验证记录，不伪造实机结果或计费节省比例。

## 验收与完成记录

- [x] 只有原木时能提供并推进正确合成准备链。
- [x] blocked 不记成功，失败不会无界热循环。
- [x] Plan 能一次覆盖多个步骤，正常推进不固定间隔重复调用。
- [x] JEV 可见当前阶段操作及适用经验，参数校验后执行。
- [x] 审核 API 独立配置，缺配置/故障时证据和审核任务仍持久保存。
- [x] 经验只有证据支持才验证，场景/版本隔离生效。
- [x] 扩展接口覆盖文档与实现一致。
- [x] 回归测试及交叉审查通过；实机未验证项明确列出。

以上为实现与离线验收结果，不代表已通过真实服务器验收。

### 实施记录（2026-09-23）

- 已按职责分配给三个 GPT-6 Sol high 代理并发实施：合成依赖、阶段执行及模型、审核记忆；主代理负责接口初始实现、集成、输入边界、启动与测试入口、文档。随后进行跨模块审查。
- `recipe-planner.mjs` 使用真实版本配方展开依赖；`skills.mjs` 校验合成数量、实际产物、工具与工作台前置条件，并保护最终目标所需库存。
- `plan-executor.mjs` 推进结构化阶段；`actions.mjs` 接入 32 类参数化操作，校验参数、实际回执与取消。原生操作超时但尚未结束时继续持锁，避免重复执行。
- Plan 在新目标或恢复事件时调用；JEV 从当前阶段候选选择动作。无额外决策模型；经验本地检索后同时供 Plan 与 JEV 使用。
- 独立 reviewer 支持持久审核队列、租约恢复、分批、退避与每进程任务预算。超时且原请求仍运行时暂停该任务，防止同进程重复请求；重启可恢复。
- 模型自由文本建议始终为 suggestion；verified/observed_failure 只用于从操作证据生成的观察事实。按世界、维度与版本隔离；失败使用可以使已验证记录失效。
- 审查修复包括：窗口关闭后的库存核验、附魔/铁砧产物核验、取消或换任务后的证据归属、跨维度审核、条件长度校验、分页经验检索、模型工具调用边界及本地 HTTP 输入上限。
- 修复 helper 启动误用固定快照目录；`npm test` 显式发现 `.test.mjs`，避免误运行需要真实游戏的准备脚本。
- 最终 `npm test`：**240/240 通过**，无跳过。包含真实 1.16.5 配方与模拟状态下保留 16 个原木目标、额外采料、准备工作台/木镐并获得圆石的完整链，以及阶段操作→证据→审核→记忆检索闭环；审核迟到的非法响应也会退避重试，不永久卡在 suspended。GPT-6 Luna 的 Plan 工具调用使用 Chat Completions 支持的 `reasoning_effort=none`。
- 未连接真实游戏，未调用计费模型 API，未进行 Git 提交。服务器同步、复杂寻路、版本差异及真实模型质量仍需实机验证。
- 运行配置和完整接口覆盖见 [agent-execution-memory.md](../agent-execution-memory.md)。
