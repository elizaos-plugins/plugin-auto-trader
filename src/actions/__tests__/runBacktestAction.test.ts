import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBacktestAction } from '../runBacktestAction.ts';
import { IAgentRuntime, Memory, State, HandlerCallback, Content } from '@elizaos/core';

describe('runBacktestAction', () => {
  let runtime: IAgentRuntime;
  let message: Memory;
  let state: State;
  let callbackResult: Content | null;
  let callback: HandlerCallback;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    callbackResult = null;

    // Mock callback
    callback = vi.fn(async (content: Content) => {
      callbackResult = content;
      return [];
    }) as HandlerCallback;

    // Mock runtime with all required services
    runtime = {
      getService: vi.fn((serviceName: string) => {
        if (serviceName === 'StrategyRegistryService') {
          return {
            getStrategy: vi.fn((id: string) => {
              if (id === 'random-v1') {
                return {
                  id: 'random-v1',
                  name: 'Random Strategy',
                  description: 'A random strategy',
                };
              }
              if (id === 'rule-based-v1') {
                return {
                  id: 'rule-based-v1',
                  name: 'Rule-Based Strategy',
                  description: 'A rule-based strategy',
                };
              }
              return null;
            }),
          };
        }
        if (serviceName === 'SimulationService') {
          return {
            runBacktest: vi.fn().mockResolvedValue({
              finalPortfolioValue: 11000,
              trades: [
                { symbol: 'SOL/USDC', side: 'BUY', quantity: 10, price: 100 },
                { symbol: 'SOL/USDC', side: 'SELL', quantity: 10, price: 110 },
              ],
              metrics: {
                winRate: 0.6,
                sharpeRatio: 1.5,
                maxDrawdown: 0.1,
                totalReturn: 0.1,
                volatility: 0.15,
              },
            }),
          };
        }
        return null;
      }),
      getSetting: vi.fn(),
    } as any;

    message = {
      content: {
        text: 'Run a backtest for SOL/USDC using the random strategy with $10000 for 30 days',
      },
    } as Memory;

    state = {} as State;
  });

  describe('metadata', () => {
    it('should have correct action metadata', () => {
      expect(runBacktestAction.name).toBe('RUN_BACKTEST');
      expect(runBacktestAction.description).toContain('backtest');
      expect(runBacktestAction.examples).toBeDefined();
      expect(runBacktestAction.examples?.length).toBeGreaterThan(0);
    });
  });

  describe('validate', () => {
    it('should validate when message contains backtest keywords', async () => {
      const result = await runBacktestAction.validate(runtime, message);
      expect(result).toBe(true);
    });

    it('should not validate when message lacks backtest keywords', async () => {
      message.content.text = 'Hello, how are you?';
      const result = await runBacktestAction.validate(runtime, message);
      expect(result).toBe(false);
    });

    it('should validate with different backtest keywords', async () => {
      const keywords = ['simulate', 'test strategy', 'performance test'];
      for (const keyword of keywords) {
        message.content.text = `I want to ${keyword} ETH`;
        const result = await runBacktestAction.validate(runtime, message);
        expect(result).toBe(true);
      }
    });
  });

  describe('handler', () => {
    it('should run backtest successfully with all parameters', async () => {
      await runBacktestAction.handler(runtime, message, state, {}, callback);

      expect(callbackResult).toBeDefined();
      expect(callbackResult?.text).toContain('Backtest Results');
      expect(callbackResult?.text).toContain('sol/usdc');
      expect(callbackResult?.text).toContain('Random Strategy');
      expect(callbackResult?.text).toContain('10.00%');
    });

    it('should handle missing services', async () => {
      runtime.getService = vi.fn().mockReturnValue(null);

      await runBacktestAction.handler(runtime, message, state, {}, callback);

      expect(callbackResult?.text).toContain("trading services aren't available");
    });

    it('should use default symbol when not specified', async () => {
      message.content.text = 'Run a backtest with random strategy';
      await runBacktestAction.handler(runtime, message, state, {}, callback);

      expect(callbackResult?.text).toContain('SOL/USDC');
    });

    it('should parse custom capital amount', async () => {
      message.content.text = 'Run a backtest for SOL/USDC using random strategy with $50,000';

      await runBacktestAction.handler(runtime, message, state, {}, callback);

      // Check that we got a successful response with the capital amount
      expect(callbackResult).toBeDefined();
      expect(callbackResult?.text).toContain('$50,000');
    });

    it('should use default period when not specified', async () => {
      message.content.text = 'Run a backtest for SOL/USDC using random strategy';
      await runBacktestAction.handler(runtime, message, state, {}, callback);

      expect(callbackResult?.text).toContain('30 days');
    });

    it('should parse custom period', async () => {
      message.content.text = 'Run a backtest for SOL/USDC using random strategy for 60 days';
      await runBacktestAction.handler(runtime, message, state, {}, callback);

      expect(callbackResult?.text).toContain('60 days');
    });

    it('should select rule-based strategy when mentioned', async () => {
      message.content.text = 'Run a backtest using rule-based strategy';
      await runBacktestAction.handler(runtime, message, state, {}, callback);

      expect(callbackResult?.text).toContain('Rule-Based Strategy');
    });

    it('should select LLM strategy when AI is mentioned', async () => {
      message.content.text = 'Run a backtest using AI strategy';

      await runBacktestAction.handler(runtime, message, state, {}, callback);

      // Check that we got a successful response
      expect(callbackResult).toBeDefined();
      expect(callbackResult?.text).toContain('Unknown'); // Mock doesn't have llm-v1 strategy
      expect(callbackResult?.text).toContain('Backtest Results');
    });

    it('should handle backtest service error', async () => {
      runtime.getService = vi.fn((serviceName: string) => {
        if (serviceName === 'SimulationService') {
          return {
            runBacktest: vi.fn().mockRejectedValue(new Error('Backtest failed')),
          };
        }
        if (serviceName === 'StrategyRegistryService') {
          return { getStrategy: vi.fn() };
        }
        return null;
      }) as any;

      await runBacktestAction.handler(runtime, message, state, {}, callback);

      expect(callbackResult?.text).toContain('encountered an error');
    });

    it('should handle zero trades in results', async () => {
      runtime.getService = vi.fn((serviceName: string) => {
        if (serviceName === 'SimulationService') {
          return {
            runBacktest: vi.fn().mockResolvedValue({
              finalPortfolioValue: 10000,
              trades: [],
              metrics: {
                winRate: 0,
                sharpeRatio: 0,
                maxDrawdown: 0,
                totalReturn: 0,
                volatility: 0,
              },
            }),
          };
        }
        if (serviceName === 'StrategyRegistryService') {
          return {
            getStrategy: vi.fn().mockReturnValue({ name: 'Test Strategy' }),
          };
        }
        return null;
      }) as any;

      await runBacktestAction.handler(runtime, message, state, {}, callback);

      expect(callbackResult?.text).toContain('No trades were executed');
      expect(callbackResult?.text).toContain('Consider adjusting strategy parameters');
    });

    it('should format negative returns correctly', async () => {
      const mockStrategy = {
        id: 'test-strategy',
        name: 'Test Strategy',
        description: 'Test',
        decide: vi.fn(),
        initialize: vi.fn(),
        isReady: vi.fn().mockReturnValue(true),
        configure: vi.fn(),
      };

      runtime.getService = vi.fn((serviceName: string) => {
        if (serviceName === 'StrategyRegistryService') {
          return {
            getStrategy: vi.fn().mockReturnValue(mockStrategy),
            listStrategies: vi.fn().mockReturnValue([mockStrategy]),
          };
        }
        if (serviceName === 'SimulationService') {
          return {
            runBacktest: vi.fn().mockResolvedValue({
              strategy: 'Test Strategy',
              pair: 'SOL/USDC',
              startDate: Date.now() - 30 * 24 * 60 * 60 * 1000,
              endDate: Date.now(),
              trades: [
                { action: 'BUY', realizedPnl: -500 },
                { action: 'SELL', realizedPnl: -1000 },
              ],
              portfolioSnapshots: [],
              finalPortfolioValue: 8500,
              metrics: {
                totalReturn: -0.15,
                winRate: 0.2,
                sharpeRatio: -0.5,
                maxDrawdown: 0.25,
                volatility: 0.2,
              },
            }),
          };
        }
        return null;
      }) as any;

      await runBacktestAction.handler(runtime, message, state, {}, callback);

      expect(callbackResult?.text).toContain('-15.00% 📉');
    });
  });
});
