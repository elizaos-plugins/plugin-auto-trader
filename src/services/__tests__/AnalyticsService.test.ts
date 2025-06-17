import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalyticsService } from '../analyticsService.ts';
import { IAgentRuntime } from '@elizaos/core';
import { TokenSignal } from '../../types/index.ts';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let mockRuntime: IAgentRuntime;

  beforeEach(() => {
    mockRuntime = {
      agentId: 'test-agent',
      getSetting: vi.fn(),
    } as any;

    service = new AnalyticsService(mockRuntime);
  });

  describe('Service Lifecycle', () => {
    it('should create instance with correct service type', () => {
      expect(AnalyticsService.serviceType).toBe('AnalyticsService');
      expect(service.capabilityDescription).toContain('technical analysis');
    });

    it('should start successfully', async () => {
      const instance = await AnalyticsService.start(mockRuntime);
      expect(instance).toBeInstanceOf(AnalyticsService);
    });

    it('should stop successfully', async () => {
      await service.stop();
      // No error should be thrown
    });
  });

  describe('scoreTechnicalSignals', () => {
    it('should return 0 for no signals', async () => {
      const score = await service.scoreTechnicalSignals(undefined);
      expect(score).toBe(0);
    });

    it('should score RSI correctly', async () => {
      const signals = {
        rsi: 25, // Oversold
        macd: { value: 0, signal: 0, histogram: 0 },
        volumeProfile: { trend: 'stable' as const, unusualActivity: false },
        volatility: 0.3,
      };
      const score = await service.scoreTechnicalSignals(signals);
      expect(score).toBeGreaterThan(0);
    });

    it('should penalize overbought RSI', async () => {
      const signals = {
        rsi: 75, // Overbought
        macd: { value: 0, signal: 0, histogram: 0 },
        volumeProfile: { trend: 'stable' as const, unusualActivity: false },
        volatility: 0.3,
      };
      const score = await service.scoreTechnicalSignals(signals);
      expect(score).toBeLessThan(10);
    });

    it('should score positive MACD crossover', async () => {
      const signals = {
        rsi: 50,
        macd: { value: 0.5, signal: 0.2, histogram: 0.3 },
        volumeProfile: { trend: 'stable' as const, unusualActivity: false },
        volatility: 0.3,
      };
      const score = await service.scoreTechnicalSignals(signals);
      expect(score).toBeGreaterThan(10);
    });

    it('should reward increasing volume', async () => {
      const signals = {
        rsi: 50,
        macd: { value: 0, signal: 0, histogram: 0 },
        volumeProfile: { trend: 'increasing' as const, unusualActivity: false },
        volatility: 0.3,
      };
      const score = await service.scoreTechnicalSignals(signals);
      expect(score).toBeGreaterThan(10);
    });

    it('should reward low volatility', async () => {
      const signals = {
        rsi: 50,
        macd: { value: 0, signal: 0, histogram: 0 },
        volumeProfile: { trend: 'stable' as const, unusualActivity: false },
        volatility: 0.1,
      };
      const score = await service.scoreTechnicalSignals(signals);
      expect(score).toBeGreaterThan(10);
    });
  });

  describe('scoreSocialMetrics', () => {
    it('should return 0 for no metrics', async () => {
      const score = await service.scoreSocialMetrics(undefined);
      expect(score).toBe(0);
    });

    it('should score mention count', async () => {
      const metrics = {
        mentionCount: 50,
        sentiment: 0,
        influencerMentions: 0,
      };
      const score = await service.scoreSocialMetrics(metrics);
      expect(score).toBe(5); // 50/100 * 10
    });

    it('should score positive sentiment', async () => {
      const metrics = {
        mentionCount: 0,
        sentiment: 0.8,
        influencerMentions: 0,
      };
      const score = await service.scoreSocialMetrics(metrics);
      expect(score).toBe(8); // 0.8 * 10
    });

    it('should score influencer mentions', async () => {
      const metrics = {
        mentionCount: 0,
        sentiment: 0,
        influencerMentions: 3,
      };
      const score = await service.scoreSocialMetrics(metrics);
      expect(score).toBe(6); // 3 * 2
    });

    it('should cap scores at maximum', async () => {
      const metrics = {
        mentionCount: 200,
        sentiment: 1,
        influencerMentions: 10,
      };
      const score = await service.scoreSocialMetrics(metrics);
      expect(score).toBe(30); // 10 + 10 + 10
    });
  });

  describe('scoreMarketMetrics', () => {
    it('should score market cap correctly', async () => {
      const metrics = {
        marketCap: 50000000, // $50M
        volume24h: 5000000,
        liquidity: 5000000,
      };
      const score = await service.scoreMarketMetrics(metrics);
      expect(score).toBeGreaterThan(10);
    });

    it('should reward high volume to market cap ratio', async () => {
      const metrics = {
        marketCap: 10000000,
        volume24h: 2000000, // 20% of mcap
        liquidity: 1000000,
      };
      const score = await service.scoreMarketMetrics(metrics);
      expect(score).toBeGreaterThan(15);
    });
  });

  describe('Technical Indicators', () => {
    const testPrices = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109, 111, 110, 112, 114, 113];
    const testHighs = testPrices.map((p) => p + 1);
    const testLows = testPrices.map((p) => p - 1);
    const testVolumes = new Array(testPrices.length).fill(1000);

    it('should calculate RSI', () => {
      const rsi = service.calculateRSI(testPrices);
      expect(rsi).toBeGreaterThan(0);
      expect(rsi).toBeLessThan(100);
    });

    it('should return default RSI for insufficient data', () => {
      const rsi = service.calculateRSI([100, 101]);
      expect(rsi).toBe(50);
    });

    it('should calculate MACD', () => {
      const prices = new Array(30).fill(0).map((_, i) => 100 + i);
      const macd = service.calculateMACD(prices);
      expect(macd).toHaveProperty('macd');
      expect(macd).toHaveProperty('signal');
      expect(macd).toHaveProperty('histogram');
    });

    it('should calculate Bollinger Bands', () => {
      const prices = new Array(25).fill(0).map((_, i) => 100 + (i % 5));
      const bb = service.calculateBollingerBands(prices);
      expect(bb.upper).toBeGreaterThan(bb.middle);
      expect(bb.middle).toBeGreaterThan(bb.lower);
    });

    it('should calculate Stochastic', () => {
      const stoch = service.calculateStochastic(testHighs, testLows, testPrices);
      expect(stoch.k).toBeGreaterThanOrEqual(0);
      expect(stoch.k).toBeLessThanOrEqual(100);
      expect(stoch.d).toBeGreaterThanOrEqual(0);
      expect(stoch.d).toBeLessThanOrEqual(100);
    });

    it('should calculate ATR', () => {
      const atr = service.calculateATR(testHighs, testLows, testPrices);
      expect(atr).toBeGreaterThan(0);
    });

    it('should calculate VWAP', () => {
      const vwap = service.calculateVWAP(testHighs, testLows, testPrices, testVolumes);
      expect(vwap).toBeGreaterThan(0);
    });

    it('should calculate Ichimoku', () => {
      const highs = new Array(60).fill(0).map((_, i) => 100 + (i % 10));
      const lows = new Array(60).fill(0).map((_, i) => 95 + (i % 10));
      const ichimoku = service.calculateIchimoku(highs, lows);
      expect(ichimoku).toHaveProperty('conversion');
      expect(ichimoku).toHaveProperty('base');
      expect(ichimoku).toHaveProperty('spanA');
      expect(ichimoku).toHaveProperty('spanB');
    });

    it('should calculate all indicators', () => {
      const priceData = {
        opens: testPrices,
        highs: testHighs,
        lows: testLows,
        closes: testPrices,
        volumes: testVolumes,
      };
      const indicators = service.calculateAllIndicators(priceData);

      expect(indicators).toHaveProperty('rsi');
      expect(indicators).toHaveProperty('macd');
      expect(indicators).toHaveProperty('bollingerBands');
      expect(indicators).toHaveProperty('stochastic');
      expect(indicators).toHaveProperty('atr');
      expect(indicators).toHaveProperty('vwap');
      expect(indicators).toHaveProperty('ichimoku');
      expect(indicators).toHaveProperty('sma20');
      expect(indicators).toHaveProperty('sma50');
      expect(indicators).toHaveProperty('ema12');
      expect(indicators).toHaveProperty('ema26');
    });
  });

  describe('Pattern Recognition', () => {
    it('should identify patterns', () => {
      const priceData = {
        highs: [100, 105, 103],
        lows: [98, 99, 101],
        closes: [99, 104, 102],
      };
      const patterns = service.identifyPatterns(priceData);

      expect(patterns).toHaveProperty('bullishEngulfing');
      expect(patterns).toHaveProperty('bearishEngulfing');
      expect(patterns).toHaveProperty('doji');
      expect(patterns).toHaveProperty('hammer');
      expect(patterns).toHaveProperty('shootingStar');
    });

    it('should return false for all patterns with insufficient data', () => {
      const priceData = {
        highs: [100],
        lows: [98],
        closes: [99],
      };
      const patterns = service.identifyPatterns(priceData);

      expect(patterns.bullishEngulfing).toBe(false);
      expect(patterns.bearishEngulfing).toBe(false);
      expect(patterns.doji).toBe(false);
      expect(patterns.hammer).toBe(false);
      expect(patterns.shootingStar).toBe(false);
    });
  });

  describe('Volatility Calculation', () => {
    it('should calculate volatility', () => {
      const prices = [100, 102, 98, 105, 103, 107, 104];
      const volatility = service.calculateVolatility(prices);
      expect(volatility).toBeGreaterThan(0);
    });

    it('should return 0 for insufficient data', () => {
      const volatility = service.calculateVolatility([100]);
      expect(volatility).toBe(0);
    });
  });
});
