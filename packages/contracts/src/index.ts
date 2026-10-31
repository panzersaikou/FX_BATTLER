import { z } from 'zod';

export const currencies = [
  'USD',
  'EUR',
  'JPY',
  'GBP',
  'CHF',
  'CAD',
  'AUD',
  'NZD',
  'MXN',
  'CNY',
  'INR',
  'KRW',
  'SGD',
  'IDR',
  'THB',
  'MYR',
  'PHP',
  'VND',
  'BRL',
  'CLP',
  'COP',
  'PEN',
  'ZAR',
  'TRY',
  'PLN',
  'CZK',
  'HUF',
  'SEK',
  'NOK',
  'DKK',
] as const;
export type Currency = (typeof currencies)[number];
export const simulationSpeeds = [1, 5, 15, 60, 300] as const;
export type SimulationSpeed = (typeof simulationSpeeds)[number];
export const controlSchema = z
  .object({
    running: z.boolean().optional(),
    speed: z
      .union([z.literal(1), z.literal(5), z.literal(15), z.literal(60), z.literal(300)])
      .optional(),
    step: z.literal(60).optional(),
  })
  .strict();
export type ClockControl = z.infer<typeof controlSchema>;
export type Pair = `${Currency}/${Currency}`;
export const currencySchema = z.enum(currencies);
export const pairSchema = z.string().refine((s): s is Pair => {
  const p = s.split('/');
  return (
    p.length === 2 && p[0] !== p[1] && p.every((c) => (currencies as readonly string[]).includes(c))
  );
}, '请选择受支持的货币对');
export const orderSchema = z
  .object({
    requestId: z.string().uuid(),
    pair: pairSchema,
    side: z.enum(['buy', 'sell']),
    units: z.number().int().min(100).max(100_000),
    leverage: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(20)]),
  })
  .strict();
