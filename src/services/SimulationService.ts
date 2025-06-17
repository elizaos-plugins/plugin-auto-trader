import { Service, AgentRuntime } from '@elizaos/core';
import { StrategyRegistryService } from './StrategyRegistryService.ts';
import { DefaultHistoricalDataService } from './HistoricalDataService.ts';
import { PerformanceReportingService } from './PerformanceReportingService.ts';
import {
  TradingStrategy,
  TradeOrder,
  Trade,
  PortfolioSnapshot,
  SimulationReport,
  StrategyContextMarketData,
  AgentState,
  OHLCV,
  TradeType,
} from '../types.ts';
import { v4 as uuidv4 } from 'uuid';

export interface SimulationParams {
  strategyName: string;
  pair: string;
  interval: string;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  transactionCostPercentage?: number;
  slippagePercentage?: number;
  dataSource?: string;
}

const DEFAULT_TRANSACTION_COST_PERCENTAGE = 0.001; // 0.1%
const DEFAULT_SLIPPAGE_PERCENTAGE = 0.0005; // 0.05%

// Simple portfolio tracker for simulations
class SimulationPortfolio {
  private cash: number;
  private holdings: Map<string, number> = new Map();
  private avgPrices: Map<string, number> = new Map();

  constructor(initialCash: number) {
    this.cash = initialCash;
  }

  getCash(): number {
    return this.cash;
  }

  getHolding(symbol: string): number {
    return this.holdings.get(symbol) || 0;
  }

  getAvgPrice(symbol: string): number {
    return this.avgPrices.get(symbol) || 0;
  }

  getTotalValue(prices: Map<string, number>): number {
    let total = this.cash;
    this.holdings.forEach((quantity, symbol) => {
      const price = prices.get(symbol) || this.avgPrices.get(symbol) || 0;
      total += quantity * price;
    });
    return total;
  }

  executeBuy(symbol: string, quantity: number, price: number, fees: number): boolean {
    const totalCost = quantity * price + fees;
    if (this.cash < totalCost) return false;

    this.cash -= totalCost;
    const currentHolding = this.holdings.get(symbol) || 0;
    const currentAvg = this.avgPrices.get(symbol) || 0;

    const newQuantity = currentHolding + quantity;
    const newAvg = (currentHolding * currentAvg + quantity * price) / newQuantity;

    this.holdings.set(symbol, newQuantity);
    this.avgPrices.set(symbol, newAvg);
    return true;
  }

  executeSell(symbol: string, quantity: number, price: number, fees: number): number | null {
    const currentHolding = this.holdings.get(symbol) || 0;
    if (currentHolding < quantity) return null;

    const avgPrice = this.avgPrices.get(symbol) || 0;
    const realizedPnl = quantity * (price - avgPrice);
    const proceeds = quantity * price - fees;

    this.cash += proceeds;
    const newQuantity = currentHolding - quantity;

    if (newQuantity === 0) {
      this.holdings.delete(symbol);
      this.avgPrices.delete(symbol);
    } else {
      this.holdings.set(symbol, newQuantity);
    }

    return realizedPnl;
  }

  getSnapshot(): { [symbol: string]: number } {
    const snapshot: { [symbol: string]: number } = {
      USDC: this.cash,
    };
    this.holdings.forEach((quantity, symbol) => {
      snapshot[symbol] = quantity;
    });
    return snapshot;
  }
}

export class SimulationService extends Service {
  public static readonly serviceType = 'SimulationService';
  public readonly capabilityDescription = 'Runs backtesting simulations for trading strategies';

  private strategyRegistry!: StrategyRegistryService;
  private historicalDataService!: DefaultHistoricalDataService;
  private performanceReportingService!: PerformanceReportingService;

  constructor(runtime: AgentRuntime) {
    super(runtime);
  }

  public static async start(runtime: AgentRuntime): Promise<SimulationService> {
    console.log(`[${SimulationService.serviceType}] Starting...`);
    const instance = new SimulationService(runtime);
    await instance.start();
    return instance;
  }

  public async start(): Promise<void> {
    console.log(`[${SimulationService.serviceType}] Resolving dependencies...`);

    this.strategyRegistry = this.runtime.getService(
      'StrategyRegistryService'
    ) as StrategyRegistryService;

    this.historicalDataService = this.runtime.getService(
      'HistoricalDataService'
    ) as DefaultHistoricalDataService;

    this.performanceReportingService = this.runtime.getService(
      'PerformanceReportingService'
    ) as PerformanceReportingService;

    if (
      !this.strategyRegistry ||
      !this.historicalDataService ||
      !this.performanceReportingService
    ) {
      throw new Error(`[${SimulationService.serviceType}] Failed to resolve dependencies`);
    }

    console.log(`[${SimulationService.serviceType}] Started successfully`);
  }

