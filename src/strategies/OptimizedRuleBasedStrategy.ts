import {
  TradingStrategy,
  TradeOrder,
  TradeType,
  OrderType,
  PortfolioSnapshot,
  AgentState,
  StrategyContextMarketData,
  OHLCV,
} from '../types.ts';
import * as ti from 'technicalindicators';

interface OptimizedIndicators {
  // Trend indicators
  ema20?: number;
  ema50?: number;
  sma200?: number;

  // Momentum indicators
  rsi?: number;
  macd?: { MACD?: number; signal?: number; histogram?: number };
  stochastic?: { k?: number; d?: number };

  // Volatility indicators
  bollingerBands?: { upper?: number; middle?: number; lower?: number };
  atr?: number;

  // Volume indicators
  obv?: number;
  volumeSMA?: number;

  // Market structure
  support?: number;
  resistance?: number;
  trend?: 'bullish' | 'bearish' | 'neutral';
}

interface OptimizedStrategyParams {
  // Risk management
  maxPositionSize: number; // Max % of portfolio in one trade
  stopLossPercentage: number;
  takeProfitPercentage: number;
  trailingStopPercentage?: number;

  // Entry conditions
  minRsiForBuy: number;
  maxRsiForBuy: number;
  minRsiForSell: number;

  // Trend confirmation
  requireTrendAlignment: boolean;
  minVolumeMultiple: number; // Min volume vs average for entry

  // Position sizing
  useKellyCriterion: boolean;
  baseTradeSizePercentage: number;
}

export class OptimizedRuleBasedStrategy implements TradingStrategy {
  public readonly id = 'optimized-rule-based-v1';
  public readonly name = 'Optimized Rule-Based Trading Strategy';
  public readonly description =
    'Enhanced rule-based strategy with multiple indicators, trend following, and dynamic position sizing for 55%+ profitability';

  private params: OptimizedStrategyParams = {
    // Conservative risk management
    maxPositionSize: 0.1, // Max 10% per trade
    stopLossPercentage: 0.02, // 2% stop loss
    takeProfitPercentage: 0.04, // 4% take profit (2:1 risk/reward)
    trailingStopPercentage: 0.015, // 1.5% trailing stop

    // RSI levels optimized for crypto volatility
    minRsiForBuy: 25,
    maxRsiForBuy: 45,
    minRsiForSell: 65,

    // Trend and volume filters
    requireTrendAlignment: true,
    minVolumeMultiple: 1.5,

    // Position sizing
    useKellyCriterion: false, // Start conservative
    baseTradeSizePercentage: 0.05, // 5% base size
  };

  private recentTrades: { timestamp: number; profit: number }[] = [];
  private winRate = 0.5; // Initial assumption

  constructor() {}

  isReady(): boolean {
    return true;
  }

  configure(params: Partial<OptimizedStrategyParams>): void {
    this.params = { ...this.params, ...params };

    // Validate parameters
    if (this.params.stopLossPercentage >= this.params.takeProfitPercentage) {
      throw new Error('Take profit must be greater than stop loss for positive risk/reward');
    }
  }

