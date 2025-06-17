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

// Market regime types
enum MarketRegime {
  TRENDING_UP = 'trending_up',
  TRENDING_DOWN = 'trending_down',
  RANGING = 'ranging',
  HIGH_VOLATILITY = 'high_volatility',
}

// Position management states
enum PositionState {
  NONE = 'none',
  PARTIAL = 'partial',
  FULL = 'full',
}

interface OptimizationParams {
  // Entry parameters
  minVolumeRatio: number;
  minPriceChange: number;
  minTrendStrength: number;
  requiredConditions: number; // How many conditions must be met

  // Exit parameters
  stopLoss: number;
  takeProfit: number;
  trailingStopActivation: number; // When to activate trailing stop
  trailingStopDistance: number; // Distance for trailing stop
  partialExitPercent: number; // Percentage to exit at first target
  partialExitTarget: number; // First target for partial exit

  // Risk management
  maxRiskPerTrade: number;
  maxPositionSize: number; // Max percentage of portfolio

  // Market regime filters
  minVolatilityForEntry: number;
  maxVolatilityForEntry: number;
  trendFilterPeriod: number;
  regimeFilterEnabled: boolean;
}

export const DEFAULT_PARAMS: OptimizationParams = {
  // Entry parameters
  minVolumeRatio: 1.5,
  minPriceChange: 0.008, // 0.8%
  minTrendStrength: 25,
  requiredConditions: 3,

  // Exit parameters
  stopLoss: 0.015, // 1.5%
  takeProfit: 0.03, // 3%
  trailingStopActivation: 0.02, // Activate at 2% profit
  trailingStopDistance: 0.01, // 1% trailing distance
  partialExitPercent: 0.5, // Exit 50% at first target
  partialExitTarget: 0.015, // First target at 1.5%

  // Risk management
  maxRiskPerTrade: 0.02,
  maxPositionSize: 0.2, // 20% max position

  // Market regime filters
  minVolatilityForEntry: 0.001, // 0.1% min volatility
  maxVolatilityForEntry: 0.05, // 5% max volatility
  trendFilterPeriod: 50,
  regimeFilterEnabled: true,
};

interface MomentumIndicators {
  // Price momentum
  priceChange1h: number;
  priceChange5m: number;
  priceChange15m: number;
  priceChange30m: number;

  // Volume analysis
  volumeRatio: number;
  volumeSpike: boolean;
  volumeTrend: 'increasing' | 'decreasing' | 'stable';
  volumeMomentum: number;

  // Volatility
  atr: number;
  volatilityPercentile: number;
  volatilityRegime: 'low' | 'normal' | 'high';

  // Trend strength
  adx: number;
  trendDirection: 'bullish' | 'bearish' | 'neutral';
  trendStrength: number;
  ema9: number;
  ema21: number;
  ema50: number;

  // Market structure
  resistance: number;
  support: number;
  nearResistance: boolean;
  nearSupport: boolean;
  pricePosition: number; // 0-1, where price is relative to recent range

  // Market regime
  marketRegime: MarketRegime;
}

export class OptimizedMomentumStrategy implements TradingStrategy {
  public readonly id = 'optimized-momentum-v1';
  public readonly name = 'Optimized Momentum Strategy';
  public readonly description =
    'Advanced momentum strategy with market regime detection and position management';

  // Strategy parameters
  private params: OptimizationParams;

  // Position tracking
  private activePosition: {
    entryPrice: number;
    entryTime: number;
    highestPrice: number;
    pair: string;
    positionState: PositionState;
    remainingQuantity: number;
    originalQuantity: number;
    partialExitDone: boolean;
  } | null = null;

  // Performance tracking
  private tradeCount = 0;
  private winCount = 0;
  private totalPnl = 0;

  constructor(params: Partial<OptimizationParams> = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
  }

  isReady(): boolean {
    return true;
  }

