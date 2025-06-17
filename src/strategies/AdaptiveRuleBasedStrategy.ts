import {
  TradingStrategy,
  TradeOrder,
  TradeType,
  OrderType,
  StrategyContextMarketData,
  AgentState,
  PortfolioSnapshot,
  OHLCV,
} from '../types.ts';
import { v4 as uuidv4 } from 'uuid';

interface AdaptiveIndicators {
  // Trend indicators
  ema10: number;
  ema30: number;
  ema100: number;
  trendStrength: number;
  marketRegime: 'trending' | 'ranging' | 'volatile';

  // Momentum
  rsi: number;
  rsiTrend: 'oversold' | 'neutral' | 'overbought';
  macd: { macd: number; signal: number; histogram: number };
  momentum: number;

  // Volatility
  atr: number;
  volatilityRatio: number;
  bollingerBands: { upper: number; middle: number; lower: number; width: number };

  // Volume
  volumeRatio: number;
  volumeTrend: 'increasing' | 'decreasing' | 'stable';

  // Market microstructure
  priceLevel: 'support' | 'resistance' | 'neutral';
  recentSwingHigh: number;
  recentSwingLow: number;
}

export class AdaptiveRuleBasedStrategy implements TradingStrategy {
  public readonly id = 'adaptive-rule-based-v1';
  public readonly name = 'Adaptive Rule-Based Trading Strategy';
  public readonly description =
    'An adaptive strategy that adjusts parameters based on market conditions';

  // Core parameters
  private readonly baseRiskPerTrade = 0.01; // 1% base risk
  private readonly maxPositionSize = 0.25; // Max 25% of capital
  private readonly minWinRate = 0.45; // Minimum 45% win rate to continue trading

  // Adaptive parameters
  private recentTrades: Array<{ profit: boolean; timestamp: number }> = [];
  private readonly adaptivePeriod = 50; // Trades to consider for adaptation

  isReady(): boolean {
    return true; // Always ready
  }

  async decide(params: {
    marketData: StrategyContextMarketData;
    agentState: AgentState;
    portfolioSnapshot: PortfolioSnapshot;
    agentRuntime?: any;
  }): Promise<TradeOrder | null> {
    const { marketData, portfolioSnapshot } = params;
    const { priceData, currentPrice } = marketData;

    // Need at least 200 candles for proper analysis
    if (!priceData || priceData.length < 200) {
      return null;
    }

    // Calculate comprehensive indicators
    const indicators = this.calculateAdaptiveIndicators(priceData);

    // Check if we should be trading based on recent performance
    if (!this.shouldTrade(indicators)) {
      return null;
    }

    // Get current position
    const currentHolding = this.getCurrentPosition(portfolioSnapshot);

    // Determine trade signal
    const signal = this.generateSignal(indicators, currentHolding);

    if (!signal) {
      return null;
    }

    // Calculate position size based on market conditions
    const positionSize = this.calculateAdaptivePositionSize(
      indicators,
      portfolioSnapshot.totalValue,
      currentPrice
    );

    if (positionSize < 0.001) {
      return null; // Position too small
    }

    // Extract asset from portfolio snapshot or use a default
    const assetSymbol =
      Object.keys(portfolioSnapshot.holdings).find(
        (key) => key !== 'USDC' && portfolioSnapshot.holdings[key] > 0
      ) || 'SOL';

    const pair = `${assetSymbol}/USDC`;

    return {
      action: signal.action,
      pair,
      quantity: positionSize,
      orderType: OrderType.MARKET,
      timestamp: Date.now(),
      reason: signal.reasoning,
    };
  }

