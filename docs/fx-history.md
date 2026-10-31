# 现实汇率历史档案

本地保存两年窗口的真实日频参考观测，用于研究和以后校准。交易终端仍运行独立的模拟 K 线，历史档案不会自动改变开局汇率。

| 项目     | 当前数据                                                                                      |
| -------- | --------------------------------------------------------------------------------------------- |
| 请求窗口 | 2024-10-31 至 2026-10-31                                                                      |
| 实际覆盖 | 2024-10-31 至 2026-10-23，最后观测距获取日 8 天                                               |
| 观测数   | 9,405，19 个非美元系列各 495 个观测日                                                         |
| 覆盖     | AUD、BRL、CAD、CNY、DKK、EUR、INR、JPY、MYR、MXN、NZD、NOK、SGD、ZAR、KRW、SEK、CHF、THB、GBP |
| USD      | 恒为 1 的计价基准，不是采集的市场序列                                                         |
| 缺失     | IDR、PHP、VND、CLP、COP、PEN、TRY、PLN、CZK、HUF                                              |
| 原发布方 | Federal Reserve H.10，经 FRED 提供                                                            |
| 获取途径 | datasets/exchange-rates 公开 GitHub 镜像；非对官方 API 的直接下载                             |
| 固定版本 | c28e171e36a46bd2941cf66156acd8efaf9906f5                                                      |
| 获取日期 | 2026-10-31                                                                                    |

[固定原始 daily.csv](https://raw.githubusercontent.com/datasets/exchange-rates/c28e171e36a46bd2941cf66156acd8efaf9906f5/data/daily.csv) · [镜像转换代码](https://github.com/datasets/exchange-rates/blob/c28e171e36a46bd2941cf66156acd8efaf9906f5/exchange_rates_flow.py) · [美联储 H.10 说明](https://www.federalreserve.gov/releases/h10/about.htm)

这个镜像的 README 和 schema 对报价方向的描述已过时。固定版本转换脚本已经把原始 FRED 的 AUD、EUR、GBP、NZD 系列倒数处理，daily.csv 实际统一为 LCU/USD。导入器核对该代码后再统一倒数为 USD/单位货币。例：2026-10-23 镜像 EUR 行为 0.8929，保存的 EUR/USD 为 1/0.8929；JPY 行 156.87，对应 USD/JPY 156.87。镜像精度保留在原始文件中，不能声称完整恢复 FRED 原始精度。

原文件 SHA-256：`5f82c543467ae6398e766fb110fe57abe446b95c4ad13b2eaca8954911c6259d`。每个系列另存 FRED series ID 和官方系列链接。镜像声明 ODC-PDDL，使用时仍应核对原始系列条款。

## 本地文件与复现

- `packages/simulation/src/data/fx-history.json`：元数据、来源与日频观测，随代码保存。
- `artifacts/fx-history-daily-2024-2026.csv`：所有已覆盖货币的 USD/单位货币数据，可直接下载。
- `artifacts/fx-history-provenance.json`：不含观测行的来源清单。
- `GET /api/history`：只读本地档案；离线 HTML 内嵌同一份数据，不需要 API Key。

```bash
python3 scripts/import-fx-history.py
# 或使用已下载的固定版本原始文件：
python3 scripts/import-fx-history.py --input /path/to/daily.csv
```

导入器校验固定 SHA、正数、日期范围、重复日期和最低覆盖数。它不自动跟踪 main；更新时先审阅新固定版本、转换代码与覆盖，再更新版本及预期 SHA，避免静默改变引用数据。`--as-of` 指定研究窗口，不意味着源数据能覆盖该日期。导入脚本输出两个可下载档案。

## 计算与边界

交叉价 A/B = (USD/A) / (USD/B)，仅对共同观测日计算。缺失日不向前填充，不插值。图表按周取最后一个可用观测，用真实日期作横轴；连线只是阅读辅助。导出保留全部共同日频点。

这是日频参考数据，不能生成真实日内 OHLC、bid/ask 或点差。不同系列采样时刻可能不同，计算的交叉价不是可成交套利价格。本次没有接入实时市场接口，也没有把这两年观测用于正式参数校准或绩效回测。

## 经济体数据如何找

当前全部 30 个经济体的共同基准是世界银行 WDI 的 2023 年年度统计。GDP、人口、CPI、实际增长、失业、官方年均汇率、出口、进口、资本形成、私人信贷、中央政府债务、经常账户共 12 个来源系列，详情见 `world-baseline.md`。核心 10 项完整；私人信贷覆盖 26 个，中央政府债务覆盖 15 个。来源链接、固定镜像版本与 SHA 均已保存，可在页面「经济体 → 现实基准与扰动」查阅。

政策利率不是已获取的央行实际值；贷款、景气、住房和财政余额仍是模型路径。缺失信贷以 80%、债务以 60% GDP 占位，财政余额统一 −3% GDP。相同占位不能用于国家比较。外储起点 100 是相对指数定义，不表示各国储备相同。

家庭与银行压力现在根据历史失业、通胀、私人信贷/GDP 和模型风险参数构造不同初值，并在后续更新中保留这些结构锚点。公式是模型假设，不伪装为调查统计。通胀目标相近与均值回归仍可能导致指标趋同。

若下一轮补充数据，央行政策利率宜从 BIS/各央行取值，财政宜采用 IMF 一般政府口径，国际储备可查 IMF IFS/各央行；必须保留发布日期、统计期、单位、债务口径和修订版本。这里列的是后续来源建议，本版没有声称已下载它们。也不把 2026 汇率与 2023 宏观数据组合后称为“当前真实世界”。