export type OrderRequest = z.infer<typeof orderSchema>;
export interface Economy {
  currency: Currency;
  name: string;
  region: string;
  flag: string;
  usdValue: number;
  initialUsdValue: number;
  inflation: number;
  growth: number;
  policyRate: number;
  expectedRate: number;
  confidence: number;
  stress: number;
  importance: number;
  dailyVol: number;
  riskLoading: number;
  spreadBps: number;
  macro: EconomyMacro;
  structure: EconomyStructure;
  domestic: DomesticState;
  baseline: { year: number; facts: EconomicFact[]; opening: Record<string, number> };
}
export interface EconomicFact {
  key: string;
  label: string;
  unit: string;
  value: number;
  kind: 'observed' | 'derived' | 'assumption';
  sourceId: string | null;
}
export interface EconomyStructure {
  regime: 'floating' | 'managed' | 'eur-band';
  specialization: string;
  gdpUsd: number;
  population: number;
  exportsGDP: number;
  importsGDP: number;
  investmentGDP: number;
  creditGDP: number;
  baseRiskPremium: number;
}
export interface DomesticReading {
  minute: number;
  growth: number;
  inflation: number;
  unemployment: number;
  consumptionGrowth: number;
  investmentGrowth: number;
  businessClimate: number;
  creditGrowth: number;
  housingGrowth: number;
  bankStress: number;
}
export interface DomesticState {
  consumptionGrowth: number;
  investmentGrowth: number;
  businessClimate: number;
  wageGrowth: number;
  creditGrowth: number;
  lendingRate: number;
  housingGrowth: number;
  householdStress: number;
  bankStress: number;
  fiscalBalanceGDP: number;
  governmentDebtGDP: number;
  currentAccountGDP: number;
  reserveBuffer: number;
  lastUpdateMinute: number;
  nextBriefMinute: number;
  brief: string;
  drivers: string[];
  history: DomesticReading[];
}
export interface BaselineDataset {
  version: string;
  year: number;
  retrievedOn: string;
  description: string;
  sources: Record<
    string,
    {
      indicator: string;
      publisher: string;
      url: string;
      mirror: string;
      sha256: string;
      license: string;
    }
  >;
}
export interface EconomyMacro {
  inflationExpectation: number;
  growthExpectation: number;
  potentialGrowth: number;
  inflationTarget: number;
  neutralRealRate: number;
  unemployment: number;
  baselineUnemployment: number;
  importCostIndex: number;
  supplyPressure: number;
  demandImpulse: number;
  foreignDemand: number;
  tradeBalanceIndex: number;
  capitalFlowIndex: number;
  riskPremium: number;
  importExposure: number;
  energyImportExposure: number;
  commodityExportExposure: number;
  nextPolicyMinute: number;
}
export interface TradeLink {
  importer: Currency;
  partner: Currency;
  weight: number;
}
export interface Transmission {
  id: string;
  minute: number;
  economy: Currency;
  channel: 'imports' | 'inflation' | 'growth' | 'policy' | 'capital' | 'labor' | 'trade' | 'event';
  before: number;
  after: number;
  unit: string;
  summary: string;
}
export interface MacroWorld {
  energyIndex: number;
  riskAversion: number;
  lastUpdateMinute: number;
  history: Transmission[];
}
const eventBase = {
  economy: currencySchema,
  title: z.string().min(3).max(90),
  description: z.string().min(10).max(500),
};
const indicator = (min: number, max: number) => ({
  expected: z.number().min(min).max(max),
  actual: z.number().min(min).max(max),
});
export const proposalSchema = z.discriminatedUnion('topic', [
  z
    .object({
      ...eventBase,
      topic: z.literal('inflation'),
      kind: z.literal('report'),
      ...indicator(-5, 100),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      topic: z.literal('growth'),
      kind: z.literal('report'),
      ...indicator(-5, 12),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      topic: z.literal('supply'),
      kind: z.literal('surprise'),
      ...indicator(0, 100),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      topic: z.literal('industry'),
      kind: z.literal('report'),
      ...indicator(25, 75),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      topic: z.literal('credit'),
      kind: z.literal('report'),
      ...indicator(-15, 90),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      topic: z.literal('fiscal'),
      kind: z.literal('surprise'),
      ...indicator(-15, 8),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      topic: z.literal('confidence'),
      kind: z.literal('surprise'),
      ...indicator(5, 95),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      topic: z.literal('energy'),
      kind: z.literal('surprise'),
      ...indicator(40, 250),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      topic: z.literal('policy'),
      kind: z.literal('policy'),
      ...indicator(-1, 100),
    })
    .strict(),
]);
export type EventProposal = z.infer<typeof proposalSchema>;
export type EventTopic = EventProposal['topic'];
export const eventTopicLabels: Record<EventTopic, string> = {
  inflation: '通胀预期调查',
  growth: '增长预期调查',
  supply: '供应链',
  confidence: '市场信心',
  energy: '能源价格',
  policy: '央行决议',
  industry: '工业景气调查',
  credit: '信贷条件调查',
  fiscal: '财政支出变化',
};
export type MarketEvent = EventProposal & {
  id: string;
  minute: number;
  importance: 'high' | 'medium' | 'low';
  effects: string[];
  origin?: 'director' | 'user-directed';
  suggestionId?: string;
  generator?: 'local' | 'external' | 'fallback';
  agentJobId?: string;
};
export interface OpeningBrief {
  id: string;
  economy: Currency;
  hoursBeforeStart: number;
  title: string;
  description: string;
  watch: string;
}
export const suggestionSchema = z
  .object({
    requestId: z.string().uuid(),
    economy: currencySchema,
    topic: z.enum([
      'inflation',
      'growth',
      'industry',
      'credit',
      'supply',
      'confidence',
      'energy',
      'fiscal',
    ]),
    direction: z.enum(['up', 'down']),
    strength: z.enum(['small', 'moderate']),
    delayMinutes: z.union([z.literal(60), z.literal(180), z.literal(360)]),
    note: z.string().trim().min(5).max(240),
  })
  .strict();
