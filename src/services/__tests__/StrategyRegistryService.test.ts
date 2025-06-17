import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StrategyRegistryService } from '../StrategyRegistryService.ts';
import { MockStrategy } from './MockStrategy.ts';
import type { TradingStrategy } from '../../types.ts';
import { AgentRuntime, IAgentRuntime, UUID } from '@elizaos/core';

// Minimal mock AgentRuntime for service instantiation
const createMockRuntime = (): AgentRuntime => {
  return {
    getService: vi.fn(),
    registerService: vi.fn(),
    config: new Map(),
    // Add other essential AgentRuntime properties if constructor or methods rely on them
  } as any as AgentRuntime;
};

describe('StrategyRegistryService', () => {
  let registry: StrategyRegistryService;
  let mockStrategy1: TradingStrategy;
  let mockStrategy2: TradingStrategy;
  let mockRuntime: AgentRuntime;

  beforeEach(() => {
    mockRuntime = createMockRuntime();
    registry = new StrategyRegistryService(mockRuntime);
    mockStrategy1 = new MockStrategy('strat1', 'Mock Strategy 1');
    mockStrategy2 = new MockStrategy('strat2', 'Mock Strategy 2');
  });

  it('should initialize with an empty map of strategies', () => {
    expect(registry.listStrategies()).toEqual([]);
  });

  describe('registerStrategy', () => {
    it('should register a new strategy successfully', () => {
      registry.registerStrategy(mockStrategy1);
      expect(registry.getStrategy('strat1')).toBe(mockStrategy1);
      expect(registry.listStrategies()).toContain(mockStrategy1);
      expect(registry.listStrategies().length).toBe(1);
    });

    it('should throw an error if strategy ID is already registered', () => {
      registry.registerStrategy(mockStrategy1);
      const duplicateStrategy = new MockStrategy('strat1', 'Duplicate Strategy');
      expect(() => registry.registerStrategy(duplicateStrategy)).toThrow(
        'Strategy with ID "strat1" is already registered.'
      );
    });

    it('should throw an error if strategy is null', () => {
      expect(() => registry.registerStrategy(null as any as TradingStrategy)).toThrow(
        'Strategy and strategy ID cannot be null or empty.'
      );
    });

    it('should throw an error if strategy ID is null or empty', () => {
      const strategyWithNullId = new MockStrategy(null as any as string, 'Strategy With Null ID');
      expect(() => registry.registerStrategy(strategyWithNullId)).toThrow(
        'Strategy and strategy ID cannot be null or empty.'
      );

      const strategyWithEmptyId = new MockStrategy('', 'Strategy With Empty ID');
      expect(() => registry.registerStrategy(strategyWithEmptyId)).toThrow(
        'Strategy and strategy ID cannot be null or empty.'
      );
    });
  });

  describe('getStrategy', () => {
    it('should retrieve a registered strategy by ID', () => {
      registry.registerStrategy(mockStrategy1);
      expect(registry.getStrategy('strat1')).toBe(mockStrategy1);
    });

    it('should return null if strategy ID does not exist', () => {
      expect(registry.getStrategy('nonExistentStrat')).toBeNull();
    });

    it('should return null if ID is null or empty string', () => {
      expect(registry.getStrategy(null as any as string)).toBeNull();
      expect(registry.getStrategy('')).toBeNull();
    });
  });

  describe('listStrategies', () => {
    it('should return an empty array if no strategies are registered', () => {
      expect(registry.listStrategies()).toEqual([]);
    });

    it('should return an array of all registered strategies', () => {
      registry.registerStrategy(mockStrategy1);
      registry.registerStrategy(mockStrategy2);
      const strategies = registry.listStrategies();
      expect(strategies).toContain(mockStrategy1);
      expect(strategies).toContain(mockStrategy2);
      expect(strategies.length).toBe(2);
    });
  });

  describe('clearStrategies', () => {
    it('should remove all registered strategies', () => {
      registry.registerStrategy(mockStrategy1);
      registry.registerStrategy(mockStrategy2);
      expect(registry.listStrategies().length).toBe(2);
      registry.clearStrategies();
      expect(registry.listStrategies().length).toBe(0);
      expect(registry.getStrategy('strat1')).toBeNull();
      expect(registry.getStrategy('strat2')).toBeNull();
    });

    it('should not throw an error if called when no strategies are registered', () => {
      expect(() => registry.clearStrategies()).not.toThrow();
      expect(registry.listStrategies().length).toBe(0);
    });
  });

  describe('static start', () => {
    it('should create and return a new instance', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const instance = await StrategyRegistryService.start(mockRuntime as any);

      expect(instance).toBeInstanceOf(StrategyRegistryService);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('static start called'));
    });
  });

  describe('instance start', () => {
    it('should register default strategies', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(registry, 'registerStrategy');

      await registry.start();

      expect(registry.registerStrategy).toHaveBeenCalledTimes(9); // RandomStrategy, RuleBasedStrategy, LLMStrategy, OptimizedRuleBasedStrategy, AdaptiveRuleBasedStrategy, MultiTimeframeStrategy, MomentumBreakoutStrategy, OptimizedMomentumStrategy, MeanReversionStrategy
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Registered 9 strategies'));
    });
  });

  describe('instance stop', () => {
    it('should clear all strategies and log messages', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(registry, 'clearStrategies');

      // Add some strategies first
      const strategy1 = new MockStrategy('stop-test-1');
      const strategy2 = new MockStrategy('stop-test-2');
      registry.registerStrategy(strategy1);
      registry.registerStrategy(strategy2);

      await registry.stop();

      expect(registry.clearStrategies).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('instance stop called'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('stopped successfully'));
      expect(registry.listStrategies()).toHaveLength(0);
    });
  });

  describe('capabilityDescription', () => {
    it('should have the correct capability description', () => {
      expect(registry.capabilityDescription).toBe(
        'Manages registration and retrieval of trading strategies.'
      );
    });
  });

  describe('serviceType', () => {
    it('should have the correct service type', () => {
      expect(StrategyRegistryService.serviceType).toBe('StrategyRegistryService');
    });
  });
});
