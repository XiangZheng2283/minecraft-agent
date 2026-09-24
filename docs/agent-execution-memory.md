# 通用 Agent：操作接口、阶段计划与审核记忆

适用入口：`node run-agent.mjs helper` 或 `start-agent.ps1`，默认 Minecraft Java 1.16.5。
旧 `dragon-speedrun` 仍使用原运行时，本次增强不自动迁移其行为。

## 数据流

Plan 输出阶段和目标；本地执行器检查条件并计算配方依赖；JEV 从本阶段可执行操作中选择；操作适配器调用 Mineflayer，返回实际核验结果。
每次操作记录证据，子任务/失败过程进入持久审核队列。审核模型输出带证据的情境经验，本地检索把适用经验提供给 Plan 和 JEV。
没有新增方向决策模型。审核模型不能执行游戏操作。

### 操作结果

| status | 含义 |
|---|---|
| success | 此操作定义的完成条件已核验；不表示整个任务已完成 |
| partial | 有实际进展但没有完成所需数量或结果 |
| blocked | 参数、材料、工具、距离或设备等条件未满足 |
| failed | 操作抛错或服务拒绝 |
| cancelled | 主人、计划变更或停机取消操作 |
| unconfirmed | 操作已发出，但无法确认结果；不能假定成功或立即重复 |

动作超时/取消后，尚未结束的原始 Promise 受到操作锁保护；等待期间不反复请求 JEV。
旧技能的字符串回执仍兼容，但带 `legacyUnverified` 标记，不作为已验证成功经验。
关键合成、采集及工作台放置已改为结构化核验。

## Plan 协议

保留旧 `objective/targets/additionalTargets/deliveryRequired/deliveryTargets/waypoint/prefer`。
新增可选 `steps`，每步至少有库存目标或一个带参数的操作：

```json
{
  "objective": "准备工具并收集圆石",
  "targets": { "oak_log": 16, "cobblestone": 32 },
  "steps": [
    { "id": "prepare", "description": "准备木镐", "targets": { "wooden_pickaxe": 1 } },
    { "id": "gather", "description": "采集圆石", "targets": { "cobblestone": 32 } },
    { "id": "restock", "description": "确认原木库存", "targets": { "oak_log": 16 } }
  ],
  "deliveryRequired": false,
  "prefer": ["craft", "gather_mine"]
}
```

显式操作形状为 `{ "action": "equip", "args": { "item": "iron_helmet", "slot": "head" } }`。
同一步同时指定 targets 和 operations 时，必须全部满足。没有状态目标的操作依赖成功回执推进。
禁止任意脚本、未知操作、非法数量或坐标。操作目录来自 `bot/actions.mjs`，不是提示词中虚构的工具。
JEV 仍使用现有 System One choice 接口；候选参数由当前计划和程序校验确定，不能绕过校验调用任意 API。

## 已接入的操作目录

表中的“已接入”表示有参数化适配器及本地验证，不代表已经在真实服务器逐项验收。

| 领域 | action | 参数/边界 |
|---|---|---|
| 感知 | observe | inventory、entities、block、recipes；有限范围和条数 |
| 导航 | move、follow、stop、look | 有界坐标和范围、实体 ID、取消清理 |
| 运动 | control | forward/back/left/right/jump/sprint/sneak，最多 40 tick |
| 载具 | mount、dismount、vehicle | 可见实体、已乘坐状态、有界方向输入 |
| 方块 | dig、place | 预期方块名称、参考块坐标、单位朝向向量、实际方块核验 |
| 交互 | activate_block、activate_entity | 可选手持物品；用于耕地、喂养、剪羊毛、按钮等通用交互 |
| 装备 | equip、unequip | hand/off-hand/head/torso/legs/feet |
| 物品 | use、toss、pickup | 有界使用、指定数量丢弃、附近拾取 |
| 合成 | craft | 指定产物数量；自动技能可展开材料准备链 |
| 容器 | container | inspect/withdraw/deposit；窗口关闭后核对玩家库存 |
| 背包整理 | inventory_move | 玩家储物/快捷栏 9..44 槽，目标槽须为空 |
| 熔炼 | smelt | inspect/input/fuel/collect，适配实际熔炉 API |
| 酿造 | brew | 查看、放入、取出酿造槽；取出物品不等于药水已酿成 |
| 战斗 | attack、use | 单次近战、弓/盾等物品使用；未观测伤害不谎报击杀 |
| 生存 | eat、sleep、wake | 食物白名单检查、床和睡眠状态核验 |
| 生产 | fish、trade | 钓鱼、查看村民交易/执行指定交易 |
| 加工 | enchant、anvil | 附魔、重命名/组合；核验产物而非只检查材料减少 |
| 维度 | portal | 进入已存在传送门并观察维度变化 |

