import type { Economy, OpeningBrief, FxHistory } from '@fx/contracts';
import history from './data/fx-history.json' with { type: 'json' };

export const fxHistory = history as unknown as FxHistory;

/** Reconstruct a fictional lead-in from the actual opening state. No second price shock. */
export function openingBriefs(economies: Economy[]): OpeningBrief[] {
  const ranked = [...economies].sort((a, b) => b.importance - a.importance);
  const highestInflation = [...economies].sort((a, b) => b.inflation - a.inflation)[0];
  const selected = [...new Set([ranked[0], ranked[1], highestInflation, ranked[2], ranked[3]])];
  return selected.map((e, i) => {
    const inflationGap = e.inflation - e.macro.inflationTarget;
    const current = e.domestic.currentAccountGDP;
    const stories = [
      {
        title: `${e.name}企业重新评估融资计划`,
        description: `开场前的模拟企业讨论聚焦融资成本。本局贷款利率起点为 ${e.domestic.lendingRate.toFixed(2)}%，增长估计为 ${e.growth.toFixed(2)}%。这些是当前模型状态，企业可能据此调整投资。`,
        watch: '观察贷款利率 → 投资预期 → 就业与增长；不要只看名义利率。',
      },
      {
        title: `${e.name}进口商关注成本与海外需求`,
        description: `模拟背景中，进口商开始重估成本。历史进口/GDP 为 ${e.structure.importsGDP.toFixed(1)}%，出口/GDP 为 ${e.structure.exportsGDP.toFixed(1)}%。汇率、能源价格和贸易伙伴的增长会带来不同方向的压力。`,
        watch: '观察能源、进口成本与贸易伙伴需求，价格影响存在时滞。',
      },
      {
        title: `${e.name}物价讨论升温`,
        description: `本局通胀估计 ${e.inflation.toFixed(2)}%，相对模型目标 ${e.macro.inflationTarget.toFixed(1)}% 的差为 ${inflationGap.toFixed(2)} 个百分点。模拟家庭和企业据此调整预期；高通胀并不自动意味着加息或货币升值。`,
        watch: '下一次通胀调查与市场预期的差，可能比指标绝对高低更重要。',
      },
      {
        title: `${e.name}外贸企业讨论资金安排`,
        description: `本局经常账户起点为 GDP 的 ${current.toFixed(2)}%，对应${current >= 0 ? '顺差' : '逆差'}背景。模拟企业关注外部融资与收付款安排；经常账户不是单独决定汇率的信号。`,
        watch: '观察外部收支、风险溢价和资本流动是否同时改变。',
      },
      {
        title: `${e.name}家庭与银行调整风险预期`,
        description: `家庭偿债压力为 ${e.domestic.householdStress.toFixed(1)}/100，银行压力为 ${e.domestic.bankStress.toFixed(1)}/100。这些模型指数从就业、通胀和信贷结构估计，不是官方调查数据。`,
        watch: '观察信贷 → 房价与偿债压力 → 消费，短期改善未必马上反映在增长中。',
      },
    ];
    return {
      id: `opening-${e.currency}`,
      economy: e.currency,
      hoursBeforeStart: (i + 1) * 12,
      ...stories[i],
    };
  });
}