  private calculateAdaptiveIndicators(priceData: OHLCV[]): AdaptiveIndicators {
    const closes = priceData.map((c) => c.close);
    const volumes = priceData.map((c) => c.volume);
    const highs = priceData.map((c) => c.high);
    const lows = priceData.map((c) => c.low);

    // EMAs for trend
    const ema10 = this.calculateEMA(closes, 10);
    const ema30 = this.calculateEMA(closes, 30);
    const ema100 = this.calculateEMA(closes, 100);

    // Trend strength (0-1)
    const currentPrice = closes[closes.length - 1];
    const trendStrength = this.calculateTrendStrength(currentPrice, ema10, ema30, ema100);

    // RSI with dynamic thresholds
    const rsi = this.calculateRSI(closes, 14);
    const rsiTrend = rsi < 35 ? 'oversold' : rsi > 65 ? 'overbought' : 'neutral';

    // MACD
    const macd = this.calculateMACD(closes);

    // ATR for volatility
    const atr = this.calculateATR(highs, lows, closes, 14);
    const volatilityRatio = atr / currentPrice;

    // Bollinger Bands
    const bollingerBands = this.calculateBollingerBands(closes, 20, 2);

    // Volume analysis
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const recentVolume = volumes[volumes.length - 1];
    const volumeRatio = recentVolume / avgVolume;
    const volumeTrend = this.analyzeVolumeTrend(volumes);

    // Market regime detection
    const marketRegime = this.detectMarketRegime(
      closes,
      atr,
      bollingerBands.width / bollingerBands.middle
    );

    // Price levels
    const { support, resistance } = this.findSupportResistance(highs, lows, closes);
    const priceLevel = this.determinePriceLevel(currentPrice, support, resistance);

    // Momentum
    const momentum = this.calculateMomentum(closes, 10);

    return {
      ema10,
      ema30,
      ema100,
      trendStrength,
      marketRegime,
      rsi,
      rsiTrend,
      macd,
      momentum,
      atr,
      volatilityRatio,
      bollingerBands,
      volumeRatio,
      volumeTrend,
      priceLevel,
      recentSwingHigh: resistance,
      recentSwingLow: support,
    };
  }

  private shouldTrade(indicators: AdaptiveIndicators): boolean {
    // Don't trade in extremely volatile markets
    if (indicators.volatilityRatio > 0.05) {
      return false;
    }

    // Don't trade in ranging markets with low volatility
    if (indicators.marketRegime === 'ranging' && indicators.volatilityRatio < 0.01) {
      return false;
    }

    // Check recent performance
    const recentWinRate = this.calculateRecentWinRate();
    if (recentWinRate < this.minWinRate && this.recentTrades.length >= 20) {
      return false;
    }

    return true;
  }

  private generateSignal(
    indicators: AdaptiveIndicators,
    currentHolding: number
  ): { action: TradeType; reasoning: string } | null {
    const signals = {
      buy: 0,
      sell: 0,
      reasons: [] as string[],
    };

    // Trend following signals
    if (indicators.marketRegime === 'trending') {
      if (indicators.ema10 > indicators.ema30 && indicators.ema30 > indicators.ema100) {
        signals.buy += 2;
        signals.reasons.push('Strong uptrend');
      } else if (indicators.ema10 < indicators.ema30 && indicators.ema30 < indicators.ema100) {
        signals.sell += 2;
        signals.reasons.push('Strong downtrend');
      }
    }

    // Mean reversion signals (only in ranging markets)
    if (indicators.marketRegime === 'ranging') {
      if (indicators.rsiTrend === 'oversold' && indicators.priceLevel === 'support') {
        signals.buy += 2;
        signals.reasons.push('Oversold at support');
      } else if (indicators.rsiTrend === 'overbought' && indicators.priceLevel === 'resistance') {
        signals.sell += 2;
        signals.reasons.push('Overbought at resistance');
      }
    }

    // MACD confirmation
    if (indicators.macd.histogram > 0 && indicators.macd.macd > indicators.macd.signal) {
      signals.buy += 1;
      signals.reasons.push('MACD bullish');
    } else if (indicators.macd.histogram < 0 && indicators.macd.macd < indicators.macd.signal) {
      signals.sell += 1;
      signals.reasons.push('MACD bearish');
    }

    // Volume confirmation
    if (indicators.volumeTrend === 'increasing' && indicators.volumeRatio > 1.5) {
      if (indicators.momentum > 0) {
        signals.buy += 1;
        signals.reasons.push('Volume surge on upward momentum');
      } else {
        signals.sell += 1;
        signals.reasons.push('Volume surge on downward momentum');
      }
    }

    // Bollinger Band squeeze breakout
    const bbWidth = indicators.bollingerBands.width / indicators.bollingerBands.middle;
    if (bbWidth < 0.02) {
      // Squeeze detected
      if (indicators.momentum > 0 && indicators.macd.histogram > 0) {
        signals.buy += 1;
        signals.reasons.push('Bollinger squeeze breakout bullish');
      } else if (indicators.momentum < 0 && indicators.macd.histogram < 0) {
        signals.sell += 1;
        signals.reasons.push('Bollinger squeeze breakout bearish');
      }
    }

    // Position management
    if (currentHolding > 0) {
      // Exit signals for longs
      if (signals.sell >= 3 || indicators.trendStrength < 0.2) {
        return {
          action: TradeType.SELL,
          reasoning: 'Exit long: ' + signals.reasons.join(', '),
        };
      }
    } else {
      // Entry signals
      const requiredSignals = indicators.marketRegime === 'trending' ? 3 : 4;

      if (signals.buy >= requiredSignals) {
        return {
          action: TradeType.BUY,
          reasoning: 'Enter long: ' + signals.reasons.join(', '),
        };
      }
    }

    return null;
  }

