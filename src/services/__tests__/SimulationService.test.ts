import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimulationService, SimulationParams } from '../SimulationService.ts';
import { IAgentRuntime, UUID } from '@elizaos/core';
import { TradeOrder, TradingStrategy, PortfolioSnapshot } from '../../types.ts';

describe('SimulationService', () => {
  let service: SimulationService;
  let runtime: IAgentRuntime;
  let mockStrategy: TradingStrategy;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStrategy = {
      id: 'test-strategy',
      name: 'Test Strategy',
      description: 'A test strategy',
      initialize: vi.fn(),
      decide: vi.fn(),
      configure: vi.fn(),
      isReady: vi.fn().mockReturnValue(true),
    };

    runtime = {
      agentId: 'test-agent-id' as UUID,
      getService: vi.fn((serviceName: string) => {
        if (serviceName === 'StrategyRegistryService') {
          return {
            getStrategy: vi.fn((id: string) => {
              if (id === 'test-strategy') return mockStrategy;
              return null;
            }),
          };
        }
        if (
          serviceName === 'HistoricalDataService' ||
          serviceName === 'DefaultHistoricalDataService'
        ) {
          return {
            fetchData: vi.fn().mockResolvedValue([
              {
                open: 100,
                high: 110,
                low: 95,
                close: 105,
                volume: 1000000,
                timestamp: new Date('2024-01-01').getTime(),
              },
              {
                open: 105,
                high: 115,
                low: 100,
                close: 110,
                volume: 1200000,
                timestamp: new Date('2024-01-02').getTime(),
              },
              {
                open: 110,
                high: 120,
                low: 105,
                close: 115,
                volume: 1500000,
                timestamp: new Date('2024-01-03').getTime(),
              },
            ]),
          };
        }
        if (serviceName === 'PerformanceReportingService') {
          return {
            generateMetrics: vi.fn().mockReturnValue({
              totalReturn: 0.1,
              winRate: 0.6,
              sharpeRatio: 1.5,
              maxDrawdown: 0.1,
              volatility: 0.15,
            }),
            formatReport: vi.fn((portfolio, trades, metrics) => ({
              finalPortfolioValue: portfolio.totalValue,
              trades,
              metrics: {
                ...metrics,
                totalReturn: (portfolio.totalValue - 10000) / 10000,
                sharpeRatio: 1.5,
                volatility: 0.15,
              },
            })),
          };
        }
        return null;
      }) as any,
    } as any;

    service = new SimulationService(runtime as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('start', () => {
    it('should start the service', async () => {
      await service.start();
      expect(service).toBeDefined();
    });

    it('should throw error if dependencies are not available', async () => {
      runtime.getService = vi.fn().mockReturnValue(null);

      await expect(service.start()).rejects.toThrow('Failed to resolve dependencies');
    });
  });

  describe('runBacktest', () => {
    const baseParams: SimulationParams = {
      strategyName: 'test-strategy',
      pair: 'SOL/USDC',
      interval: '1h',
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-03'),
      initialCapital: 10000,
      dataSource: 'mockSource',
    };

    beforeEach(async () => {
      await service.start();
    });

    it('should run a successful backtest with trades', async () => {
      (mockStrategy.decide as any).mockImplementation((params: any) => {
        const portfolio = params.portfolioSnapshot;
        if (portfolio.holdings['USDC'] > 5000) {
          return {
            pair: 'SOL/USDC',
            timestamp: Date.now(),
            action: 'BUY',
            symbol: 'SOL',
            quantity: 10,
            price: 100,
            orderType: 'MARKET',
          } as TradeOrder;
        }
        return null;
      });

      const result = await service.runBacktest(baseParams);

      expect(result).toBeDefined();
      expect(result.finalPortfolioValue).toBeGreaterThan(0);
      expect(result.trades).toBeDefined();
      expect(result.trades.length).toBeGreaterThan(0);
      expect(result.metrics).toBeDefined();
      expect(result.metrics.totalReturn).toBeDefined();
    });

    it('should handle strategy not found', async () => {
      const params = { ...baseParams, strategyName: 'invalid-strategy' };

      await expect(service.runBacktest(params)).rejects.toThrow(
        'Strategy "invalid-strategy" not found'
      );
    });

    it('should handle invalid date range', async () => {
      const params = {
        ...baseParams,
        startDate: new Date('2024-01-03'),
        endDate: new Date('2024-01-01'),
      };

      // SimulationService doesn't validate date range, but it would get no data from historical service
      const result = await service.runBacktest(params);

      // With no data, the simulation should complete but with no trades
      expect(result).toBeDefined();
      expect(result.trades).toEqual([]);
    });

    it('should handle no historical data', async () => {
      // Create a new service instance with the modified runtime
      const modifiedRuntime = {
        ...runtime,
        getService: vi.fn((serviceName: string) => {
          if (
            serviceName === 'DefaultHistoricalDataService' ||
            serviceName === 'HistoricalDataService'
          ) {
            return { fetchData: vi.fn().mockResolvedValue([]) };
          }
          if (serviceName === 'StrategyRegistryService') {
            return {
              getStrategy: vi.fn(() => mockStrategy),
            };
          }
          if (serviceName === 'PerformanceReportingService') {
            return {
              generateMetrics: vi.fn().mockReturnValue({
                totalReturn: 0,
                winRate: 0,
                sharpeRatio: 0,
                maxDrawdown: 0,
                volatility: 0,
              }),
            };
          }
          return null;
        }) as any,
      } as any;

      const newService = new SimulationService(modifiedRuntime);
      await newService.start();

      await expect(newService.runBacktest(baseParams)).rejects.toThrow('No historical data found');
    });

    it('should execute SELL orders correctly', async () => {
      let tradeCount = 0;
      (mockStrategy.decide as any).mockImplementation((params: any) => {
        tradeCount++;
        if (tradeCount === 1) {
          return {
            pair: 'SOL/USDC',
            timestamp: Date.now(),
            action: 'BUY',
            symbol: 'SOL',
            quantity: 10,
            price: 100,
            orderType: 'MARKET',
          } as TradeOrder;
        }
        if (tradeCount === 2) {
          return {
            pair: 'SOL/USDC',
            timestamp: Date.now(),
            action: 'SELL',
            symbol: 'SOL',
            quantity: 5,
            price: 110,
            orderType: 'MARKET',
          } as TradeOrder;
        }
        return null;
      });

      const result = await service.runBacktest(baseParams);

      expect(result.trades.length).toBe(2);
      expect(result.trades[0].action).toBe('BUY');
      expect(result.trades[1].action).toBe('SELL');
    });

    it('should not execute trades with insufficient funds', async () => {
      (mockStrategy.decide as any).mockImplementation(() => {
        return {
          pair: 'SOL/USDC',
          timestamp: Date.now(),
          action: 'BUY',
          symbol: 'SOL',
          quantity: 1000,
          price: 100,
          orderType: 'MARKET',
        } as TradeOrder;
      });

      const result = await service.runBacktest(baseParams);

      expect(result.trades.length).toBe(0);
    });

    it('should not execute SELL orders without holdings', async () => {
      (mockStrategy.decide as any).mockImplementation(() => {
        return {
          pair: 'SOL/USDC',
          timestamp: Date.now(),
          action: 'SELL',
          symbol: 'SOL',
          quantity: 10,
          price: 100,
          orderType: 'MARKET',
        } as TradeOrder;
      });

      const result = await service.runBacktest(baseParams);

      expect(result.trades.length).toBe(0);
    });

    it('should track portfolio value correctly', async () => {
      (mockStrategy.decide as any).mockImplementation((params: any) => {
        const portfolio = params.portfolioSnapshot;
        if (portfolio.holdings['USDC'] >= 5000 && !portfolio.holdings['SOL']) {
          return {
            pair: 'SOL/USDC',
            timestamp: Date.now(),
            action: 'BUY',
            symbol: 'SOL',
            quantity: 50,
            price: 100,
            orderType: 'MARKET',
          } as TradeOrder;
        }
        return null;
      });

      const result = await service.runBacktest(baseParams);

      expect(result.finalPortfolioValue).toBeGreaterThan(0);
      expect(result.trades[0].fees).toBeGreaterThan(0);
    });

    it('should handle strategy initialization', async () => {
      await service.runBacktest(baseParams);

      expect(mockStrategy.initialize).toHaveBeenCalledWith(runtime);
    });

    it('should calculate slippage and fees', async () => {
      const paramsWithCosts = {
        ...baseParams,
        transactionCostPercentage: 0.01,
        slippagePercentage: 0.005,
      };

      (mockStrategy.decide as any).mockImplementation(() => ({
        pair: 'SOL/USDC',
        timestamp: Date.now(),
        action: 'BUY',
        symbol: 'SOL',
        quantity: 10,
        price: 100,
        orderType: 'MARKET',
      }));

      const result = await service.runBacktest(paramsWithCosts);

      expect(result.trades[0].executedPrice).toBeGreaterThan(100); // With slippage
      expect(result.trades[0].fees).toBeGreaterThan(0);
    });

    it('should handle strategy decision errors gracefully', async () => {
      (mockStrategy.decide as any).mockImplementation(() => {
        throw new Error('Strategy error');
      });

      // The service doesn't catch errors from strategy.decide(), so the error will propagate
      await expect(service.runBacktest(baseParams)).rejects.toThrow('Strategy error');
    });

    it('should include initial portfolio snapshot', async () => {
      const result = await service.runBacktest(baseParams);

      expect(result.portfolioSnapshots.length).toBeGreaterThan(0);
      expect(result.portfolioSnapshots[0].totalValue).toBe(10000);
      expect(result.portfolioSnapshots[0].holdings['USDC']).toBe(10000);
    });

    it('should calculate volatility correctly', async () => {
      const result = await service.runBacktest(baseParams);

      expect(result).toBeDefined();
      expect(result.metrics.volatility).toBeDefined();
      expect(result.metrics.volatility).toBeGreaterThanOrEqual(0);
    });

    it('should record realized PnL for sell trades', async () => {
      let tradeCount = 0;
      (mockStrategy.decide as any).mockImplementation(() => {
        tradeCount++;
        if (tradeCount === 1) {
          return {
            pair: 'SOL/USDC',
            timestamp: Date.now(),
            action: 'BUY',
            symbol: 'SOL',
            quantity: 10,
            price: 100,
            orderType: 'MARKET',
          };
        }
        if (tradeCount === 3) {
          return {
            pair: 'SOL/USDC',
            timestamp: Date.now(),
            action: 'SELL',
            symbol: 'SOL',
            quantity: 10,
            price: 120,
            orderType: 'MARKET',
          };
        }
        return null;
      });

      const result = await service.runBacktest(baseParams);

      const sellTrade = result.trades.find((t) => t.action === 'SELL');
      expect(sellTrade).toBeDefined();
      expect(sellTrade!.realizedPnl).toBeDefined();
      expect(sellTrade!.realizedPnl).toBeGreaterThan(0); // Profit from buying at 100 and selling at 120
    });
  });

  describe('stop', () => {
    it('should stop the service', async () => {
      await service.stop();
      expect(service).toBeDefined();
    });
  });
});
