import { Service, AgentRuntime, elizaLogger } from '@elizaos/core';
import { Position, TradeOrder, TradeType } from '../types.ts';
import { RealtimePriceFeedService } from './RealtimePriceFeedService.ts';
import { AnalyticsService } from './analyticsService.ts';

export interface RiskLimits {
  maxPositionSize: number; // Max USD value per position
  maxPortfolioRisk: number; // Max % of portfolio at risk
  maxDailyLoss: number; // Max daily loss in USD
  maxCorrelatedExposure: number; // Max % in correlated assets
  stopLossPercent: number; // Default stop loss %
  takeProfitPercent: number; // Default take profit %
  maxLeverage: number; // Max leverage allowed
  minLiquidity: number; // Min 24h volume in USD
}

export interface RiskMetrics {
  portfolioValue: number;
  openPositions: number;
  totalExposure: number;
  currentDrawdown: number;
  dailyPnL: number;
  riskScore: number; // 0-100
  violations: string[];
}

export interface PositionSizeRecommendation {
  recommendedSize: number;
  maxSize: number;
  reasoning: string[];
  riskScore: number;
}

export class RiskManagementService extends Service {
  public static readonly serviceType = 'RiskManagementService';
  public readonly capabilityDescription =
    'Manages trading risk through position sizing, stop-loss, and portfolio limits';

  private priceFeedService?: RealtimePriceFeedService;
  private analyticsService?: AnalyticsService;
  private riskLimits: RiskLimits;
  private correlationMatrix = new Map<string, Map<string, number>>();
  private stopLosses = new Map<string, { price: number; percent: number }>();
  private takeProfits = new Map<string, { price: number; percent: number }>();

  constructor(runtime: AgentRuntime) {
    super(runtime);

    // Initialize default risk limits
    this.riskLimits = {
      maxPositionSize: parseFloat(runtime.getSetting('MAX_POSITION_SIZE') || '1000'),
      maxPortfolioRisk: parseFloat(runtime.getSetting('MAX_PORTFOLIO_RISK') || '20'), // 20%
      maxDailyLoss: parseFloat(runtime.getSetting('MAX_DAILY_LOSS') || '500'),
      maxCorrelatedExposure: parseFloat(runtime.getSetting('MAX_CORRELATED_EXPOSURE') || '50'), // 50%
      stopLossPercent: parseFloat(runtime.getSetting('STOP_LOSS_PERCENT') || '5'),
      takeProfitPercent: parseFloat(runtime.getSetting('TAKE_PROFIT_PERCENT') || '10'),
      maxLeverage: parseFloat(runtime.getSetting('MAX_LEVERAGE') || '1'),
      minLiquidity: parseFloat(runtime.getSetting('MIN_LIQUIDITY') || '100000'), // $100k daily volume
    };
  }

  public static async start(runtime: AgentRuntime): Promise<RiskManagementService> {
    elizaLogger.info(`[${RiskManagementService.serviceType}] Starting...`);
    const instance = new RiskManagementService(runtime);
    await instance.start();
    return instance;
  }

  public async start(): Promise<void> {
    elizaLogger.info(`[${RiskManagementService.serviceType}] Initializing risk management...`);

    // Get required services
    this.priceFeedService = this.runtime.getService(
      'RealtimePriceFeedService'
    ) as RealtimePriceFeedService;
    this.analyticsService = this.runtime.getService('AnalyticsService') as AnalyticsService;

    if (!this.priceFeedService || !this.analyticsService) {
      elizaLogger.warn(
        `[${RiskManagementService.serviceType}] Some services not available, operating with limited functionality`
      );
    }

    // Initialize correlation matrix for common meme coins
    this.initializeCorrelations();

    elizaLogger.info(
      `[${RiskManagementService.serviceType}] Started with limits:`,
      this.riskLimits
    );
  }

  public async stop(): Promise<void> {
    elizaLogger.info(`[${RiskManagementService.serviceType}] Stopped`);
  }