  async decide(params: {
    marketData: StrategyContextMarketData;
    agentState: AgentState;
    portfolioSnapshot: PortfolioSnapshot;
    agentRuntime?: any;
  }): Promise<TradeOrder | null> {
    const { marketData, portfolioSnapshot } = params;
    const { priceData, currentPrice } = marketData;

    // Need sufficient data for analysis
    if (!priceData || priceData.length < Math.max(100, this.params.trendFilterPeriod * 2)) {
      return null;
    }

    // Calculate indicators
    const indicators = this.calculateMomentumIndicators(priceData);

    // Check market regime filter
    if (this.params.regimeFilterEnabled && !this.isRegimeFavorable(indicators)) {
      return null;
    }

    // Get current position
    const holdings = Object.entries(portfolioSnapshot.holdings);
    const assetHolding = holdings.find(([key, value]) => key !== 'USDC' && value > 0);
    const hasPosition = assetHolding && assetHolding[1] > 0;
    const assetSymbol = assetHolding ? assetHolding[0] : null;

    // Position management
    if (hasPosition && this.activePosition && assetSymbol) {
      return this.managePosition(currentPrice, indicators, assetSymbol, portfolioSnapshot);
    }

    // Entry logic
    if (!hasPosition && this.shouldEnter(indicators, currentPrice)) {
      const positionSize = this.calculatePositionSize(portfolioSnapshot.totalValue, currentPrice);

      if (positionSize > 0.001) {
        const tradingPair = this.inferTradingPair(portfolioSnapshot);

        this.activePosition = {
          entryPrice: currentPrice,
          entryTime: Date.now(),
          highestPrice: currentPrice,
          pair: tradingPair,
          positionState: PositionState.FULL,
          remainingQuantity: positionSize,
          originalQuantity: positionSize,
          partialExitDone: false,
        };

        return {
          action: TradeType.BUY,
          pair: tradingPair,
          quantity: positionSize,
          orderType: OrderType.MARKET,
          timestamp: Date.now(),
          reason: this.generateEntryReason(indicators),
        };
      }
    }

    return null;
  }

  private calculateMomentumIndicators(priceData: OHLCV[]): MomentumIndicators {
    const currentPrice = priceData[priceData.length - 1].close;

    // Price momentum over different timeframes
    const price5mAgo = priceData[Math.max(0, priceData.length - 5)]?.close || currentPrice;
    const price15mAgo = priceData[Math.max(0, priceData.length - 15)]?.close || currentPrice;
    const price30mAgo = priceData[Math.max(0, priceData.length - 30)]?.close || currentPrice;
    const price60mAgo = priceData[Math.max(0, priceData.length - 60)]?.close || currentPrice;

    const priceChange5m = (currentPrice - price5mAgo) / price5mAgo;
    const priceChange15m = (currentPrice - price15mAgo) / price15mAgo;
    const priceChange30m = (currentPrice - price30mAgo) / price30mAgo;
    const priceChange1h = (currentPrice - price60mAgo) / price60mAgo;

    // Volume analysis
    const recentVolumes = priceData.slice(-20).map((c) => c.volume);
    const avgVolume = recentVolumes.reduce((a, b) => a + b) / recentVolumes.length;
    const currentVolume = priceData[priceData.length - 1].volume;
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

    // Volume momentum
    const volumeTrend5 = recentVolumes.slice(-5).reduce((a, b) => a + b) / 5;
    const volumeTrend10 = recentVolumes.slice(-10).reduce((a, b) => a + b) / 10;
    const volumeMomentum = volumeTrend10 > 0 ? (volumeTrend5 - volumeTrend10) / volumeTrend10 : 0;

    let volumeTrend: 'increasing' | 'decreasing' | 'stable';
    if (volumeTrend5 > volumeTrend10 * 1.2) {
      volumeTrend = 'increasing';
    } else if (volumeTrend5 < volumeTrend10 * 0.8) {
      volumeTrend = 'decreasing';
    } else {
      volumeTrend = 'stable';
    }

    // ATR and volatility
    const atr = this.calculateATR(priceData.slice(-14));
    const atrPercentage = atr / currentPrice;
    const volatilityRegime =
      atrPercentage > 0.03 ? 'high' : atrPercentage > 0.01 ? 'normal' : 'low';

    // Trend indicators
    const adx = this.calculateADX(priceData.slice(-20));
    const ema9 = this.calculateEMA(
      priceData.slice(-20).map((c) => c.close),
      9
    );
    const ema21 = this.calculateEMA(
      priceData.slice(-30).map((c) => c.close),
      21
    );
    const ema50 = this.calculateEMA(
      priceData.slice(-60).map((c) => c.close),
      50
    );

    // Trend direction
    let trendDirection: 'bullish' | 'bearish' | 'neutral';
    if (ema9 > ema21 && ema21 > ema50 && priceChange15m > 0) {
      trendDirection = 'bullish';
    } else if (ema9 < ema21 && ema21 < ema50 && priceChange15m < 0) {
      trendDirection = 'bearish';
    } else {
      trendDirection = 'neutral';
    }

    // Market structure
    const recentData = priceData.slice(-50);
    const recentHighs = recentData.map((c) => c.high);
    const recentLows = recentData.map((c) => c.low);
    const resistance = Math.max(...recentHighs);
    const support = Math.min(...recentLows);
    const priceRange = resistance - support;
    const pricePosition = priceRange > 0 ? (currentPrice - support) / priceRange : 0.5;

    // Market regime detection
    const marketRegime = this.detectMarketRegime(priceData);

    return {
      priceChange1h,
      priceChange5m,
      priceChange15m,
      priceChange30m,
      volumeRatio,
      volumeSpike: volumeRatio > 3,
      volumeTrend,
      volumeMomentum,
      atr,
      volatilityPercentile: atrPercentage > 0.02 ? 0.8 : 0.5,
      volatilityRegime,
      adx,
      trendDirection,
      trendStrength: (Math.abs(priceChange30m) * adx) / 25,
      ema9,
      ema21,
      ema50,
      resistance,
      support,
      nearResistance: (resistance - currentPrice) / currentPrice < 0.005,
      nearSupport: (currentPrice - support) / currentPrice < 0.005,
      pricePosition,
      marketRegime,
    };
  }

