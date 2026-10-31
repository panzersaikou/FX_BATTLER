import {
  proposalSchema,
  type ScenarioProvider,
  type AgentObservation,
  type Currency,
  type EventProposal,
  type EventTopic,
  type ScenarioContext,
  eventTopicLabels,
} from '@fx/contracts';
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const round = (n: number) => Number(n.toFixed(2));

/** State-aware offline director. No account data, direct price commands, or monetary rewards. */
export class LocalScenarioProvider implements ScenarioProvider {
  async propose(observation: AgentObservation, context: ScenarioContext): Promise<EventProposal> {
    const e = observation.economies.find((e) => e.currency === context.economy)!;
    if (context.suggestion) {
      const s = context.suggestion;
      const topic = s.topic;
      const bounds = {
        inflation: [-5, 100, 0.2],
        growth: [-5, 12, 0.2],
        industry: [25, 75, 0.6],
        credit: [-15, 90, 0.6],
        supply: [0, 100, 8],
        confidence: [5, 95, 6],
        energy: [40, 250, 12],
        fiscal: [-15, 8, 0.4],
      }[topic];
      const expected = round(eventExpectations(observation, e.currency)[topic]);
      const magnitude = bounds[2] * (s.strength === 'small' ? 0.3 : 0.65);
      const actual = round(
        clamp(expected + (s.direction === 'up' ? magnitude : -magnitude), bounds[0], bounds[1]),
      );
      if (actual === expected) throw new Error('当前指标已到边界，无法执行该方向的情景');
      return {
        economy: e.currency,
        kind: context.kind,
        topic,
        expected,
        actual,
        title: `${e.name}${eventTopicLabels[topic]}：人工情景${actual > expected ? '上调' : '下调'}`,
        description: `人工设定的模拟背景：${s.note}。本地导演按发生时的经济状态，将指标从 ${expected.toFixed(2)} 调整至 ${actual.toFixed(2)}；文字仅为情景说明，方向和幅度由结构化选项决定。这不是现实新闻，也不规定汇率涨跌。`,
      } as EventProposal;
    }
    const recent = observation.recentEvents.filter((event) => event.economy === e.currency);
    const shock = clamp(context.surprise, -0.45, 0.45);
    if (context.kind === 'report') {
      const topics = ['inflation', 'growth', 'industry', 'credit'] as const;
      const previous = recent.find((event) => event.kind === 'report')?.topic;
      const topic =
        topics[
          (previous
            ? topics.indexOf(previous as (typeof topics)[number]) + 1
            : Math.floor(observation.minute / 180)) % topics.length
        ];
      if (topic === 'industry' || topic === 'credit') {
        const expected = round(
          topic === 'industry' ? e.domestic.businessClimate : e.domestic.creditGrowth,
        );
        const signal =
          topic === 'industry'
            ? 0.2 * e.macro.foreignDemand - 0.015 * e.macro.supplyPressure
            : -0.015 * (e.domestic.bankStress - 15);
        const actual = round(
          clamp(
            expected + clamp(signal + shock, -0.6, 0.6),
            topic === 'industry' ? 25 : -15,
            topic === 'industry' ? 75 : 90,
          ),
        );
        return {
          economy: e.currency,
          kind: 'report',
          topic,
          expected,
          actual,
          title: `${e.name}${topic === 'industry' ? '工业景气' : '信贷条件'}调查：${actual > expected ? '改善' : actual < expected ? '走弱' : '持平'}`,
          description: `模拟调查由 ${expected.toFixed(2)} 调整为 ${actual.toFixed(2)}。贷款利率 ${e.domestic.lendingRate.toFixed(2)}%，家庭压力 ${e.domestic.householdStress.toFixed(1)}，伙伴需求差 ${e.macro.foreignDemand.toFixed(2)} pp。内部条件会通过投资与消费影响增长，报告不是官方统计。`,
        };
      }
      const expected = round(
        topic === 'inflation' ? e.macro.inflationExpectation : e.macro.growthExpectation,
      );
      const signal =
        topic === 'inflation' ? (e.inflation - expected) * 0.15 : (e.growth - expected) * 0.15;
      const actual = round(
        clamp(
          expected + clamp(signal + shock * 0.3, -0.2, 0.2),
          -5,
          topic === 'inflation' ? 100 : 12,
        ),
      );
      const label = topic === 'inflation' ? '通胀' : '增长';
      return {
        economy: e.currency,
        kind: 'report',
        topic,
        expected,
        actual,
        title: `${e.name}${label}预期调查：${actual.toFixed(2)}% · ${actual > expected ? '上修' : actual < expected ? '下修' : '持平'}`,
        description: `本次高频调查预期为 ${expected.toFixed(2)}%，结果为 ${actual.toFixed(2)}%。进口成本指数 ${e.macro.importCostIndex.toFixed(1)}，伙伴需求差 ${e.macro.foreignDemand.toFixed(2)} 个百分点。这是模拟预期调查，政策与实体经济仍按各自时滞变化。`,
      };
    }
    const previous = recent.find((event) => event.kind === 'surprise')?.topic;
    if (e.domestic.governmentDebtGDP > 75 && previous !== 'fiscal' && shock < 0) {
      const expected = round(e.domestic.fiscalBalanceGDP),
        actual = round(clamp(expected + shock * 0.7, -15, 8));
      return {
        economy: e.currency,
        kind: 'surprise',
        topic: 'fiscal',
        expected,
        actual,
        title: `${e.name}财政支出调整，预算压力变化`,
        description: `模拟财政余额从预期 ${expected.toFixed(2)}% GDP 变为 ${actual.toFixed(2)}%。支出变化先影响需求，债务和融资风险随后调整；这不是现实政府公告。`,
      };
    }
    let topic: 'supply' | 'energy' | 'confidence';
    if (e.macro.supplyPressure > 8 && previous !== 'supply') topic = 'supply';
    else if (
      (e.macro.energyImportExposure > 0.5 || e.macro.commodityExportExposure > 0.5) &&
      previous !== 'energy'
    )
      topic = 'energy';
    else topic = previous === 'confidence' ? 'supply' : 'confidence';
    if (topic === 'supply' && e.macro.supplyPressure < 1 && shock < 0) topic = 'confidence';
    const expected = round(
      topic === 'supply'
        ? e.macro.supplyPressure
        : topic === 'energy'
          ? observation.global.energyIndex
          : e.confidence * 100,
    );
    const scale = topic === 'energy' ? 20 : topic === 'supply' ? 15 : 10;
    const actual = round(
      clamp(
        expected + shock * scale,
        topic === 'energy' ? 40 : topic === 'confidence' ? 5 : 0,
        topic === 'energy' ? 250 : topic === 'confidence' ? 95 : 100,
      ),
    );
    const title =
      topic === 'energy'
        ? `能源市场${actual >= expected ? '趋紧' : '缓解'}：全球价格指数调整`
        : topic === 'supply'
          ? `${e.name}供应链${actual >= expected ? '压力上升' : '出现缓解'}`
          : `${e.name}市场信心${actual >= expected ? '改善' : '回落'}`;
    const path =
      topic === 'energy'
        ? '进口方成本与出口方收入会受到不同影响'
        : topic === 'supply'
          ? '供应成本先传导到进口价格，再影响通胀和增长'
          : '风险溢价与资金流向将逐步调整';
    return {
      economy: e.currency,
      kind: 'surprise',
      topic,
      expected,
      actual,
      title,
      description: `${title}，指数由预期 ${expected.toFixed(2)} 调整为 ${actual.toFixed(2)}。${path}。当前 ${e.name} 的政策利率为 ${e.policyRate.toFixed(2)}%，增长为 ${e.growth.toFixed(2)}%；市场仍面临其他共同冲击。`,
    };
  }
}
export function validateProposal(
  raw: unknown,
  observation: AgentObservation,
  target: Currency,
  kind: 'report' | 'surprise',
): EventProposal {
  const p = proposalSchema.parse(raw);
  if (p.topic === 'policy') throw new Error('Agent 不能提前执行央行决议');
  if (p.economy !== target || p.kind !== kind) throw new Error('事件目标与排程不一致');
  const e = observation.economies.find((e) => e.currency === p.economy);
  if (!e) throw new Error('不存在的经济体');
  const expected = eventExpectations(observation, p.economy);
  const limits: Record<EventTopic, number> = {
    inflation: 0.2,
    growth: 0.2,
    supply: 8,
    confidence: 6,
    energy: 12,
    policy: 0.5,
    industry: 0.6,
    credit: 0.6,
    fiscal: 0.4,
  };
  if (Math.abs(p.expected - expected[p.topic]) > 0.011)
    throw new Error('事件预期与当前经济状态不一致');
  if (Math.abs(p.actual - p.expected) > limits[p.topic] + 0.011)
    throw new Error('事件变化超出情景边界');
  return p;
}
export function eventExpectations(
  observation: AgentObservation,
  currency: Currency,
): Record<EventTopic, number> {
  const e = observation.economies.find((e) => e.currency === currency)!;
  return {
    inflation: e.macro.inflationExpectation,
    growth: e.macro.growthExpectation,
    supply: e.macro.supplyPressure,
    confidence: e.confidence * 100,
    energy: observation.global.energyIndex,
    policy: e.expectedRate,
    industry: e.domestic.businessClimate,
    credit: e.domestic.creditGrowth,
    fiscal: e.domestic.fiscalBalanceGDP,
  };
}

export {
  AgentFailure,
  agentErrorMessages,
  validateDecision,
  buildAgentMessages,
  decisionJsonSchema,
} from './protocol';