  /**
   * Initialize correlation matrix for risk calculations
   */
  private initializeCorrelations(): void {
    // Simplified correlation groups for meme coins
    const highCorrelation = 0.8;
    const mediumCorrelation = 0.5;
    const lowCorrelation = 0.2;

    // Dog coins are highly correlated
    const dogCoins = ['BONK', 'WIF', 'DOGE', 'SHIB', 'FLOKI'];
    dogCoins.forEach((coin1) => {
      const map = new Map<string, number>();
      dogCoins.forEach((coin2) => {
        if (coin1 === coin2) {
          map.set(coin2, 1.0);
        } else {
          map.set(coin2, highCorrelation);
        }
      });
      this.correlationMatrix.set(coin1, map);
    });

    // Other meme coins have medium correlation
    const otherMemes = ['PEPE', 'POPCAT', 'MEW', 'PNUT'];
    otherMemes.forEach((coin) => {
      const map = this.correlationMatrix.get(coin) || new Map();
      dogCoins.forEach((dogCoin) => {
        map.set(dogCoin, mediumCorrelation);
      });
      otherMemes.forEach((other) => {
        map.set(other, coin === other ? 1.0 : mediumCorrelation);
      });
      this.correlationMatrix.set(coin, map);
    });
  }

  /**
   * Validate if a trade order passes risk checks
   */
  public async validateTradeOrder(
    order: TradeOrder,
    positions: Position[],
    portfolioValue: number
  ): Promise<{ valid: boolean; reasons: string[] }> {
    const violations: string[] = [];

    // 1. Check position size limit
    const orderPrice = order.price || 0; // Use 0 if price not set (market order)
    const orderValue = order.quantity * orderPrice;
    if (orderValue > this.riskLimits.maxPositionSize && orderPrice > 0) {
      violations.push(
        `Position size $${orderValue.toFixed(2)} exceeds limit $${this.riskLimits.maxPositionSize}`
      );
    }

    // 2. Check daily loss limit
    const dailyPnL = (await this.analyticsService?.getTodaysPnL()) || 0;
    if (dailyPnL < -this.riskLimits.maxDailyLoss) {
      violations.push(`Daily loss limit of $${this.riskLimits.maxDailyLoss} reached`);
    }

    // 3. Check portfolio risk percentage
    const totalExposure =
      positions.reduce((sum, pos) => sum + pos.amount * (pos.currentPrice || pos.entryPrice), 0) +
      orderValue;
    const riskPercent = (totalExposure / portfolioValue) * 100;
    if (riskPercent > this.riskLimits.maxPortfolioRisk) {
      violations.push(
        `Portfolio risk ${riskPercent.toFixed(1)}% exceeds limit ${this.riskLimits.maxPortfolioRisk}%`
      );
    }

    // 4. Check liquidity (if we have market data)
    if (this.priceFeedService) {
      // Extract token address from pair (e.g., "SOL/USDC" -> "SOL")
      const tokenSymbol = order.pair.split('/')[0];
      const priceData = this.priceFeedService.getLatestPrice(tokenSymbol);
      if (priceData && priceData.volume24h < this.riskLimits.minLiquidity) {
        violations.push(
          `24h volume $${priceData.volume24h.toFixed(0)} below minimum $${this.riskLimits.minLiquidity}`
        );
      }
    }

    // 5. Check correlated exposure
    const correlatedExposure = await this.calculateCorrelatedExposure(order, positions);
    if (correlatedExposure > this.riskLimits.maxCorrelatedExposure) {
      violations.push(
        `Correlated exposure ${correlatedExposure.toFixed(1)}% exceeds limit ${this.riskLimits.maxCorrelatedExposure}%`
      );
    }

    return {
      valid: violations.length === 0,
      reasons: violations,
    };
  }