  private calculateAdaptivePositionSize(
    indicators: AdaptiveIndicators,
    portfolioValue: number,
    currentPrice: number
  ): number {
    // Base position size
    let riskAmount = portfolioValue * this.baseRiskPerTrade;

    // Adjust for market regime
    if (indicators.marketRegime === 'volatile') {
      riskAmount *= 0.5; // Reduce risk in volatile markets
    } else if (indicators.marketRegime === 'trending' && indicators.trendStrength > 0.7) {
      riskAmount *= 1.5; // Increase risk in strong trends
    }

    // Adjust for recent performance
    const recentWinRate = this.calculateRecentWinRate();
    if (recentWinRate > 0.6) {
      riskAmount *= 1.2; // Increase size when performing well
    } else if (recentWinRate < 0.4) {
      riskAmount *= 0.8; // Decrease size when performing poorly
    }

    // Calculate position size based on ATR stop
    const stopDistance = indicators.atr * 2; // 2 ATR stop
    const positionValue = riskAmount / (stopDistance / currentPrice);
    const positionSize = positionValue / currentPrice;

    // Apply maximum position size limit
    const maxPosition = (portfolioValue * this.maxPositionSize) / currentPrice;
    return Math.min(positionSize, maxPosition);
  }

  // Helper methods
  private calculateEMA(values: number[], period: number): number {
    if (values.length < period) return values[values.length - 1];

    const multiplier = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b) / period;

    for (let i = period; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  private calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50;

    const changes = [];
    for (let i = 1; i < closes.length; i++) {
      changes.push(closes[i] - closes[i - 1]);
    }

    const gains = changes.map((c) => (c > 0 ? c : 0));
    const losses = changes.map((c) => (c < 0 ? -c : 0));

    const avgGain = gains.slice(-period).reduce((a, b) => a + b) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b) / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private calculateMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
    const ema12 = this.calculateEMA(closes, 12);
    const ema26 = this.calculateEMA(closes, 26);
    const macd = ema12 - ema26;

    // Calculate signal line (9-period EMA of MACD)
    const macdValues = [];
    for (let i = 26; i < closes.length; i++) {
      const e12 = this.calculateEMA(closes.slice(0, i + 1), 12);
      const e26 = this.calculateEMA(closes.slice(0, i + 1), 26);
      macdValues.push(e12 - e26);
    }

    const signal = this.calculateEMA(macdValues, 9);
    const histogram = macd - signal;