  private detectMarketRegime(priceData: OHLCV[]): MarketRegime {
    // Calculate trend strength over longer period
    const prices = priceData.slice(-this.params.trendFilterPeriod).map((c) => c.close);
    if (prices.length < 2) return MarketRegime.RANGING;

    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const priceChange = (lastPrice - firstPrice) / firstPrice;

    // Calculate volatility
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);

    // Determine regime
    if (volatility > 0.02) {
      return MarketRegime.HIGH_VOLATILITY;
    } else if (Math.abs(priceChange) > 0.05 && volatility < 0.015) {
      return priceChange > 0 ? MarketRegime.TRENDING_UP : MarketRegime.TRENDING_DOWN;
    } else {
      return MarketRegime.RANGING;
    }
  }

  private isRegimeFavorable(indicators: MomentumIndicators): boolean {
    // Skip ranging markets
    if (indicators.marketRegime === MarketRegime.RANGING) {
      return false;
    }

    // Skip extremely high volatility
    if (
      indicators.volatilityRegime === 'high' &&
      indicators.atr / indicators.support > this.params.maxVolatilityForEntry
    ) {
      return false;
    }

    // Skip very low volatility (no opportunity)
    if (indicators.atr / indicators.support < this.params.minVolatilityForEntry) {
      return false;
    }

    return true;
  }

  private shouldEnter(indicators: MomentumIndicators, currentPrice: number): boolean {
    const conditions = [];

    // 1. Price momentum
    const hasMomentum =
      indicators.priceChange5m > this.params.minPriceChange &&
      indicators.priceChange15m > -this.params.minPriceChange * 0.5 &&
      indicators.priceChange30m > 0;
    conditions.push(hasMomentum);

    // 2. Volume confirmation
    const hasVolume =
      indicators.volumeRatio > this.params.minVolumeRatio ||
      (indicators.volumeRatio > 1.3 && indicators.volumeMomentum > 0.2);
    conditions.push(hasVolume);

    // 3. Trend alignment
    const trendAligned =
      indicators.trendDirection === 'bullish' &&
      indicators.adx > this.params.minTrendStrength &&
      currentPrice > indicators.ema21;
    conditions.push(trendAligned);

    // 4. Market structure
    const goodStructure = !indicators.nearResistance && indicators.pricePosition < 0.8;
    conditions.push(goodStructure);

    // 5. Momentum confirmation
    const momentumConfirmed =
      indicators.priceChange5m > indicators.priceChange15m &&
      indicators.volumeTrend !== 'decreasing';
    conditions.push(momentumConfirmed);

    // Count met conditions
    const metConditions = conditions.filter((c) => c).length;
    return metConditions >= this.params.requiredConditions;
  }

  private managePosition(
    currentPrice: number,
    indicators: MomentumIndicators,
    assetSymbol: string,
    portfolio: PortfolioSnapshot
  ): TradeOrder | null {
    if (!this.activePosition) return null;

    const { entryPrice, highestPrice, partialExitDone, remainingQuantity } = this.activePosition;
    const profitPercent = (currentPrice - entryPrice) / entryPrice;
    const drawdownFromHigh = (highestPrice - currentPrice) / highestPrice;

    // Update highest price
    if (currentPrice > highestPrice) {
      this.activePosition.highestPrice = currentPrice;
    }

    // Check for partial exit
    if (!partialExitDone && profitPercent >= this.params.partialExitTarget) {
      const partialQuantity = remainingQuantity * this.params.partialExitPercent;
      this.activePosition.partialExitDone = true;
      this.activePosition.remainingQuantity -= partialQuantity;
      this.activePosition.positionState = PositionState.PARTIAL;

      return {
        action: TradeType.SELL,
        pair: `${assetSymbol}/USDC`,
        quantity: partialQuantity,
        orderType: OrderType.MARKET,
        timestamp: Date.now(),
        reason: `Partial exit (${(this.params.partialExitPercent * 100).toFixed(0)}%) at target: +${(profitPercent * 100).toFixed(1)}%`,
      };
    }

    // Exit conditions for remaining position
    let shouldExit = false;
    let exitReason = '';

    // 1. Hit final profit target
    if (profitPercent >= this.params.takeProfit) {
      shouldExit = true;
      exitReason = `Take profit reached: +${(profitPercent * 100).toFixed(1)}%`;
    }

    // 2. Stop loss
    else if (profitPercent <= -this.params.stopLoss) {
      shouldExit = true;
      exitReason = `Stop loss triggered: ${(profitPercent * 100).toFixed(1)}%`;
      this.winCount--; // Adjust for loss
    }

    // 3. Trailing stop
    else if (
      profitPercent > this.params.trailingStopActivation &&
      drawdownFromHigh > this.params.trailingStopDistance
    ) {
      shouldExit = true;
      exitReason = `Trailing stop: -${(drawdownFromHigh * 100).toFixed(1)}% from high`;
    }

    // 4. Momentum reversal with volume
    else if (
      indicators.priceChange5m < -this.params.minPriceChange &&
      indicators.volumeRatio > 2 &&
      indicators.trendDirection === 'bearish'
    ) {
      shouldExit = true;
      exitReason = 'Strong momentum reversal detected';
    }

    // 5. Market regime change
    else if (
      this.params.regimeFilterEnabled &&
      indicators.marketRegime === MarketRegime.RANGING &&
      profitPercent > 0.005
    ) {
      shouldExit = true;
      exitReason = 'Market regime changed to ranging';
    }

    if (shouldExit) {
      // Track performance
      this.tradeCount++;
      if (profitPercent > 0) this.winCount++;
      this.totalPnl += profitPercent;

      // Store remaining quantity before clearing position
      const exitQuantity = this.activePosition.remainingQuantity || portfolio.holdings[assetSymbol];

      this.activePosition = null;

      return {
        action: TradeType.SELL,
        pair: `${assetSymbol}/USDC`,
        quantity: exitQuantity,
        orderType: OrderType.MARKET,
        timestamp: Date.now(),
        reason: exitReason,
      };
    }

    return null;
  }

  private calculatePositionSize(portfolioValue: number, currentPrice: number): number {
    const riskAmount = portfolioValue * this.params.maxRiskPerTrade;
    const positionValue = riskAmount / this.params.stopLoss;

    // Apply max position size limit
    const maxPositionValue = portfolioValue * this.params.maxPositionSize;
    const actualPositionValue = Math.min(positionValue, maxPositionValue);

    return actualPositionValue / currentPrice;
  }

  private generateEntryReason(indicators: MomentumIndicators): string {
    const parts = [];

    if (indicators.priceChange5m > this.params.minPriceChange) {
      parts.push(`${(indicators.priceChange5m * 100).toFixed(1)}% momentum`);
    }

    if (indicators.volumeRatio > this.params.minVolumeRatio) {
      parts.push(`${indicators.volumeRatio.toFixed(1)}x volume`);
    }

    if (indicators.trendDirection === 'bullish') {
      parts.push(`${indicators.trendDirection} trend`);
    }

    parts.push(`regime: ${indicators.marketRegime}`);

    return `Entry: ${parts.join(', ')}`;
  }

  private inferTradingPair(portfolioSnapshot: PortfolioSnapshot): string {
    const holdings = Object.keys(portfolioSnapshot.holdings);
    const existingPosition = holdings.find(
      (key) => key !== 'USDC' && portfolioSnapshot.holdings[key] > 0
    );

    return existingPosition || holdings.find((key) => key !== 'USDC') || 'UNKNOWN';
  }

  private calculateATR(candles: OHLCV[]): number {
    if (candles.length < 2) return 0;

    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
      const highLow = candles[i].high - candles[i].low;
      const highClose = Math.abs(candles[i].high - candles[i - 1].close);
      const lowClose = Math.abs(candles[i].low - candles[i - 1].close);
      trueRanges.push(Math.max(highLow, highClose, lowClose));
    }

    return trueRanges.reduce((a, b) => a + b) / trueRanges.length;
  }

  private calculateEMA(values: number[], period: number): number {
    if (values.length < period) return values[values.length - 1];

    const multiplier = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b) / period;

    for (let i = period; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  private calculateADX(candles: OHLCV[], period: number = 14): number {
    if (candles.length < period + 1) return 0;

    // Calculate directional movement
    const plusDM = [];
    const minusDM = [];
    const tr = [];

    for (let i = 1; i < candles.length; i++) {
      const highDiff = candles[i].high - candles[i - 1].high;
      const lowDiff = candles[i - 1].low - candles[i].low;

      plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
      minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);

      const highLow = candles[i].high - candles[i].low;
      const highClose = Math.abs(candles[i].high - candles[i - 1].close);
      const lowClose = Math.abs(candles[i].low - candles[i - 1].close);
      tr.push(Math.max(highLow, highClose, lowClose));
    }

    // Calculate smoothed values
    const avgTR = tr.slice(-period).reduce((a, b) => a + b) / period;
    const avgPlusDM = plusDM.slice(-period).reduce((a, b) => a + b) / period;
    const avgMinusDM = minusDM.slice(-period).reduce((a, b) => a + b) / period;

    // Calculate DI values
    const plusDI = avgTR > 0 ? (avgPlusDM / avgTR) * 100 : 0;
    const minusDI = avgTR > 0 ? (avgMinusDM / avgTR) * 100 : 0;

    // Calculate DX and ADX
    const diDiff = Math.abs(plusDI - minusDI);
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (diDiff / diSum) * 100 : 0;

    return dx; // Simplified ADX
  }

  // Public method to get performance stats
  getPerformanceStats() {
    return {
      tradeCount: this.tradeCount,
      winCount: this.winCount,
      winRate: this.tradeCount > 0 ? this.winCount / this.tradeCount : 0,
      totalPnl: this.totalPnl,
      avgPnl: this.tradeCount > 0 ? this.totalPnl / this.tradeCount : 0,
    };
  }
}