  /**
   * Calculate optimal position size based on risk parameters
   */
  public async calculatePositionSize(
    tokenAddress: string,
    portfolioValue: number,
    positions: Position[],
    strategy: string
  ): Promise<PositionSizeRecommendation> {
    const reasoning: string[] = [];
    let recommendedSize = this.riskLimits.maxPositionSize;
    let riskScore = 50; // Default medium risk

    // 1. Kelly Criterion for position sizing
    const winRate = 0.55; // Assume 55% win rate from historical data
    const avgWin = 0.1; // 10% average win
    const avgLoss = 0.05; // 5% average loss
    const kellyPercent = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;
    const kellySize = portfolioValue * Math.max(0, Math.min(kellyPercent, 0.25)); // Cap at 25%

    recommendedSize = Math.min(recommendedSize, kellySize);
    reasoning.push(`Kelly criterion suggests $${kellySize.toFixed(2)}`);

    // 2. Adjust for volatility
    const volatility = await this.calculateVolatility(tokenAddress);
    if (volatility > 0.1) {
      // High volatility (>10% daily)
      recommendedSize *= 0.5;
      riskScore += 20;
      reasoning.push(`High volatility (${(volatility * 100).toFixed(1)}%) - reduced size by 50%`);
    }

    // 3. Adjust for existing exposure
    const currentExposure = positions.reduce(
      (sum, pos) => sum + pos.amount * (pos.currentPrice || pos.entryPrice),
      0
    );
    const exposurePercent = (currentExposure / portfolioValue) * 100;
    if (exposurePercent > 50) {
      recommendedSize *= 0.3;
      riskScore += 15;
      reasoning.push(
        `High existing exposure (${exposurePercent.toFixed(1)}%) - reduced size by 70%`
      );
    }

    // 4. Adjust for correlation
    const correlatedTokens = await this.getCorrelatedTokens(tokenAddress);
    const correlatedPositions = positions.filter((pos) =>
      correlatedTokens.some((token) => token.address === pos.tokenAddress)
    );
    if (correlatedPositions.length > 0) {
      recommendedSize *= 1 - 0.2 * correlatedPositions.length; // Reduce 20% per correlated position
      riskScore += 10 * correlatedPositions.length;
      reasoning.push(`${correlatedPositions.length} correlated positions - reduced size`);
    }

    // 5. Strategy-specific adjustments
    if (strategy === 'momentum-v1') {
      recommendedSize *= 1.2; // Momentum strategies can be more aggressive
      reasoning.push(`Momentum strategy - increased size by 20%`);
    } else if (strategy === 'mean-reversion-v1') {
      recommendedSize *= 0.8; // Mean reversion needs more conservative sizing
      reasoning.push(`Mean reversion strategy - reduced size by 20%`);
    }

    // 6. Daily loss limit check
    const dailyPnL = (await this.analyticsService?.getTodaysPnL()) || 0;
    const remainingLossCapacity = this.riskLimits.maxDailyLoss + dailyPnL;
    const maxLossOnPosition = recommendedSize * (this.riskLimits.stopLossPercent / 100);
    if (maxLossOnPosition > remainingLossCapacity) {
      recommendedSize = remainingLossCapacity / (this.riskLimits.stopLossPercent / 100);
      riskScore += 25;
      reasoning.push(`Limited by daily loss capacity - max size $${recommendedSize.toFixed(2)}`);
    }

    // Final bounds check
    recommendedSize = Math.max(10, Math.min(recommendedSize, this.riskLimits.maxPositionSize));

    return {
      recommendedSize,
      maxSize: this.riskLimits.maxPositionSize,
      reasoning,
      riskScore: Math.min(100, riskScore),
    };
  }

  /**
   * Set stop-loss and take-profit levels for a position
   */
  public setStopLossAndTakeProfit(
    position: Position,
    customStopLoss?: number,
    customTakeProfit?: number
  ): { stopLoss: number; takeProfit: number } {
    const stopLossPercent = customStopLoss || this.riskLimits.stopLossPercent;
    const takeProfitPercent = customTakeProfit || this.riskLimits.takeProfitPercent;

    const stopLossPrice = position.entryPrice * (1 - stopLossPercent / 100);
    const takeProfitPrice = position.entryPrice * (1 + takeProfitPercent / 100);

    // Store the levels
    this.stopLosses.set(position.id, { price: stopLossPrice, percent: stopLossPercent });
    this.takeProfits.set(position.id, { price: takeProfitPrice, percent: takeProfitPercent });

    elizaLogger.info(
      `[${RiskManagementService.serviceType}] Set SL/TP for position ${position.id}:`,
      {
        entryPrice: position.entryPrice,
        stopLoss: stopLossPrice,
        takeProfit: takeProfitPrice,
      }
    );

    return { stopLoss: stopLossPrice, takeProfit: takeProfitPrice };
  }

  /**
   * Check if any positions hit stop-loss or take-profit
   */
  public checkStopLossAndTakeProfit(positions: Position[]): Position[] {
    const positionsToClose: Position[] = [];

    positions.forEach((position) => {
      if (!position.currentPrice) return;

      const stopLoss = this.stopLosses.get(position.id);
      const takeProfit = this.takeProfits.get(position.id);

      if (stopLoss && position.currentPrice <= stopLoss.price) {
        elizaLogger.warn(
          `[${RiskManagementService.serviceType}] Stop-loss hit for position ${position.id}`
        );
        positionsToClose.push(position);
      } else if (takeProfit && position.currentPrice >= takeProfit.price) {
        elizaLogger.info(
          `[${RiskManagementService.serviceType}] Take-profit hit for position ${position.id}`
        );
        positionsToClose.push(position);
      }
    });

    return positionsToClose;
  }

