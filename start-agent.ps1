$env:MC_JAVA_HOME='D:\java\jdk17'
$env:MINECRAFT_DIR='D:\GAME\PCL2\.minecraft'

$env:PLANNER_BASE_URL = 'https://www.xzaiweb.cn'
$env:PLANNER_API_KEY = $env:CPA_API_KEY
$env:PLANNER_MODEL = 'gpt-6-luna'

$env:REVIEWER_BASE_URL = 'https://www.xzaiweb.cn'
$env:REVIEWER_API_KEY = $env:CPA_API_KEY
$env:REVIEWER_MODEL = 'gpt-6-luna'

$env:DECISION_BASE_URL='https://api.typesafe.ai'
$env:DECISION_API_KEY = $env:TYPE_SAFE_API_KEY
$env:DECISION_MODEL = 'jev-latest'

$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
$env:NO_PROXY="*.xzaiweb.cn,localhost,127.0.0.1,::1"
$env:MC_PORT='25565'
# 不使用本地模型中转（model-relay.mjs）：清掉可能从外部环境继承的 MODEL_RELAY，直接请求模型 API。
Remove-Item Env:MODEL_RELAY -ErrorAction SilentlyContinue
$env:NATIVE_VIEW='1'

$env:HELPER_OWNER='command2283'
if ($null -eq [Environment]::GetEnvironmentVariable('HELPER_USERNAME')) {
  $mcUsername = [Environment]::GetEnvironmentVariable('MC_USERNAME')
  $env:HELPER_USERNAME = if ($null -ne $mcUsername) { $mcUsername } else { 'test_bot_1' }
}
$env:RUN_ID='test_bot_2'
# General helper stores its state under agents/helper/data. The nether snapshot
# tool requires a fresh run directory and belongs to the separate speedrun mode.

# $env:DRAGON_SENSOR_URL='http://127.0.0.1:3093'
node run-agent.mjs helper
