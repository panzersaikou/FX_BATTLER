import { type BaselineProvider, type MarketBaseline } from '@fx/contracts';
import { historicalBaseline } from '@fx/simulation';

/** Offline, attributed historical snapshot; never silently mixed with API quotes. */
export class DemoBaselineProvider implements BaselineProvider {
  async load(): Promise<MarketBaseline> {
    return historicalBaseline();
  }
}