  /**
   * Get current risk metrics
   */
  public async getRiskMetrics(positions: Position[], portfolioValue: number): Promise<RiskMetrics> {
    const violations: string[] = [];

    // Calculate total exposure
    const totalExposure = positions.reduce(
      (sum, pos) => sum + pos.amount * (pos.currentPrice || pos.entryPrice),
      0
    );

    // Get daily P&L
    const dailyPnL = (await this.analyticsService?.getTodaysPnL()) || 0;

    // Calculate current drawdown
    const currentDrawdown = positions.reduce((sum, pos) => {
      const currentValue = pos.amount * (pos.currentPrice || pos.entryPrice);
      const entryValue = pos.amount * pos.entryPrice;
      return sum + Math.min(0, currentValue - entryValue);
    }, 0);

    // Check violations
    if (totalExposure > portfolioValue * (this.riskLimits.maxPortfolioRisk / 100)) {
      violations.push('Portfolio risk limit exceeded');
    }
    if (dailyPnL < -this.riskLimits.maxDailyLoss) {
      violations.push('Daily loss limit exceeded');
    }

    // Calculate risk score (0-100)
    let riskScore = 0;
    riskScore += (totalExposure / portfolioValue) * 50; // Exposure contributes 50%
    riskScore += Math.abs(dailyPnL / this.riskLimits.maxDailyLoss) * 30; // Daily loss contributes 30%
    riskScore += (positions.length / 10) * 20; // Number of positions contributes 20%

    return {
      portfolioValue,
      openPositions: positions.length,
      totalExposure,
      currentDrawdown,
      dailyPnL,
      riskScore: Math.min(100, Math.max(0, riskScore)),
      violations,
    };
  }

  /**
   * Calculate portfolio heat map
   */
  public async getPortfolioHeatMap(positions: Position[]): Promise<Map<string, number>> {
    const heatMap = new Map<string, number>();

    for (const position of positions) {
      const pnlPercent = position.currentPrice
        ? ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100
        : 0;

      // Heat score: -100 (cold/losing) to +100 (hot/winning)
      const heatScore = Math.max(-100, Math.min(100, pnlPercent * 10));
      heatMap.set(position.tokenAddress, heatScore);
    }

    return heatMap;
  }

  /**
   * Update risk limits
   */
  public updateRiskLimits(newLimits: Partial<RiskLimits>): void {
    this.riskLimits = { ...this.riskLimits, ...newLimits };
    elizaLogger.info(
      `[${RiskManagementService.serviceType}] Updated risk limits:`,
      this.riskLimits
    );
  }

  /**
   * Calculate volatility for a token
   */
  private async calculateVolatility(tokenAddress: string): Promise<number> {
    // For now, return a default volatility since getHistoricalPrices doesn't exist
    // In a real implementation, this would fetch from a price feed service
    return 0.05; // Default 5% volatility
  }

  /**
   * Calculate correlated exposure
   */
  private async calculateCorrelatedExposure(
    order: TradeOrder,
    positions: Position[]
  ): Promise<number> {
    let correlatedValue = 0;
    // Use a default portfolio value since getPortfolioValue doesn't exist
    const portfolioValue = 10000;

    // Extract token symbol from pair
    const orderSymbol = order.pair.split('/')[0];
    const orderCorrelations = this.correlationMatrix.get(orderSymbol) || new Map();

    positions.forEach((position) => {
      // Extract symbol from position - assuming tokenAddress contains symbol for now
      const positionSymbol = position.tokenAddress.substring(0, 4).toUpperCase(); // Simplified
      const correlation = orderCorrelations.get(positionSymbol) || 0;
      if (correlation > 0.5) {
        // Consider correlation above 0.5
        const positionPrice = position.currentPrice || position.entryPrice;
        correlatedValue += position.amount * positionPrice * correlation;
      }
    });

    // Add the new order value
    const orderPrice = order.price || 0;
    correlatedValue += order.quantity * orderPrice;

    return (correlatedValue / portfolioValue) * 100;
  }

  /**
   * Get correlated tokens
   */
  private async getCorrelatedTokens(
    tokenAddress: string
  ): Promise<{ address: string; correlation: number }[]> {
    const correlations = this.correlationMatrix.get(tokenAddress) || new Map();
    const correlated: { address: string; correlation: number }[] = [];

    correlations.forEach((correlation, address) => {
      if (correlation > 0.5 && address !== tokenAddress) {
        correlated.push({ address, correlation });
      }
    });

    return correlated.sort((a, b) => b.correlation - a.correlation);
  }
}