    return { macd, signal, histogram };
  }

  private calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
    const trueRanges = [];

    for (let i = 1; i < highs.length; i++) {
      const highLow = highs[i] - lows[i];
      const highClose = Math.abs(highs[i] - closes[i - 1]);
      const lowClose = Math.abs(lows[i] - closes[i - 1]);
      trueRanges.push(Math.max(highLow, highClose, lowClose));
    }

    const recentTR = trueRanges.slice(-period);
    return recentTR.reduce((a, b) => a + b, 0) / recentTR.length;
  }

  private calculateBollingerBands(closes: number[], period: number, stdDev: number) {
    const sma = closes.slice(-period).reduce((a, b) => a + b) / period;
    const variance =
      closes.slice(-period).reduce((sum, close) => sum + Math.pow(close - sma, 2), 0) / period;
    const std = Math.sqrt(variance);

    return {
      upper: sma + std * stdDev,
      middle: sma,
      lower: sma - std * stdDev,
      width: std * stdDev * 2,
    };
  }

  private calculateTrendStrength(
    price: number,
    ema10: number,
    ema30: number,
    ema100: number
  ): number {
    const shortTrend = (price - ema10) / ema10;
    const medTrend = (ema10 - ema30) / ema30;
    const longTrend = (ema30 - ema100) / ema100;

    // All aligned in same direction = strong trend
    if (
      Math.sign(shortTrend) === Math.sign(medTrend) &&
      Math.sign(medTrend) === Math.sign(longTrend)
    ) {
      return Math.min(Math.abs(shortTrend + medTrend + longTrend) * 10, 1);
    }

    return Math.abs(shortTrend + medTrend + longTrend) * 3;
  }

  private analyzeVolumeTrend(volumes: number[]): 'increasing' | 'decreasing' | 'stable' {
    if (volumes.length < 10) return 'stable';

    const recent = volumes.slice(-5).reduce((a, b) => a + b) / 5;
    const previous = volumes.slice(-10, -5).reduce((a, b) => a + b) / 5;

    const change = (recent - previous) / previous;

    if (change > 0.2) return 'increasing';
    if (change < -0.2) return 'decreasing';
    return 'stable';
  }

  private detectMarketRegime(
    closes: number[],
    atr: number,
    bbWidthRatio: number
  ): 'trending' | 'ranging' | 'volatile' {
    // High ATR = volatile
    const atrRatio = atr / closes[closes.length - 1];
    if (atrRatio > 0.03) return 'volatile';

    // Narrow BB = ranging
    if (bbWidthRatio < 0.02) return 'ranging';

    // Check directional movement
    const returns = [];
    for (let i = 1; i < Math.min(20, closes.length); i++) {
      returns.push(
        (closes[closes.length - i] - closes[closes.length - i - 1]) / closes[closes.length - i - 1]
      );
    }

    const positiveReturns = returns.filter((r) => r > 0).length;
    const trend = positiveReturns / returns.length;

    if (trend > 0.65 || trend < 0.35) return 'trending';
    return 'ranging';
  }

  private findSupportResistance(
    highs: number[],
    lows: number[],
    closes: number[]
  ): { support: number; resistance: number } {
    const recentHighs = highs.slice(-50);
    const recentLows = lows.slice(-50);

    // Simple swing high/low detection
    let resistance = Math.max(...recentHighs.slice(-20));
    let support = Math.min(...recentLows.slice(-20));

    return { support, resistance };
  }

  private determinePriceLevel(
    price: number,
    support: number,
    resistance: number
  ): 'support' | 'resistance' | 'neutral' {
    const range = resistance - support;
    const position = (price - support) / range;

    if (position < 0.2) return 'support';
    if (position > 0.8) return 'resistance';
    return 'neutral';
  }

  private calculateMomentum(closes: number[], period: number): number {
    if (closes.length < period) return 0;

    const current = closes[closes.length - 1];
    const past = closes[closes.length - period - 1];

    return (current - past) / past;
  }

  private getCurrentPosition(portfolioSnapshot: { holdings: { [key: string]: number } }): number {
    // Sum all non-USDC holdings
    return Object.entries(portfolioSnapshot.holdings)
      .filter(([symbol]) => symbol !== 'USDC')
      .reduce((sum, [, quantity]) => sum + quantity, 0);
  }

  private calculateRecentWinRate(): number {
    if (this.recentTrades.length < 10) return 0.5; // Default to 50%

    const wins = this.recentTrades.filter((t) => t.profit).length;
    return wins / this.recentTrades.length;
  }

  // Method to update trade history (called externally after trade execution)
  public updateTradeResult(profit: boolean): void {
    this.recentTrades.push({ profit, timestamp: Date.now() });

    // Keep only recent trades
    if (this.recentTrades.length > this.adaptivePeriod) {
      this.recentTrades.shift();
    }
  }
}
