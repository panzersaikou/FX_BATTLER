# Twelve Data 可选参考汇率（9 币种）

默认游戏已经扩展为 30 币种离线历史基准，见 [历史数据说明](world-baseline.md)。本文描述保留的 9 币种联网选项；两者不会混合报价。

Twelve Data 只提供每局的开局参考价。游戏创建后，世界的时钟、价格、点差、宏观指标和事件继续由模拟引擎推进；新的参考快照只影响之后创建的世界。离线 HTML 不调用此服务。

## 数据与换算

服务端请求固定 HTTPS 地址 `https://api.twelvedata.com/time_series`，传入逗号分隔的 `symbol`、`interval=1min`、`outputsize=1`、`timezone=UTC`、`order=desc`、`format=JSON` 和服务端 `apikey`。参数和批量结构参考 [官方 Python SDK](https://github.com/twelvedata/twelvedata-python#batch-requests)，不使用浏览器端凭据。

| 货币 | 原始直盘 | 统一 USD 价值 |
| ---- | -------- | ------------- |
| USD  | 无需请求 | 1             |
| EUR  | EUR/USD  | close         |
| JPY  | USD/JPY  | 1 / close     |
| GBP  | GBP/USD  | close         |
| CHF  | USD/CHF  | 1 / close     |
| CAD  | USD/CAD  | 1 / close     |
| AUD  | AUD/USD  | close         |
| NZD  | NZD/USD  | close         |
| MXN  | USD/MXN  | 1 / close     |

`A/B = usdValue(A) / usdValue(B)`，因此九种货币可以形成 36 组唯一交叉盘、72 个报价方向。此联网模式保留上述 9 币种固定集合；默认离线模式为 30 种货币。

每个结果必须包含正确的 symbol、1min interval、成功状态、有效 UTC 时间和正数有限 close。整批有缺失、错误或异常值就拒绝；不部分更新，也不补入演示价格。相对服务器时间，未来超过 2 分钟、任一报价超过 96 小时、币种间时间差超过 10 分钟都拒绝。阈值是当前原型的数据质量策略，不是对市场开放时间的判断。

`datetime` 是源 K 线标记时间，不是最新逐笔成交时间；close 可能来自尚未收盘的蜡烛。整体 `asOf` 取最早币种的时间，并保留全部币种时间。页面固定以北京时间展示，API 使用 ISO UTC 字符串。

## 缓存与预算

- 全进程共用一个提供器，成功快照缓存 1 小时。只有新局需要数据时才按需刷新，并发请求等待同一次上游请求。
- 每批 8 个 symbol，按每个 1 credit 估算约 8 credits，不把一次批量 HTTP 请求算成一个 credit。每个 UTC 日最多尝试 24 批，错误也占本地预算；通常约 192 credits / 日以内。真实扣费与币种权限仍以账户为准。
- 每次上游请求总超时 10 秒，不自动网络重试。失败后冷却通常 5 分钟；若服务端提供 Retry-After 则遵守，且至少间隔 60 秒。网页重复点击不会直接重打上游。
- 刷新失败时，仅可使用尚未超过 96 小时的完整缓存，页面标注更新失败与旧快照。没有合格缓存就返回 503，不自动开历史基准局。
- 报价距开局超过 2 小时会显示较旧快照。周末通常也会如此，页面不会把周五报价改称周日市价；尚无完整交易日历，不能自动断言数据旧是因为休市。
- 缓存、冷却和预算为内存状态，重启清空，多实例不共享。本地预算不包含其他使用同一个 key 的服务；公开或多实例部署前必须统一持久化配额。

## 接口

- `GET /api/baseline`：返回 referenceAvailable、defaultMode 和说明。available 只指配置存在，不代表已验证授权或连通，不调用上游。
- `POST /api/sessions`：可传 `{"baseline":"historical"}` 或 `{"baseline":"reference"}`。省略时，始终用 historical（30 币种）；demo 为 historical 的兼容别名。
- 会话 `source`：历史局使用年度基准，不填伪造的市价时间；参考局包含固定的报价时间、获取时间、selectedAt、ageAtStartSeconds、delivery、staleAtStart、warnings 和 quotes。年龄表示**开局时**的年龄，不随游戏时钟变化。
- `delivery` 为 downloaded / cache / fallback，分别表示本次共享请求取得、缓存命中、更新失败后沿用完整缓存。
- 数据错误返回安全的 error 和 code，可能附 Retry-After。不会把上游响应中的 URL、密钥或错误详情传给浏览器。
- 状态轮询、交易、推进时间、健康检查都不会刷新参考汇率。新局失败不会删除已有会话。

## 配置与验收

1. 在云环境设置中安全填写 `TWELVE_DATA_API_KEY`，将密钥发送目标限定为 `api.twelvedata.com` 并允许该域名。代理占位符由环境代理替换，不能复制当作原始密钥或绕过代理。保存配置草稿不会自动应用或发布。
2. 普通本地开发可以将 `.env.example` 复制到仓库根目录 `.env`，自行填写密钥；不要提交该文件或把密钥放进 VITE_ 变量。服务端自动加载，进程环境变量优先。配置改变后重启服务。
3. 启动应用后创建参考新局，展开「开局基准」核对 8 个直盘、方向和原始时间。查看 Twelve Data 账户用量；短时间连续创建新局应该复用缓存。
4. 观察、下单和加速不应增加上游用量。之后取得新参考快照不能改变已在进行中的游戏。
5. 核对免费账户是否允许这 8 个币种与 1 分钟数据；遇到套餐、额度或网络错误先看明确提示，不改成伪装的“真实”数据。

本次已使用合成的官方格式响应验证适配器、API 与真实浏览器流程。尚未在配置真实账户的情况下请求 Twelve Data，账户授权、实际响应与扣费仍待联调。测试样本仅在测试中使用，不会作为运行时回退。
