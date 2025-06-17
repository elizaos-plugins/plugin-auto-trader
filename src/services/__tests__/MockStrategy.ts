import {
  TradingStrategy,
  StrategyContextMarketData,
  AgentState,
  TradeOrder,
  PortfolioSnapshot,
} from '../../types.ts';
import { AgentRuntime } from '@elizaos/core';

/**
 * Mock implementation of TradingStrategy for testing purposes.
 */
export class MockStrategy implements TradingStrategy {
  private _isReady: boolean = true;

  constructor(
    public readonly id: string,
    public readonly name: string = 'Mock Strategy',
    public readonly description: string = 'A mock strategy',
    private configureError: Error | null = null,
    private executeLogic?: (
      marketData: StrategyContextMarketData,
      agentState: AgentState
    ) => Promise<TradeOrder | null>
  ) {}

  configure(params: any): void {
    if (this.configureError) {
      throw this.configureError;
    }
    // console.log(`MockStrategy ${this.id} configured with params:`, params);
  }

  async shouldExecute(
    marketData: StrategyContextMarketData,
    agentState: AgentState
  ): Promise<TradeOrder | null> {
    if (this.executeLogic) {
      return this.executeLogic(marketData, agentState);
    }
    // Default mock behavior: do nothing
    return null;
  }

  async decide(params: {
    marketData: StrategyContextMarketData;
    agentState: AgentState;
    portfolioSnapshot: PortfolioSnapshot;
    agentRuntime?: AgentRuntime;
  }): Promise<TradeOrder | null> {
    // For backward compatibility, call shouldExecute if it exists
    return this.shouldExecute(params.marketData, params.agentState);
  }

  async initialize(agentRuntime?: AgentRuntime): Promise<void> {
    // Mock initialization
    this._isReady = true;
  }

  isReady(): boolean {
    return this._isReady;
  }

  setReady(ready: boolean): void {
    this._isReady = ready;
  }
}
