import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PerformanceReportingService } from '../PerformanceReportingService.ts';
import { AgentRuntime, Service } from '@elizaos/core';
import {
  Trade,
  PortfolioSnapshot,
  PerformanceMetrics,
  SimulationReport,
  TradeType,
  OrderType,
} from '../../types.ts';
import { IAgentRuntime, UUID } from '@elizaos/core';

const MOCK_PAIR = 'TEST/USD';

// Minimal mock AgentRuntime for service instantiation
const createMockRuntime = (): AgentRuntime => {
  return {
    getService: vi.fn(),
    registerService: vi.fn(),
    config: new Map(),
    // Add other essential AgentRuntime properties if constructor or methods rely on them
  } as any as AgentRuntime;
};

describe('PerformanceReportingService', () => {
  let service: PerformanceReportingService;
  let sampleTrades: Trade[];
  let samplePortfolioHistory: PortfolioSnapshot[];
  const initialCapital = 10000;
  let finalCapital = 10000;
  let firstAssetPrice: number | undefined;
  let lastAssetPrice: number | undefined;
  let mockRuntime: AgentRuntime;
  let runtime: IAgentRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntime = createMockRuntime();
    service = new PerformanceReportingService(mockRuntime);
    vi.spyOn(Math, 'random').mockRestore(); // Ensure Math.random is not mocked from other tests

    // Trades with explicit realizedPnl
    sampleTrades = [
      {
        tradeId: 'trade1',
        pair: MOCK_PAIR,
        action: TradeType.SELL,
        quantity: 5,
        orderType: OrderType.MARKET,
        timestamp: Date.now() - 1001,
        executedPrice: 110,
        executedTimestamp: Date.now() - 1000,
        fees: 0.5,
        realizedPnl: 49.5, // Win (e.g. sold 5 units bought at 100 for 110, pnl = (110-100)*5 - 0.5 = 50 - 0.5 = 49.5)
      },
      {
        tradeId: 'trade2',
        pair: MOCK_PAIR,
        action: TradeType.SELL,
        quantity: 10,
        orderType: OrderType.MARKET,
        timestamp: Date.now() - 1,
        executedPrice: 90,
        executedTimestamp: Date.now(),
        fees: 0.7,
        realizedPnl: -100.7, // Loss (e.g. sold 10 units bought at 100 for 90, pnl = (90-100)*10 - 0.7 = -100 - 0.7 = -100.7)
      },
      {
        tradeId: 'trade3',
        pair: MOCK_PAIR,
        action: TradeType.BUY,
        quantity: 2,
        orderType: OrderType.LIMIT,
        price: 95,
        timestamp: Date.now() - 501,
        executedPrice: 95,
        executedTimestamp: Date.now() - 500,
        fees: 0.2,
        realizedPnl: undefined, // BUYs don't have realizedPnl until sold
      },
      {
        tradeId: 'trade4',
        pair: MOCK_PAIR,
        action: TradeType.SELL,
        quantity: 2,
        orderType: OrderType.MARKET,
        timestamp: Date.now() - 201,
        executedPrice: 105,
        executedTimestamp: Date.now() - 200,
        fees: 0.2,
        realizedPnl: 19.8, // Win (e.g. sold 2 units bought at 95 for 105, pnl = (105-95)*2 - 0.2 = 20 - 0.2 = 19.8)
      },
      {
        tradeId: 'trade5',
        pair: MOCK_PAIR,
        action: TradeType.SELL,
        quantity: 1,
        orderType: OrderType.MARKET,
        timestamp: Date.now() - 101,
        executedPrice: 90,
        executedTimestamp: Date.now() - 100,
        fees: 0.1,
        realizedPnl: 0, // Break-even trade (e.g. PnL exactly offset by fees)
      },
    ];

    samplePortfolioHistory = [
      {
        timestamp: Date.now() - 3000,
        totalValue: 10000,
        holdings: {},
      },
      { timestamp: Date.now(), totalValue: 9968.4, holdings: {} }, // Example final state
    ];
    finalCapital = samplePortfolioHistory[samplePortfolioHistory.length - 1].totalValue;
    firstAssetPrice = 100; // Example for Buy & Hold
    lastAssetPrice = 98; // Example for Buy & Hold

    runtime = {
      agentId: 'test-agent-id' as UUID,
      getService: vi.fn(),
    } as any;

    service = new PerformanceReportingService(runtime as any);
  });

  describe('static start', () => {
    it('should create and return a new instance', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const instance = await PerformanceReportingService.start(runtime as any);

      expect(instance).toBeInstanceOf(PerformanceReportingService);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('static start called'));
    });
  });

  describe('instance start', () => {
    it('should log start message', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await service.start();

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('instance start called'));
    });
  });

  describe('instance stop', () => {
    it('should log stop message', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await service.stop();

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('instance stop called'));
    });
  });

  describe('generateMetrics', () => {
    it('should calculate total P&L correctly', () => {
      const metrics = service.generateMetrics(
        sampleTrades,
        samplePortfolioHistory,
        initialCapital,
        finalCapital,
        firstAssetPrice,
        lastAssetPrice
      );
      expect(metrics.totalPnlAbsolute).toBe(parseFloat((finalCapital - initialCapital).toFixed(4)));
      expect(metrics.totalPnlPercentage).toBe(
        parseFloat(((finalCapital - initialCapital) / initialCapital).toFixed(4))
      );
    });

    it('should calculate total trades', () => {
      const metrics = service.generateMetrics(
        sampleTrades,
        samplePortfolioHistory,
        initialCapital,
        finalCapital
      );
      expect(metrics.totalTrades).toBe(sampleTrades.length);
    });

    it('should calculate win/loss ratio and averages based on trade.realizedPnl', () => {
      const metrics = service.generateMetrics(
        sampleTrades,
        samplePortfolioHistory,
        initialCapital,
        finalCapital
      );
      // Wins: trade1 (49.5), trade4 (19.8) = 2 wins
      // Losses: trade2 (-100.7) = 1 loss
      // Trade3 is a BUY, no realizedPnl.
      // Trade5 is break-even (realizedPnl=0), not counted as win or loss.
      expect(metrics.winningTrades).toBe(2);
      expect(metrics.losingTrades).toBe(1);
      expect(metrics.winLossRatio).toBe(parseFloat((2 / 1).toFixed(4)));

      const expectedTotalProfitFromWins = 49.5 + 19.8; // 69.3
      const expectedTotalLossFromLosses = 100.7;

      expect(metrics.averageWinAmount).toBe(
        parseFloat((expectedTotalProfitFromWins / 2).toFixed(4))
      );
      expect(metrics.averageLossAmount).toBe(
        parseFloat((expectedTotalLossFromLosses / 1).toFixed(4))
      );
    });

    it('should calculate buyAndHoldPnlPercentage correctly if prices provided', () => {
      const metrics = service.generateMetrics([], [], initialCapital, finalCapital, 100, 150);
      expect(metrics.buyAndHoldPnlPercentage).toBe(parseFloat(((150 - 100) / 100).toFixed(4))); // 0.5000
      expect(metrics.firstAssetPrice).toBe(100);
      expect(metrics.lastAssetPrice).toBe(150);
    });

    it('should have undefined buyAndHoldPnlPercentage if prices are missing or invalid', () => {
      let metrics = service.generateMetrics([], [], initialCapital, finalCapital, undefined, 150);
      expect(metrics.buyAndHoldPnlPercentage).toBeUndefined();
      metrics = service.generateMetrics([], [], initialCapital, finalCapital, 100, undefined);
      expect(metrics.buyAndHoldPnlPercentage).toBeUndefined();
      metrics = service.generateMetrics([], [], initialCapital, finalCapital, 0, 150); // Invalid first price
      expect(metrics.buyAndHoldPnlPercentage).toBeUndefined();
    });

    it('should calculate max drawdown correctly', () => {
      const history: PortfolioSnapshot[] = [
        { timestamp: 1, totalValue: 10000, holdings: {} },
        { timestamp: 2, totalValue: 9500, holdings: {} },
        { timestamp: 3, totalValue: 10200, holdings: {} },
        { timestamp: 4, totalValue: 9000, holdings: {} },
        { timestamp: 5, totalValue: 9800, holdings: {} },
      ];
      const metrics = service.generateMetrics([], history, 10000, 9800, 100, 98);
      expect(metrics.maxDrawdown).toBe(parseFloat(((10200 - 9000) / 10200).toFixed(4))); // 0.1176
    });

    it('max drawdown should be 0 if no losses or only gains', () => {
      const historyGain: PortfolioSnapshot[] = [
        { timestamp: 1, totalValue: 10000, holdings: {} },
        { timestamp: 2, totalValue: 10500, holdings: {} },
        { timestamp: 3, totalValue: 10200, holdings: {} }, // slight dip but still > initial peak for this calc if peak reset
        // current calc always uses highest peak seen so far
        { timestamp: 4, totalValue: 11000, holdings: {} },
      ];
      // Max drawdown calculation logic: peak = 10000 -> 9500 (dd=0.05) | peak=10200 -> 9000 (dd=0.1176)
      // If history[2].totalValue was 10500 (no dip below prior peak of 10500), then drawdown would be 0 from that peak
      // For the historyGain, peak goes 10000, 10500, 10500 (value 10200, dd=(10500-10200)/10500 = 0.0285), 11000
      // So max drawdown for historyGain will be approx 0.0285
      const metricsGain = service.generateMetrics([], historyGain, 10000, 11000, 100, 110);
      expect(metricsGain.maxDrawdown).toBe(parseFloat(((10500 - 10200) / 10500).toFixed(4))); // 0.0286 after rounding .2857

      const historyNoLoss: PortfolioSnapshot[] = [
        { timestamp: 1, totalValue: 10000, holdings: {} },
        { timestamp: 2, totalValue: 10500, holdings: {} },
        { timestamp: 3, totalValue: 11000, holdings: {} },
      ];
      const metricsNoLoss = service.generateMetrics([], historyNoLoss, 10000, 11000, 100, 110);
      expect(metricsNoLoss.maxDrawdown).toBe(0);
    });

    it('should handle zero losing trades for winLossRatio (Infinity or 0)', () => {
      const winningTradesOnly: Trade[] = sampleTrades.filter(
        (t) => t.realizedPnl !== undefined && t.realizedPnl >= 0
      );
      const metrics = service.generateMetrics(
        winningTradesOnly,
        samplePortfolioHistory,
        initialCapital,
        finalCapital
      );
      // Based on current sampleTrades, trade1(win), trade4(win), trade5(breakeven)
      expect(metrics.winningTrades).toBe(2);
      expect(metrics.losingTrades).toBe(0);
      expect(metrics.winLossRatio).toBe(Infinity);

      const metricsNoTrades = service.generateMetrics([], [], initialCapital, initialCapital);
      expect(metricsNoTrades.winLossRatio).toBe(0);
    });

    it('should set Sharpe and Sortino ratios to undefined (placeholder)', () => {
      const metrics = service.generateMetrics(
        sampleTrades,
        samplePortfolioHistory,
        initialCapital,
        finalCapital
      );
      expect(metrics.sharpeRatio).toBeUndefined();
      expect(metrics.sortinoRatio).toBeUndefined();
    });

    it('should calculate sharpe ratio when portfolio has multiple snapshots', () => {
      const portfolioWithReturns: PortfolioSnapshot[] = [
        { timestamp: Date.now(), totalValue: 10000, holdings: {} },
        { timestamp: Date.now() + 1000, totalValue: 10100, holdings: {} },
        { timestamp: Date.now() + 2000, totalValue: 10050, holdings: {} },
        { timestamp: Date.now() + 3000, totalValue: 10200, holdings: {} },
      ];

      const metrics = service.generateMetrics([], portfolioWithReturns, 10000, 10200);

      expect(metrics.sharpeRatio).toBeDefined();
      expect(typeof metrics.sharpeRatio).toBe('number');
    });

    it('should handle empty portfolio history', () => {
      const metrics = service.generateMetrics([], [], 10000, 10000);

      expect(metrics.maxDrawdown).toBe(0);
      expect(metrics.sharpeRatio).toBeUndefined();
    });

    it('should handle single portfolio snapshot', () => {
      const metrics = service.generateMetrics(
        [],
        [{ timestamp: Date.now(), totalValue: 10000, holdings: {} }],
        10000,
        10000
      );

      expect(metrics.maxDrawdown).toBe(0);
      expect(metrics.sharpeRatio).toBeUndefined();
    });

    it('should handle portfolio with zero values correctly', () => {
      const portfolioWithZero: PortfolioSnapshot[] = [
        { timestamp: Date.now(), totalValue: 10000, holdings: {} },
        { timestamp: Date.now() + 1000, totalValue: 0, holdings: {} },
        { timestamp: Date.now() + 2000, totalValue: 5000, holdings: {} },
      ];

      const metrics = service.generateMetrics([], portfolioWithZero, 10000, 5000);

      expect(metrics.maxDrawdown).toBe(1); // 100% drawdown when value goes to 0
    });

    it('should handle trades with undefined realizedPnl', () => {
      const tradesWithUndefinedPnl: Trade[] = [
        {
          timestamp: Date.now(),
          pair: 'SOL/USD',
          action: TradeType.BUY,
          quantity: 10,
          orderType: OrderType.MARKET,
          executedPrice: 100,
          executedTimestamp: Date.now(),
          fees: 0.1,
          realizedPnl: undefined,
        },
        {
          timestamp: Date.now() + 1000,
          pair: 'SOL/USD',
          action: TradeType.SELL,
          quantity: 10,
          orderType: OrderType.MARKET,
          executedPrice: 105,
          executedTimestamp: Date.now() + 1000,
          fees: 0.1,
          realizedPnl: 50,
        },
      ];

      const metrics = service.generateMetrics(
        tradesWithUndefinedPnl,
        samplePortfolioHistory,
        10000,
        11000
      );

      expect(metrics.winningTrades).toBe(1);
      expect(metrics.losingTrades).toBe(0);
      expect(metrics.totalTrades).toBe(2);
    });

    it('should handle initial capital of zero', () => {
      const metrics = service.generateMetrics([], samplePortfolioHistory, 0, 1000);

      expect(metrics.totalPnlPercentage).toBe(0);
    });
  });

  describe('formatReport', () => {
    it('should correctly assemble the SimulationReport', () => {
      const metricsContent: PerformanceMetrics = {
        totalPnlAbsolute: 100,
        totalPnlPercentage: 0.01,
        winLossRatio: 1,
        maxDrawdown: 0.05,
        totalTrades: 10,
        winningTrades: 5,
        losingTrades: 5,
        averageWinAmount: 20,
        averageLossAmount: 10,
        firstAssetPrice: 100,
        lastAssetPrice: 101,
        buyAndHoldPnlPercentage: 0.01,
      };
      const simId = 'sim-123';
      const stratId = 'strat-abc';
      const stratParams = { param: 'val' };
      const sym = 'BTC/USD';
      const tf = '1d';
      const start = new Date().toISOString();
      const end = new Date().toISOString();
      const initCap = 100000;
      const finalCap = 101000;

      const report = service.formatReport(
        simId,
        stratId,
        stratParams,
        sym,
        tf,
        start,
        end,
        initCap,
        finalCap,
        metricsContent,
        sampleTrades,
        samplePortfolioHistory
      );

      expect(report).toEqual({
        strategy: stratId,
        pair: sym,
        startDate: new Date(start).getTime(),
        endDate: new Date(end).getTime(),
        trades: sampleTrades,
        portfolioSnapshots: samplePortfolioHistory,
        finalPortfolioValue: finalCap,
        metrics: metricsContent,
      });
    });
  });
});