  public async stop(): Promise<void> {
    console.log(`[${SimulationService.serviceType}] Stopped`);
  }

  public async runBacktest(params: SimulationParams): Promise<SimulationReport> {
    const strategy = this.strategyRegistry.getStrategy(params.strategyName);
    if (!strategy) {
      throw new Error(`Strategy "${params.strategyName}" not found`);
    }

    // Initialize strategy if needed
    if (strategy.initialize) {
      await strategy.initialize(this.runtime);
    }

    // Fetch historical data
    const historicalData = await this.historicalDataService.fetchData(
      params.pair,
      params.interval,
      params.startDate,
      params.endDate,
      params.dataSource || 'mockSource'
    );

    if (!historicalData || historicalData.length === 0) {
      throw new Error('No historical data found for simulation');
    }

    // Initialize simulation state
    const portfolio = new SimulationPortfolio(params.initialCapital);
    const trades: Trade[] = [];
    const portfolioSnapshots: PortfolioSnapshot[] = [];

    const transactionCostRate =
      params.transactionCostPercentage ?? DEFAULT_TRANSACTION_COST_PERCENTAGE;
    const slippageRate = params.slippagePercentage ?? DEFAULT_SLIPPAGE_PERCENTAGE;

    // Add initial snapshot
    portfolioSnapshots.push({
      timestamp: params.startDate.getTime(),
      holdings: portfolio.getSnapshot(),
      totalValue: params.initialCapital,
    });

    // Run simulation
    for (let i = 0; i < historicalData.length; i++) {
      const candle = historicalData[i];
      const currentPrice = candle.close;

      // Prepare market data
      const marketData: StrategyContextMarketData = {
        currentPrice,
        lastPrices: historicalData.slice(Math.max(0, i - 50), i + 1).map((c) => c.close),
        priceData: historicalData.slice(0, i + 1),
      };

      // Prepare agent state
      const currentHolding = portfolio.getHolding(params.pair);
      const agentState: AgentState = {
        portfolioValue: portfolio.getTotalValue(new Map([[params.pair, currentPrice]])),
        volatility: this.calculateVolatility(marketData.lastPrices),
        confidenceLevel: 0.5,
        recentTrades: trades.filter(
          (t) => t.executedTimestamp > candle.timestamp - 86400000 // Last 24h
        ).length,
      };

      // Get current portfolio snapshot for strategy
      const currentSnapshot: PortfolioSnapshot = {
        timestamp: candle.timestamp,
        holdings: portfolio.getSnapshot(),
        totalValue: portfolio.getTotalValue(new Map([[params.pair, currentPrice]])),
      };

      // Get strategy decision
      const order = await strategy.decide({
        marketData,
        agentState,
        portfolioSnapshot: currentSnapshot,
        agentRuntime: this.runtime,
      });

      // Execute order if any
      if (order) {
        const slippage = currentPrice * slippageRate;
        const executedPrice =
          order.action === TradeType.BUY ? currentPrice + slippage : currentPrice - slippage;

        const fees = order.quantity * executedPrice * transactionCostRate;

        let success = false;
        let realizedPnl: number | undefined;

        if (order.action === TradeType.BUY) {
          success = portfolio.executeBuy(params.pair, order.quantity, executedPrice, fees);
        } else {
          const pnl = portfolio.executeSell(params.pair, order.quantity, executedPrice, fees);
          if (pnl !== null) {
            success = true;
            realizedPnl = pnl;
          }
        }

        if (success) {
          const trade: Trade = {
            ...order,
            executedPrice,
            executedTimestamp: candle.timestamp,
            fees,
            feeCurrency: 'USDC',
            tradeId: uuidv4(),
            realizedPnl,
          };
          trades.push(trade);
        }
      }

      // Record portfolio snapshot
      portfolioSnapshots.push({
        timestamp: candle.timestamp,
        holdings: portfolio.getSnapshot(),
        totalValue: portfolio.getTotalValue(new Map([[params.pair, currentPrice]])),
      });
    }

    // Calculate final metrics
    const finalValue = portfolioSnapshots[portfolioSnapshots.length - 1].totalValue;
    const metrics = this.performanceReportingService.generateMetrics(
      trades,
      portfolioSnapshots,
      params.initialCapital,
      finalValue,
      historicalData[0].open,
      historicalData[historicalData.length - 1].close
    );

    return {
      strategy: params.strategyName,
      pair: params.pair,
      startDate: params.startDate.getTime(),
      endDate: params.endDate.getTime(),
      trades,
      portfolioSnapshots,
      finalPortfolioValue: finalValue,
      metrics,
    };
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }
}