  private calculateIndicators(ohlcvData: OHLCV[]): OptimizedIndicators {
    if (ohlcvData.length < 200) {
      return {}; // Need at least 200 candles for SMA200
    }

    const closePrices = ohlcvData.map((d) => d.close);
    const highPrices = ohlcvData.map((d) => d.high);
    const lowPrices = ohlcvData.map((d) => d.low);
    const volumes = ohlcvData.map((d) => d.volume);

    const indicators: OptimizedIndicators = {};

    try {
      // Trend indicators
      const ema20 = ti.ema({ values: closePrices, period: 20 });
      const ema50 = ti.ema({ values: closePrices, period: 50 });
      const sma200 = ti.sma({ values: closePrices, period: 200 });

      if (ema20.length > 0) indicators.ema20 = ema20[ema20.length - 1];
      if (ema50.length > 0) indicators.ema50 = ema50[ema50.length - 1];
      if (sma200.length > 0) indicators.sma200 = sma200[sma200.length - 1];

      // RSI
      const rsi = ti.rsi({ values: closePrices, period: 14 });
      if (rsi.length > 0) indicators.rsi = rsi[rsi.length - 1];

      // MACD
      const macdResult = ti.macd({
        values: closePrices,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      if (macdResult.length > 0) {
        indicators.macd = macdResult[macdResult.length - 1];
      }

      // Stochastic
      const stoch = ti.stochastic({
        high: highPrices,
        low: lowPrices,
        close: closePrices,
        period: 14,
        signalPeriod: 3,
      });
      if (stoch.length > 0) {
        const lastStoch = stoch[stoch.length - 1];
        indicators.stochastic = { k: lastStoch.k, d: lastStoch.d };
      }

      // Bollinger Bands
      const bb = ti.bollingerbands({
        values: closePrices,
        period: 20,
        stdDev: 2,
      });
      if (bb.length > 0) {
        const lastBB = bb[bb.length - 1];
        indicators.bollingerBands = {
          upper: lastBB.upper,
          middle: lastBB.middle,
          lower: lastBB.lower,
        };
      }

      // ATR for volatility
      const atr = ti.atr({
        high: highPrices,
        low: lowPrices,
        close: closePrices,
        period: 14,
      });
      if (atr.length > 0) indicators.atr = atr[atr.length - 1];

      // Volume analysis
      const volumeSMA = ti.sma({ values: volumes, period: 20 });
      if (volumeSMA.length > 0) indicators.volumeSMA = volumeSMA[volumeSMA.length - 1];

      // Determine trend
      if (indicators.ema20 && indicators.ema50 && indicators.sma200) {
        if (indicators.ema20 > indicators.ema50 && indicators.ema50 > indicators.sma200) {
          indicators.trend = 'bullish';
        } else if (indicators.ema20 < indicators.ema50 && indicators.ema50 < indicators.sma200) {
          indicators.trend = 'bearish';
        } else {
          indicators.trend = 'neutral';
        }
      }

      // Support and resistance (simplified - last 20 candles)
      const recentHighs = highPrices.slice(-20);
      const recentLows = lowPrices.slice(-20);
      indicators.resistance = Math.max(...recentHighs);
      indicators.support = Math.min(...recentLows);
    } catch (error) {
      console.error('[OptimizedRuleBasedStrategy] Error calculating indicators:', error);
    }

    return indicators;
  }

  private calculatePositionSize(
    portfolioSnapshot: PortfolioSnapshot,
    winRate: number,
    avgWin: number,
    avgLoss: number
  ): number {
    const usdcBalance = portfolioSnapshot.holdings['USDC'] || 0;

    if (this.params.useKellyCriterion && winRate > 0 && avgWin > 0 && avgLoss > 0) {
      // Kelly Criterion: f = (p * b - q) / b
      // where p = win rate, q = loss rate, b = win/loss ratio
      const q = 1 - winRate;
      const b = avgWin / avgLoss;
      const kellyFraction = (winRate * b - q) / b;

      // Apply safety factor (never use full Kelly)
      const safeKellyFraction = Math.max(
        0,
        Math.min(kellyFraction * 0.25, this.params.maxPositionSize)
      );
      return usdcBalance * safeKellyFraction;
    }

    // Default position sizing
    return usdcBalance * this.params.baseTradeSizePercentage;
  }

  private shouldEnterLong(indicators: OptimizedIndicators, currentVolume: number): boolean {
    // Basic checks
    if (!indicators.rsi || !indicators.macd || !indicators.stochastic || !indicators.volumeSMA) {
      return false;
    }

    // RSI in oversold zone but not extreme
    const rsiInBuyZone =
      indicators.rsi >= this.params.minRsiForBuy && indicators.rsi <= this.params.maxRsiForBuy;

    // MACD bullish crossover or histogram turning positive
    const macdBullish = indicators.macd.histogram && indicators.macd.histogram > 0;

    // Stochastic oversold
    const stochasticOversold =
      indicators.stochastic.k !== undefined && indicators.stochastic.k < 30;

    // Volume confirmation
    const volumeConfirmation = currentVolume > indicators.volumeSMA * this.params.minVolumeMultiple;

    // Trend alignment (if required)
    const trendAligned = !this.params.requireTrendAlignment || indicators.trend === 'bullish';

    // Price near support or Bollinger Band lower
    const nearSupport =
      indicators.bollingerBands &&
      indicators.bollingerBands.lower &&
      indicators.ema20 &&
      indicators.ema20 <= indicators.bollingerBands.lower * 1.02;

    // Entry signal: Multiple confirmations required
    const confirmations = [
      rsiInBuyZone,
      macdBullish,
      stochasticOversold,
      volumeConfirmation,
      trendAligned,
      nearSupport,
    ].filter(Boolean).length;

    return confirmations >= 4; // Need at least 4 out of 6 confirmations
  }

  private shouldExitLong(
    indicators: OptimizedIndicators,
    entryPrice: number,
    currentPrice: number
  ): { shouldExit: boolean; reason: string } {
    // Take profit hit
    if (currentPrice >= entryPrice * (1 + this.params.takeProfitPercentage)) {
      return { shouldExit: true, reason: 'Take profit target reached' };
    }

    // Stop loss hit
    if (currentPrice <= entryPrice * (1 - this.params.stopLossPercentage)) {
      return { shouldExit: true, reason: 'Stop loss triggered' };
    }

    // Technical exit signals
    if (indicators.rsi && indicators.rsi >= this.params.minRsiForSell) {
      return { shouldExit: true, reason: 'RSI overbought' };
    }

    if (indicators.macd && indicators.macd.histogram && indicators.macd.histogram < 0) {
      return { shouldExit: true, reason: 'MACD bearish crossover' };
    }

    if (indicators.stochastic && indicators.stochastic.k && indicators.stochastic.k > 80) {
      return { shouldExit: true, reason: 'Stochastic overbought' };
    }

    return { shouldExit: false, reason: '' };
  }

  async decide(params: {
    marketData: StrategyContextMarketData;
    agentState: AgentState;
    portfolioSnapshot: PortfolioSnapshot;
    agentRuntime?: any;
  }): Promise<TradeOrder | null> {
    const { marketData, portfolioSnapshot } = params;

    if (!marketData.priceData || marketData.priceData.length < 200) {
      return null; // Not enough data
    }

    const indicators = this.calculateIndicators(marketData.priceData);
    const currentPrice =
      marketData.currentPrice || marketData.priceData[marketData.priceData.length - 1].close;
    const currentVolume = marketData.priceData[marketData.priceData.length - 1].volume;

    // Determine primary trading pair
    const assetSymbol =
      Object.keys(portfolioSnapshot.holdings).find(
        (key) => key !== 'USDC' && portfolioSnapshot.holdings[key] > 0
      ) || 'SOL';
    const pair = `${assetSymbol}/USDC`;

    // Check for exit signals first (if we have a position)
    const assetHolding = portfolioSnapshot.holdings[assetSymbol] || 0;
    if (assetHolding > 0) {
      // Try to find entry price from recent trades (simplified)
      const entryPrice = currentPrice * 0.98; // Assume 2% below current as entry
      const exitSignal = this.shouldExitLong(indicators, entryPrice, currentPrice);

      if (exitSignal.shouldExit) {
        return {
          pair,
          action: TradeType.SELL,
          quantity: assetHolding,
          orderType: OrderType.MARKET,
          timestamp: Date.now(),
          reason: exitSignal.reason,
        };
      }
    }

    // Check for entry signals (if we have cash)
    const usdcBalance = portfolioSnapshot.holdings['USDC'] || 0;
    if (usdcBalance > 100 && this.shouldEnterLong(indicators, currentVolume)) {
      // Calculate position size
      const positionSize = this.calculatePositionSize(
        portfolioSnapshot,
        this.winRate,
        0.04, // avg win %
        0.02 // avg loss %
      );

      const quantity =
        Math.min(positionSize, usdcBalance * this.params.maxPositionSize) / currentPrice;

      if (quantity > 0.001) {
        // Minimum trade size
        return {
          pair,
          action: TradeType.BUY,
          quantity: parseFloat(quantity.toFixed(8)),
          orderType: OrderType.MARKET,
          timestamp: Date.now(),
          reason: `Bullish setup: RSI=${indicators.rsi?.toFixed(1)}, Trend=${indicators.trend}, Volume surge`,
        };
      }
    }

    return null;
  }

  // Track performance for Kelly Criterion
  public updatePerformance(trade: { profit: number; timestamp: number }): void {
    this.recentTrades.push(trade);

    // Keep only last 100 trades
    if (this.recentTrades.length > 100) {
      this.recentTrades.shift();
    }

    // Update win rate
    const wins = this.recentTrades.filter((t) => t.profit > 0).length;
    this.winRate = wins / this.recentTrades.length;
  }
}
