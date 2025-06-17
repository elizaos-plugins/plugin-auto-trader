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

interface TimeframeAnalysis {
  trend: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0-1
  support: number;
  resistance: number;
  volatility: number;
  volume: 'high' | 'normal' | 'low';
}

interface MarketContext {
  shortTerm: TimeframeAnalysis; // 5-min
  mediumTerm: TimeframeAnalysis; // 15-min
  longTerm: TimeframeAnalysis; // 1-hour
  marketStructure: 'accumulation' | 'distribution' | 'trend' | 'range';
  keyLevels: number[];
  volumeProfile: { price: number; volume: number }[];
}

interface TradeSetup {
  entry: number;
  stopLoss: number;
  targets: number[];
  confidence: number;
  reasoning: string;
  riskRewardRatio: number;
}

export class MultiTimeframeStrategy implements TradingStrategy {
  public readonly id = 'multi-timeframe-v1';
  public readonly name = 'Multi-Timeframe Trading Strategy';
  public readonly description = 'Analyzes multiple timeframes for high-probability setups';

  // Strategy parameters
  private readonly minRiskRewardRatio = 2.0;
  private readonly maxRiskPerTrade = 0.02; // 2% max risk
  private readonly partialProfitLevels = [1.5, 2.5, 4.0]; // R multiples
  private readonly maxCorrelatedPositions = 3;

  // Performance tracking
  private recentSetups: Array<{ timestamp: number; successful: boolean }> = [];
  private keyLevelCache = new Map<string, { levels: number[]; timestamp: number }>();

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

    // Need sufficient data for multi-timeframe analysis
    if (!priceData || priceData.length < 300) {
      return null;
    }

    // Aggregate data into multiple timeframes
    const timeframes = this.createTimeframes(priceData);

    // Analyze market context across timeframes
    const context = this.analyzeMarketContext(timeframes);

    // Check if market conditions are favorable
    if (!this.isFavorableMarket(context)) {
      return null;
    }

    // Look for trade setups
    const setup = this.findTradeSetup(context, currentPrice);

    if (!setup || setup.confidence < 0.7) {
      return null;
    }

    // Check portfolio constraints
    if (!this.checkPortfolioConstraints(portfolioSnapshot, setup)) {
      return null;
    }

    // Calculate position size
    const positionSize = this.calculatePositionSize(
      setup,
      portfolioSnapshot.totalValue,
      currentPrice
    );

    if (positionSize < 0.001) {
      return null;
    }

    // Get the trading pair
    const assetSymbol =
      Object.keys(portfolioSnapshot.holdings).find(
        (key) => key !== 'USDC' && portfolioSnapshot.holdings[key] > 0
      ) || 'SOL';