种植/收获/繁殖、建造、箱子搬运等是基本操作组合。协议不承诺任何任意建筑任务均可自动完成；路径、配方数据和服务器规则仍会导致 blocked 或 unconfirmed。
实例中不存在的 Mineflayer API 返回 `blocked`、reason=`unsupported`，不会模拟成功。

## 配置审核模型

新增独立环境变量（通过兼容 chat completions 的提供方调用）：

```powershell
$env:REVIEWER_BASE_URL = 'https://your-provider.example/v1'
$env:REVIEWER_MODEL = 'your-review-model'
$env:REVIEWER_API_KEY = $env:YOUR_REVIEW_PROVIDER_KEY
.\start-agent.ps1
```

示例地址和模型为占位符。请使用实际提供方配置。程序不会把凭据写入文档或日志。
没有 `REVIEWER_API_KEY` 时不调用审核 API；证据与待审队列仍保存，并在状态中显示审核未启用。
默认审核模型配置独立于 Plan 和 JEV；无需更换现有两个模型。

`agents/helper/agent.json` 可增加：

```json
{
  "worldId": "my-survival-save",
  "review": {
    "enabled": true,
    "maxReviews": 24,
    "maxPerFlush": 4,
    "debounceMs": 15000,
    "minIntervalMs": 15000,
    "timeoutMs": 45000,
    "baseDelayMs": 1000,
    "maxDelayMs": 300000
  }
}
```

这些字段并入现有配置，不要覆盖账号、主人等原字段。`maxReviews` 为每次进程的审核任务尝试上限，不是货币额度，也不等于 HTTP 请求数（临时错误可能重试）。达到上限保留未处理任务。
`worldId` 用于区分同一个服务器地址下更换的存档；没有显式值时使用服务器地址/端口及维度标识。

## 存储和检索

- 世界事实继续位于 `agents/<name>/data/world.db`。
- 配方和教程继续位于原知识库；本次不删除或重建现有知识数据。
- 新操作证据、审核队列、情境经验位于 `agents/<name>/data/experience.db`。
- 经验根据版本、世界、维度、库存上下限与明确事实进行本地过滤。
- 经验分为 verified、suggestion、observed_failure、invalidated；失效经验不再推荐。
- 模型自由文本建议始终保留为 suggestion。程序另外从实际操作证据生成观察事实；verified 需要成功操作、非空结果证据、实际状态变化，并绑定对应操作及参数，不把模型扩展的推测标记为已验证。
- 队列持久化、租约恢复、分批、去重与指数退避；容量外任务进入持久 overflow，不静默丢弃。
- 长证据会有明确截断标记，不把未传给审核模型的细节冒充为已审核结论。

## 调用与成本观测

Plan 改为新目标和恢复事件触发；正常阶段推进不按旧 `planIntervalMs` 固定重规划。
JEV 不在操作尚未完成时重复调用。审核默认延迟合并，再有界处理队列。
合成、挖掘等原生操作超时或取消后，如果底层 Promise 尚未结束，执行锁继续保留；观察和停止接口仍可使用。停止并不等于已取消服务器端合成。
审核超时但底层模型请求仍运行时，任务进入持久 suspended 状态，避免同进程重复计费请求；迟到的有效结果仍可入库，进程重启后恢复待审任务。
高频情境经验检索不调用 embedding/rerank。原教程知识库的可选向量检索仍按原配置工作。
状态 API 中查看 `models`、`experience`、`reviewer`：角色调用数、HTTP 请求数、重试数、已知 token、用量未知次数、审核积压、预算余额和下次处理时间。
没有提供方用量时明确记录 unknown；不以 0 token 冒充免费调用，不宣称未经测量的节省比例。

## 验证

```powershell
npm test
node --test bot/execution-integration.test.mjs
node --test --experimental-test-coverage bot/actions.test.mjs
```

`npm test` 只发现 `.test.mjs` 单元测试；不会自动执行 `setup-*-test.mjs` 真实世界准备脚本。
测试使用真实配方数据、模拟游戏状态和模拟模型响应，不连接游戏、不消耗模型额度。
本次最终全量离线测试：240/240 通过，无跳过。实现与交叉审查记录见 [计划文档](plans/agent-execution-memory-plan.md)。

实机仍需验证：服务器窗口同步、复杂寻路、附魔/铁砧/酿造的版本细节、敌对环境中断、传送门和真实模型规划质量。
只有完成对应实机操作并检查证据后，才应将该项标记为实机验收通过。
