import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import { TokenSignal, TradePerformanceData } from '../types/index.ts';
import { v4 as uuidv4 } from 'uuid';

// Import technicalindicators - it's already in package.json dependencies
import * as TI from 'technicalindicators';

export class AnalyticsService extends Service {
  public static readonly serviceType = 'AnalyticsService';
  public readonly capabilityDescription =
    'Provides comprehensive technical analysis and signal scoring for backtesting';

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  public static async start(runtime: IAgentRuntime): Promise<AnalyticsService> {
    console.log(`[${AnalyticsService.serviceType}] Starting...`);
    const instance = new AnalyticsService(runtime);
    await instance.start();
    return instance;
  }

  public async start(): Promise<void> {
    console.log(`[${AnalyticsService.serviceType}] Started successfully`);
  }

  public async stop(): Promise<void> {
    console.log(`[${AnalyticsService.serviceType}] Stopped`);
  }

  async scoreTechnicalSignals(signals: TokenSignal['technicalSignals']): Promise<number> {
    if (!signals) return 0;

    let score = 0;

    // RSI scoring (0-10)
    if (signals.rsi < 30)
      score += 10; // Oversold
    else if (signals.rsi > 70)
      score -= 5; // Overbought
    else score += 5; // Neutral

    // MACD scoring (0-10)
    if (signals.macd.value > 0 && signals.macd.value > signals.macd.signal) {
      score += 10; // Strong uptrend
    } else if (
      signals.macd.value < 0 &&
      Math.abs(signals.macd.value) > Math.abs(signals.macd.signal)
    ) {
      score -= 5; // Strong downtrend
    }

    // Volume profile scoring (0-10)
    if (signals.volumeProfile?.trend === 'increasing' && !signals.volumeProfile.unusualActivity) {
      score += 10;
    }

    // Volatility scoring (0-10)
    if (signals.volatility < 0.2) score += 10;
    else if (signals.volatility > 0.5) score -= 5;

    return score;
  }

  async scoreSocialMetrics(metrics: TokenSignal['socialMetrics']): Promise<number> {
    if (!metrics) return 0;

    let score = 0;

    // Mention count (0-10 points)
    const mentionScore = Math.min((metrics.mentionCount / 100) * 10, 10);
    score += mentionScore;

    // Sentiment (-10 to +10 points)
    score += metrics.sentiment * 10;

    // Influencer mentions (0-10 points)
    const influencerScore = Math.min(metrics.influencerMentions * 2, 10);
    score += influencerScore;

    return Math.max(0, score);
  }

  async scoreMarketMetrics(metrics: {
    marketCap: number;
    volume24h: number;
    liquidity: number;
  }): Promise<number> {
    let score = 0;

    // Market cap score (0-10 points)
    if (metrics.marketCap > 1000000000)
      score += 2; // >$1B
    else if (metrics.marketCap > 100000000)
      score += 5; // >$100M
    else if (metrics.marketCap > 10000000)
      score += 10; // >$10M
    else score += 3; // <$10M

    // Volume score (0-10 points)
    const volumeToMcap = metrics.volume24h / metrics.marketCap;
    score += Math.min(volumeToMcap * 100, 10);

    // Liquidity score (0-10 points)
    const liquidityToMcap = metrics.liquidity / metrics.marketCap;
    score += Math.min(liquidityToMcap * 100, 10);

    return score;
  }