    return {
      action: TradeType.BUY,
      pair: `${assetSymbol}/USDC`,
      quantity: positionSize,
      orderType: OrderType.LIMIT,
      price: setup.entry,
      timestamp: Date.now(),
      reason: `${setup.reasoning} | SL: ${setup.stopLoss.toFixed(4)} | RR: ${setup.riskRewardRatio.toFixed(1)}`,
    };
  }

  private createTimeframes(minuteData: OHLCV[]): {
    m5: OHLCV[];
    m15: OHLCV[];
    h1: OHLCV[];
  } {
    return {
      m5: this.aggregateCandles(minuteData, 5),
      m15: this.aggregateCandles(minuteData, 15),
      h1: this.aggregateCandles(minuteData, 60),
    };
  }

  private aggregateCandles(candles: OHLCV[], period: number): OHLCV[] {
    const aggregated: OHLCV[] = [];

    for (let i = 0; i < candles.length; i += period) {
      const slice = candles.slice(i, i + period);
      if (slice.length === 0) continue;

      aggregated.push({
        timestamp: slice[0].timestamp,
        open: slice[0].open,
        high: Math.max(...slice.map((c) => c.high)),
        low: Math.min(...slice.map((c) => c.low)),
        close: slice[slice.length - 1].close,
        volume: slice.reduce((sum, c) => sum + c.volume, 0),
      });
    }

    return aggregated;
  }

  private analyzeMarketContext(timeframes: {
    m5: OHLCV[];
    m15: OHLCV[];
    h1: OHLCV[];
  }): MarketContext {
    const shortTerm = this.analyzeTimeframe(timeframes.m5, 'short');
    const mediumTerm = this.analyzeTimeframe(timeframes.m15, 'medium');
    const longTerm = this.analyzeTimeframe(timeframes.h1, 'long');

    // Determine market structure
    const marketStructure = this.determineMarketStructure(shortTerm, mediumTerm, longTerm);

    // Find key levels across all timeframes
    const keyLevels = this.findKeyLevels([...timeframes.m5, ...timeframes.m15, ...timeframes.h1]);

    // Build volume profile
    const volumeProfile = this.buildVolumeProfile(timeframes.m5);

    return {
      shortTerm,
      mediumTerm,
      longTerm,
      marketStructure,
      keyLevels,
      volumeProfile,
    };
  }

  private analyzeTimeframe(
    candles: OHLCV[],
    timeframe: 'short' | 'medium' | 'long'
  ): TimeframeAnalysis {
    if (candles.length < 20) {
      return {
        trend: 'neutral',
        strength: 0,
        support: 0,
        resistance: 0,
        volatility: 0,
        volume: 'normal',
      };
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);

    // Calculate EMAs
    const ema9 = this.calculateEMA(closes, 9);
    const ema21 = this.calculateEMA(closes, 21);
    const ema50 = this.calculateEMA(closes, Math.min(50, closes.length - 1));

    // Determine trend
    const currentPrice = closes[closes.length - 1];
    let trend: 'bullish' | 'bearish' | 'neutral';
    let strength = 0;

    if (ema9 > ema21 && ema21 > ema50 && currentPrice > ema9) {
      trend = 'bullish';
      strength = Math.min(((currentPrice - ema50) / ema50) * 10, 1);
    } else if (ema9 < ema21 && ema21 < ema50 && currentPrice < ema9) {
      trend = 'bearish';
      strength = Math.min(((ema50 - currentPrice) / ema50) * 10, 1);
    } else {
      trend = 'neutral';
      strength = 0.3;
    }

    // Find support and resistance
    const recentHighs = highs.slice(-20);
    const recentLows = lows.slice(-20);
    const resistance = Math.max(...recentHighs);
    const support = Math.min(...recentLows);

    // Calculate volatility
    const atr = this.calculateATR(highs, lows, closes, 14);
    const volatility = atr / currentPrice;

    // Analyze volume
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b) / 20;
    const recentVolume = volumes.slice(-5).reduce((a, b) => a + b) / 5;
    const volumeRatio = recentVolume / avgVolume;

    const volume = volumeRatio > 1.5 ? 'high' : volumeRatio < 0.7 ? 'low' : 'normal';

    return {
      trend,
      strength,
      support,
      resistance,
      volatility,
      volume,
    };
  }

  private determineMarketStructure(
    short: TimeframeAnalysis,
    medium: TimeframeAnalysis,
    long: TimeframeAnalysis
  ): 'accumulation' | 'distribution' | 'trend' | 'range' {
    // All timeframes aligned = strong trend
    if (short.trend === medium.trend && medium.trend === long.trend && short.trend !== 'neutral') {
      return 'trend';
    }

    // Lower timeframes bullish, higher bearish = accumulation
    if (short.trend === 'bullish' && long.trend === 'bearish') {
      return 'accumulation';
    }

    // Lower timeframes bearish, higher bullish = distribution
    if (short.trend === 'bearish' && long.trend === 'bullish') {
      return 'distribution';
    }

    // Mixed or neutral = range
    return 'range';
  }

  private findKeyLevels(candles: OHLCV[]): number[] {
    const levels: number[] = [];
    const pricePoints: number[] = [];

    // Collect all significant price points
    candles.forEach((candle) => {
      pricePoints.push(candle.high, candle.low);
    });

    // Sort and find clusters
    pricePoints.sort((a, b) => a - b);

    // Simple clustering algorithm
    const clusters: number[][] = [];
    let currentCluster: number[] = [pricePoints[0]];

    for (let i = 1; i < pricePoints.length; i++) {
      const price = pricePoints[i];
      const lastPrice = pricePoints[i - 1];

      if ((price - lastPrice) / lastPrice < 0.005) {
        // 0.5% threshold
        currentCluster.push(price);
      } else {
        if (currentCluster.length >= 3) {
          // Significant cluster
          clusters.push(currentCluster);
        }
        currentCluster = [price];
      }
    }

    // Add last cluster
    if (currentCluster.length >= 3) {
      clusters.push(currentCluster);
    }

    // Calculate cluster centers as key levels
    clusters.forEach((cluster) => {
      const avg = cluster.reduce((a, b) => a + b) / cluster.length;
      levels.push(avg);
    });

    return levels.slice(-10); // Keep top 10 levels
  }

  private buildVolumeProfile(candles: OHLCV[]): { price: number; volume: number }[] {
    const profile = new Map<number, number>();
    const priceStep = 0.001; // 0.1% price buckets

    candles.forEach((candle) => {
      const avgPrice = (candle.high + candle.low) / 2;
      const bucket = Math.round(avgPrice / priceStep) * priceStep;

      profile.set(bucket, (profile.get(bucket) || 0) + candle.volume);
    });

    // Convert to array and sort by volume
    return Array.from(profile.entries())
      .map(([price, volume]) => ({ price, volume }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 20); // Top 20 volume nodes
  }

  private isFavorableMarket(context: MarketContext): boolean {
    // Don't trade in pure ranging markets
    if (context.marketStructure === 'range' && context.shortTerm.volatility < 0.01) {
      return false;
    }

    // Don't trade against the major trend
    if (context.longTerm.trend === 'bearish' && context.longTerm.strength > 0.7) {
      return false;
    }

    // Favor trending or accumulation phases
    return context.marketStructure === 'trend' || context.marketStructure === 'accumulation';
  }

  private findTradeSetup(context: MarketContext, currentPrice: number): TradeSetup | null {
    const setups: TradeSetup[] = [];

    // Setup 1: Trend continuation at key level
    if (context.marketStructure === 'trend' && context.shortTerm.trend === context.longTerm.trend) {
      const nearestSupport = this.findNearestLevel(currentPrice, context.keyLevels, 'below');

      if (nearestSupport && (currentPrice - nearestSupport) / currentPrice < 0.02) {
        const entry = nearestSupport * 1.001; // Just above support
        const stopLoss = nearestSupport * 0.98; // 2% below support
        const riskAmount = entry - stopLoss;

        setups.push({
          entry,
          stopLoss,
          targets: [entry + riskAmount * 1.5, entry + riskAmount * 2.5, entry + riskAmount * 4.0],
          confidence: 0.8,
          reasoning: `Trend continuation buy at key support ${nearestSupport.toFixed(4)}`,
          riskRewardRatio: 2.5,
        });
      }
    }

    // Setup 2: Accumulation breakout
    if (context.marketStructure === 'accumulation') {
      const resistance = context.mediumTerm.resistance;

      if (currentPrice > resistance * 0.995 && currentPrice < resistance * 1.005) {
        const entry = resistance * 1.002; // Just above resistance
        const stopLoss = resistance * 0.99; // 1% below resistance
        const riskAmount = entry - stopLoss;

        setups.push({
          entry,
          stopLoss,
          targets: [entry + riskAmount * 2, entry + riskAmount * 3, entry + riskAmount * 5],
          confidence: 0.85,
          reasoning: `Accumulation breakout above ${resistance.toFixed(4)}`,
          riskRewardRatio: 3.0,
        });
      }
    }

    // Setup 3: Volume node retest
    const highVolumeNode = context.volumeProfile[0]; // Highest volume area
    if (highVolumeNode && Math.abs(currentPrice - highVolumeNode.price) / currentPrice < 0.01) {
      const entry = highVolumeNode.price;
      const stopLoss = entry * 0.985; // 1.5% stop
      const riskAmount = entry - stopLoss;

      setups.push({
        entry,
        stopLoss,
        targets: [entry + riskAmount * 1.5, entry + riskAmount * 2.0, entry + riskAmount * 3.0],
        confidence: 0.75,
        reasoning: `High volume node support at ${highVolumeNode.price.toFixed(4)}`,
        riskRewardRatio: 2.0,
      });
    }

    // Return the best setup
    return setups.sort((a, b) => b.confidence - a.confidence)[0] || null;
  }

  private findNearestLevel(
    price: number,
    levels: number[],
    direction: 'above' | 'below'
  ): number | null {
    const filtered =
      direction === 'below' ? levels.filter((l) => l < price) : levels.filter((l) => l > price);

    if (filtered.length === 0) return null;

    return direction === 'below' ? Math.max(...filtered) : Math.min(...filtered);
  }

  private checkPortfolioConstraints(portfolio: PortfolioSnapshot, setup: TradeSetup): boolean {
    // Check if we have enough USDC
    const usdcBalance = portfolio.holdings['USDC'] || 0;
    const requiredCapital = setup.entry * 100; // Assume min position

    if (usdcBalance < requiredCapital) {
      return false;
    }

    // Check correlation limits (simplified - would need correlation data)
    const activePositions = Object.keys(portfolio.holdings).filter(
      (k) => k !== 'USDC' && portfolio.holdings[k] > 0
    ).length;

    if (activePositions >= this.maxCorrelatedPositions) {
      return false;
    }

    return true;
  }

  private calculatePositionSize(
    setup: TradeSetup,
    portfolioValue: number,
    currentPrice: number
  ): number {
    // Risk-based position sizing
    const riskAmount = portfolioValue * this.maxRiskPerTrade;
    const stopDistance = Math.abs(setup.entry - setup.stopLoss);
    const positionValue = riskAmount / (stopDistance / setup.entry);
    const positionSize = positionValue / setup.entry;

    // Apply Kelly Criterion adjustment based on confidence
    const kellyFraction =
      (setup.confidence * setup.riskRewardRatio - (1 - setup.confidence)) / setup.riskRewardRatio;
    const adjustedSize = positionSize * Math.max(0.25, Math.min(1, kellyFraction));

    return adjustedSize;
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

  public updatePerformance(successful: boolean): void {
    this.recentSetups.push({ timestamp: Date.now(), successful });

    // Keep only recent history
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
    this.recentSetups = this.recentSetups.filter((s) => s.timestamp > cutoff);
  }
}