export type EventSuggestionInput = z.infer<typeof suggestionSchema>;
export interface EventSuggestion extends EventSuggestionInput {
  id: string;
  submittedAt: number;
  dueAt: number;
  status: 'queued' | 'generating' | 'applied' | 'rejected' | 'cancelled';
  reason: string;
  eventId?: string;
}
export interface FxHistory {
  version: string;
  requestedStart: string;
  requestedEnd: string;
  latestObservation: string;
  retrievedOn: string;
  publisher: string;
  sourceUrl: string;
  sha256: string;
  missing: string[];
  series: Record<string, { seriesId: string; sourceUrl: string; points: [string, number][] }>;
}
export interface Candle {
  minute: number;
  open: number;
  high: number;
  low: number;
  close: number;
}
export interface Quote {
  pair: Pair;
  mid: number;
  bid: number;
  ask: number;
  changePct: number;
  spreadBps: number;
}
export interface Position {
  id: string;
  pair: Pair;
  side: 'buy' | 'sell';
  units: number;
  leverage: number;
  entry: number;
  margin: number;
  openedAt: number;
  entryFee: number;
}
export interface ValuedPosition extends Position {
  pnl: number;
  mark: number;
}
export interface Fill {
  id: string;
  positionId: string;
  pair: Pair;
  action: 'open' | 'close' | 'liquidation';
  side: 'buy' | 'sell';
  units: number;
  price: number;
  fee: number;
  pnl: number;
  minute: number;
}
export interface Account {
  initialBalance: number;
  balance: number;
  positions: Position[];
  fills: Fill[];
}
export interface AccountView extends Omit<Account, 'positions'> {
  positions: ValuedPosition[];
  equity: number;
  unrealized: number;
  usedMargin: number;
  freeMargin: number;
  marginLevel: number | null;
  feesPaid: number;
}
export interface AgentStatus {
  mode: 'local' | 'external';
  availability: 'unconfigured' | 'configured' | 'offline';
  configurationMessage: string;
  phase: 'observing' | 'generating' | 'ready' | 'published' | 'fallback' | 'rejected';
  lastRun: number | null;
  nextReport: number;
  accepted: number;
  rejected: number;
  summary: string;
  externalAccepted: number;
  fallbacks: number;
  jobs: AgentJob[];
}
export const agentControlSchema = z.object({ mode: z.enum(['local', 'external']) }).strict();
export interface AgentJob {
  id: string;
  economy: Currency;
  kind: 'report' | 'surprise';
  createdMinute: number;
  status: 'queued' | 'generating' | 'ready' | 'applied' | 'fallback' | 'rejected' | 'cancelled';
  suggestionId?: string;
  eventId?: string;
  reason: string;
}
export type AgentDecision =
  | { decision: 'publish'; event: EventProposal; reason: string }
  | { decision: 'reject'; event: null; reason: string };
export interface AgentProvider {
  generate(
    observation: AgentObservation,
    context: ScenarioContext,
    signal: AbortSignal,
  ): Promise<AgentDecision>;
}
export interface Snapshot {
  sessionId: string;
  revision: number;
  minute: number;
  running: boolean;
  speed: SimulationSpeed;
  source: BaselineSource;
  baselineDataset: BaselineDataset;
  quotes: Quote[];
  chartPair: Pair;
  candles: Candle[];
  economies: Economy[];
  events: MarketEvent[];
  openingBriefs: OpeningBrief[];
  suggestions: EventSuggestion[];
  macro: MacroWorld;
  tradeLinks: TradeLink[];
  account: AccountView;
  agent: AgentStatus;
}
export type BaselineMode = 'historical' | 'demo' | 'reference';
export const sessionCreateSchema = z
  .object({ baseline: z.enum(['historical', 'demo', 'reference']).optional() })
  .strict();
export interface ReferenceQuote {
  currency: Exclude<Currency, 'USD'>;
  symbol: Pair;
  close: number;
  usdValue: number;
  asOf: string;
}
export interface ReferenceDetails {
  provider: 'twelve-data';
  interval: '1min';
  fetchedAt: string;
  selectedAt: string;
  ageAtStartSeconds: number;
  delivery: 'downloaded' | 'cache' | 'fallback';
  staleAtStart: boolean;
  warnings: string[];
  quotes: ReferenceQuote[];
}
type BaselineProvenance =
  | { kind: 'demo'; asOf: null }
  | { kind: 'historical'; asOf: null; dataset: string; year: number }
  | { kind: 'reference'; asOf: string; reference: ReferenceDetails };
export type BaselineSource = BaselineProvenance & { label: string };
/** USD per currency unit; USD is exactly 1. No credentials in this contract. */
export type MarketBaseline = BaselineProvenance & {
  rates: Partial<Record<Currency, number>>;
  roster?: readonly Currency[];
};
export interface BaselineStatus {
  referenceAvailable: boolean;
  defaultMode: BaselineMode;
  message: string;
}
export interface BaselineProvider {
  load(): Promise<MarketBaseline>;
}
/** No account/positions or future simulation randomness is exposed to a narrative provider. */
export interface AgentObservation {
  minute: number;
  economies: readonly Economy[];
  recentEvents: readonly MarketEvent[];
  openingBriefs?: readonly OpeningBrief[];
  global: Pick<MacroWorld, 'energyIndex' | 'riskAversion'>;
  tradeLinks: readonly TradeLink[];
}
export interface ScenarioProvider {
  propose(observation: AgentObservation, context: ScenarioContext): Promise<unknown>;
}
export interface ScenarioContext {
  kind: 'report' | 'surprise';
  economy: Currency;
  surprise: number;
  /** Player-authored scenario idea, not an instruction to set prices or target an account. */
  suggestion?: EventSuggestionInput;
}