  // Enhanced RSI calculation with full TI library support
  calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) {
      return 50; // Default neutral value
    }

    const rsiValues = TI.RSI.calculate({ values: prices, period });
    return rsiValues[rsiValues.length - 1] || 50;
  }

  // Enhanced MACD calculation with TI library
  calculateMACD(
    prices: number[],
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9
  ): {
    macd: number;
    signal: number;
    histogram: number;
  } {
    if (prices.length < slowPeriod) {
      return { macd: 0, signal: 0, histogram: 0 };
    }

    const macdValues = TI.MACD.calculate({
      values: prices,
      fastPeriod,
      slowPeriod,
      signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    const lastValue = macdValues[macdValues.length - 1];
    if (lastValue) {
      return {
        macd: lastValue.MACD || 0,
        signal: lastValue.signal || 0,
        histogram: lastValue.histogram || 0,
      };
    }

    return { macd: 0, signal: 0, histogram: 0 };
  }

  // Bollinger Bands calculation
  calculateBollingerBands(
    prices: number[],
    period = 20,
    stdDev = 2
  ): {
    upper: number;
    middle: number;
    lower: number;
  } {
    if (prices.length < period) {
      const lastPrice = prices[prices.length - 1];
      return { upper: lastPrice, middle: lastPrice, lower: lastPrice };
    }

    const bbValues = TI.BollingerBands.calculate({
      period,
      values: prices,
      stdDev,
    });

    const lastValue = bbValues[bbValues.length - 1];
    if (lastValue) {
      return {
        upper: lastValue.upper,
        middle: lastValue.middle,
        lower: lastValue.lower,
      };
    }

    const lastPrice = prices[prices.length - 1];
    return { upper: lastPrice, middle: lastPrice, lower: lastPrice };
  }

  // Stochastic oscillator
  calculateStochastic(
    highs: number[],
    lows: number[],
    closes: number[],
    period = 14,
    signalPeriod = 3
  ): {
    k: number;
    d: number;
  } {
    if (highs.length < period || lows.length < period || closes.length < period) {
      return { k: 50, d: 50 };
    }

    const stochValues = TI.Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period,
      signalPeriod,
    });

    const lastValue = stochValues[stochValues.length - 1];
    if (lastValue && typeof lastValue.k === 'number' && typeof lastValue.d === 'number') {
      return {
        k: lastValue.k,
        d: lastValue.d,
      };
    }

    return { k: 50, d: 50 };
  }

  // Average True Range (ATR) for volatility
  calculateATR(highs: number[], lows: number[], closes: number[], period = 14): number {
    if (highs.length < period || lows.length < period || closes.length < period) {
      return 0;
    }

    const atrValues = TI.ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period,
    });

    return atrValues[atrValues.length - 1] || 0;
  }

  // Volume Weighted Average Price (VWAP)
  calculateVWAP(highs: number[], lows: number[], closes: number[], volumes: number[]): number {
    if (highs.length === 0) return 0;

    let totalPV = 0;
    let totalVolume = 0;

    for (let i = 0; i < highs.length; i++) {
      const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
      totalPV += typicalPrice * volumes[i];
      totalVolume += volumes[i];
    }

    return totalVolume > 0 ? totalPV / totalVolume : closes[closes.length - 1];
  }

  // Ichimoku Cloud
  calculateIchimoku(
    highs: number[],
    lows: number[],
    period1 = 9,
    period2 = 26,
    period3 = 52
  ): {
    conversion: number;
    base: number;
    spanA: number;
    spanB: number;
  } {
    if (highs.length < period3 || lows.length < period3) {
      const lastPrice = (highs[highs.length - 1] + lows[lows.length - 1]) / 2;
      return { conversion: lastPrice, base: lastPrice, spanA: lastPrice, spanB: lastPrice };
    }

    const ichimokuValues = TI.IchimokuCloud.calculate({
      high: highs,
      low: lows,
      conversionPeriod: period1,
      basePeriod: period2,
      spanPeriod: period3,
      displacement: 26,
    });

    const lastValue = ichimokuValues[ichimokuValues.length - 1];
    if (lastValue) {
      return {
        conversion: lastValue.conversion,
        base: lastValue.base,
        spanA: lastValue.spanA,
        spanB: lastValue.spanB,
      };
    }

    const lastPrice = (highs[highs.length - 1] + lows[lows.length - 1]) / 2;
    return { conversion: lastPrice, base: lastPrice, spanA: lastPrice, spanB: lastPrice };
  }

  // Calculate all technical indicators for a given price data
  calculateAllIndicators(priceData: {
    opens: number[];
    highs: number[];
    lows: number[];
    closes: number[];
    volumes: number[];
  }): {
    rsi: number;
    macd: { macd: number; signal: number; histogram: number };
    bollingerBands: { upper: number; middle: number; lower: number };
    stochastic: { k: number; d: number };
    atr: number;
    vwap: number;
    ichimoku: { conversion: number; base: number; spanA: number; spanB: number };
    sma20: number;
    sma50: number;
    ema12: number;
    ema26: number;
  } {
    const { closes, highs, lows, volumes } = priceData;

    // Calculate SMAs
    const sma20Values = TI.SMA.calculate({ period: 20, values: closes });
    const sma50Values = TI.SMA.calculate({ period: 50, values: closes });

    // Calculate EMAs
    const ema12Values = TI.EMA.calculate({ period: 12, values: closes });
    const ema26Values = TI.EMA.calculate({ period: 26, values: closes });

    return {
      rsi: this.calculateRSI(closes),
      macd: this.calculateMACD(closes),
      bollingerBands: this.calculateBollingerBands(closes),
      stochastic: this.calculateStochastic(highs, lows, closes),
      atr: this.calculateATR(highs, lows, closes),
      vwap: this.calculateVWAP(highs, lows, closes, volumes),
      ichimoku: this.calculateIchimoku(highs, lows),
      sma20: sma20Values[sma20Values.length - 1] || closes[closes.length - 1],
      sma50: sma50Values[sma50Values.length - 1] || closes[closes.length - 1],
      ema12: ema12Values[ema12Values.length - 1] || closes[closes.length - 1],
      ema26: ema26Values[ema26Values.length - 1] || closes[closes.length - 1],
    };
  }

  // Helper to identify chart patterns
  identifyPatterns(priceData: { highs: number[]; lows: number[]; closes: number[] }): {
    bullishEngulfing: boolean;
    bearishEngulfing: boolean;
    doji: boolean;
    hammer: boolean;
    shootingStar: boolean;
  } {
    const { highs, lows, closes } = priceData;
    const len = closes.length;

    if (len < 2) {
      return {
        bullishEngulfing: false,
        bearishEngulfing: false,
        doji: false,
        hammer: false,
        shootingStar: false,
      };
    }

    // Use TI library pattern recognition
    const patterns = {
      bullishEngulfing: TI.bullishengulfingpattern({
        open: closes.slice(-2, -1),
        high: highs.slice(-2),
        low: lows.slice(-2),
        close: closes.slice(-2),
      }),
      bearishEngulfing: TI.bearishengulfingpattern({
        open: closes.slice(-2, -1),
        high: highs.slice(-2),
        low: lows.slice(-2),
        close: closes.slice(-2),
      }),
      doji: TI.doji({
        open: [closes[len - 2]],
        high: [highs[len - 1]],
        low: [lows[len - 1]],
        close: [closes[len - 1]],
      }),
      hammer: TI.hammerpattern({
        open: [closes[len - 2]],
        high: [highs[len - 1]],
        low: [lows[len - 1]],
        close: [closes[len - 1]],
      }),
      shootingStar: TI.shootingstar({
        open: [closes[len - 2]],
        high: [highs[len - 1]],
        low: [lows[len - 1]],
        close: [closes[len - 1]],
      }),
    };

    return {
      bullishEngulfing: patterns.bullishEngulfing || false,
      bearishEngulfing: patterns.bearishEngulfing || false,
      doji: patterns.doji || false,
      hammer: patterns.hammer || false,
      shootingStar: patterns.shootingStar || false,
    };
  }

  // Volatility calculation helper
  calculateVolatility(prices: number[], period = 20): number {
    if (prices.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  // New method for recording trades
  async recordTrade(trade: {
    tokenAddress: string;
    type: 'BUY' | 'SELL';
    amount: number;
    price: number;
    timestamp: number;
    txSignature?: string;
  }): Promise<void> {
    logger.info(`[${AnalyticsService.serviceType}] Recording trade:`, {
      tokenAddress: trade.tokenAddress,
      type: trade.type,
      amount: trade.amount,
      price: trade.price,
    });

    // In a real implementation, this would save to database
    // For now, just log the trade
  }

  // New method for updating trading metrics
  async updateTradingMetrics(metrics: {
    isTrading: boolean;
    strategy?: string;
    positions: number;
    dailyPnL: number;
    totalPnL: number;
    lastUpdate: number;
  }): Promise<void> {
    logger.info(`[${AnalyticsService.serviceType}] Updating trading metrics:`, metrics);

    // In a real implementation, this would update a metrics store
    // For now, just log the metrics
  }

  // Helper methods for PnL tracking
  async getTodaysPnL(): Promise<number> {
    // Would query from database
    return 0;
  }

  async getTotalPnL(): Promise<number> {
    // Would query from database
    return 0;
  }

  getWinRate(): number {
    // Would calculate from trade history
    return 0;
  }
}
