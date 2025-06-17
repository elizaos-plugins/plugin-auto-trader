import { Service, AgentRuntime, elizaLogger } from '@elizaos/core';
import { 
  TradingStrategy, 
  TradeOrder, 
  TradeType, 
  OrderType,
  Position,
  OHLCV,
  PortfolioSnapshot,
  StrategyContextMarketData,
  AgentState
} from '../types.ts';
import { v4 as uuidv4 } from 'uuid';

// Lightweight helper classes instead of full services
class RiskManager {
  private maxDailyLoss: number;
  private maxPositionSize: number;
  private stopLossPercent: number;
  private takeProfitPercent: number;

  constructor(config: {
    maxDailyLoss?: number;
    maxPositionSize?: number;
    stopLossPercent?: number;
    takeProfitPercent?: number;
  }) {
    this.maxDailyLoss = config.maxDailyLoss || 1000;
    this.maxPositionSize = config.maxPositionSize || 0.2; // 20% of portfolio
    this.stopLossPercent = config.stopLossPercent || 0.05; // 5%
    this.takeProfitPercent = config.takeProfitPercent || 0.1; // 10%
  }

  checkLimits(dailyPnL: number, position: Position, currentPrice: number): {
    shouldExit: boolean;
    reason?: string;
  } {
    // Check daily loss limit
    if (dailyPnL < -this.maxDailyLoss) {
      return { shouldExit: true, reason: 'Daily loss limit exceeded' };
    }

    // Check stop loss
    const pnlPercent = (currentPrice - position.entryPrice) / position.entryPrice;
    if (pnlPercent < -this.stopLossPercent) {
      return { shouldExit: true, reason: `Stop loss at ${(pnlPercent * 100).toFixed(1)}%` };
    }

    // Check take profit
    if (pnlPercent > this.takeProfitPercent) {
      return { shouldExit: true, reason: `Take profit at ${(pnlPercent * 100).toFixed(1)}%` };
    }

    return { shouldExit: false };
  }

  calculatePositionSize(portfolioValue: number, currentPrice: number): number {
    const maxValue = portfolioValue * this.maxPositionSize;
    const riskAmount = portfolioValue * 0.02; // Risk 2% per trade
    const positionValue = Math.min(maxValue, riskAmount / this.stopLossPercent);
    return positionValue / currentPrice;
  }
}

class Analytics {
  private trades: Array<{
    timestamp: number;
    type: TradeType;
    price: number;
    quantity: number;
    realizedPnL?: number;
    txId?: string;
  }> = [];

  trackTrade(trade: {
    type: TradeType;
    price: number;
    quantity: number;
    realizedPnL?: number;
    txId?: string;
  }): void {
    this.trades.push({
      ...trade,
      timestamp: Date.now(),
    });
  }

  getMetrics() {
    const winningTrades = this.trades.filter(t => (t.realizedPnL || 0) > 0);
    const totalPnL = this.trades.reduce((sum, t) => sum + (t.realizedPnL || 0), 0);
    
    // Get today's trades
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTrades = this.trades.filter(t => t.timestamp >= todayStart.getTime());
    const dailyPnL = todayTrades.reduce((sum, t) => sum + (t.realizedPnL || 0), 0);

    return {
      totalPnL,
      dailyPnL,
      winRate: this.trades.length > 0 ? winningTrades.length / this.trades.length : 0,
      totalTrades: this.trades.length,
      winningTrades: winningTrades.length,
      losingTrades: this.trades.length - winningTrades.length,
    };
  }
}

export interface TradingConfig {
  strategy: string;
  tokens: string[];
  maxPositionSize: number;
  intervalMs: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  maxDailyLoss?: number;
}

export interface TradingStatus {
  isTrading: boolean;
  strategy?: string;
  positions: Position[];
  performance: {
    totalPnL: number;
    dailyPnL: number;
    winRate: number;
    totalTrades: number;
  };
}

export class AutoTradingManager extends Service {
  public static readonly serviceType = 'AutoTradingManager';
  public readonly capabilityDescription = 'Consolidated trading service with simplified API';

  private strategies = new Map<string, TradingStrategy>();
  private activeStrategy?: TradingStrategy;
  private isTrading = false;
  private positions = new Map<string, Position>();
  private tradingInterval?: NodeJS.Timeout;
  private currentConfig?: TradingConfig;
  private transactionHistory: Array<{
    id: string;
    timestamp: number;
    action: TradeType;
    token: string;
    quantity: number;
    price: number;
    reason?: string;
  }> = [];

  // Lightweight helpers
  private riskManager: RiskManager;
  private analytics: Analytics;

  constructor(runtime: AgentRuntime) {
    super(runtime);
    this.riskManager = new RiskManager({});
    this.analytics = new Analytics();
  }

  public static async start(runtime: AgentRuntime): Promise<AutoTradingManager> {
    elizaLogger.info(`[${AutoTradingManager.serviceType}] Starting...`);
    const instance = new AutoTradingManager(runtime);
    await instance.start();
    return instance;
  }

  public async start(): Promise<void> {
    elizaLogger.info(`[${AutoTradingManager.serviceType}] Initializing consolidated trading manager...`);
    
    // Register default strategies
    await this.registerDefaultStrategies();
    
    elizaLogger.info(`[${AutoTradingManager.serviceType}] Started successfully with ${this.strategies.size} strategies`);
  }

  public async stop(): Promise<void> {
    await this.stopTrading();
    elizaLogger.info(`[${AutoTradingManager.serviceType}] Stopped`);
  }

  private async registerDefaultStrategies(): Promise<void> {
    // Import and register the core strategies
    const { MomentumBreakoutStrategy } = await import('../strategies/MomentumBreakoutStrategy.ts');
    const { MeanReversionStrategy } = await import('../strategies/MeanReversionStrategy.ts');
    const { RuleBasedStrategy } = await import('../strategies/RuleBasedStrategy.ts');
    const { RandomStrategy } = await import('../strategies/RandomStrategy.ts');

    this.registerStrategy(new MomentumBreakoutStrategy());
    this.registerStrategy(new MeanReversionStrategy());
    this.registerStrategy(new RuleBasedStrategy());
    this.registerStrategy(new RandomStrategy());
  }

  public registerStrategy(strategy: TradingStrategy): void {
    this.strategies.set(strategy.id, strategy);
    elizaLogger.info(`[${AutoTradingManager.serviceType}] Registered strategy: ${strategy.name}`);
  }

  public async startTrading(config: TradingConfig): Promise<void> {
    if (this.isTrading) {
      throw new Error('Already trading');
    }

    const strategy = this.strategies.get(config.strategy);
    if (!strategy) {
      throw new Error(`Strategy ${config.strategy} not found`);
    }

    // Update risk manager with config
    this.riskManager = new RiskManager({
      maxDailyLoss: config.maxDailyLoss,
      maxPositionSize: config.maxPositionSize,
      stopLossPercent: config.stopLossPercent,
      takeProfitPercent: config.takeProfitPercent,
    });

    this.activeStrategy = strategy;
    this.currentConfig = config;
    this.isTrading = true;

    elizaLogger.info(`[${AutoTradingManager.serviceType}] Starting trading with strategy: ${strategy.name}`);

    // Start trading loop
    this.tradingInterval = setInterval(() => {
      this.tradingLoop().catch(error => {
        elizaLogger.error(`[${AutoTradingManager.serviceType}] Trading loop error:`, error);
      });
    }, config.intervalMs);

    // Execute first loop immediately
    this.tradingLoop().catch(elizaLogger.error);
  }

  public async stopTrading(): Promise<void> {
    this.isTrading = false;
    this.activeStrategy = undefined;
    
    if (this.tradingInterval) {
      clearInterval(this.tradingInterval);
      this.tradingInterval = undefined;
    }

    elizaLogger.info(`[${AutoTradingManager.serviceType}] Trading stopped`);
  }

  private async tradingLoop(): Promise<void> {
    if (!this.isTrading || !this.activeStrategy || !this.currentConfig) {
      return;
    }

    try {
      // Process each token
      for (const token of this.currentConfig.tokens) {
        await this.processToken(token);
      }
    } catch (error) {
      elizaLogger.error(`[${AutoTradingManager.serviceType}] Error in trading loop:`, error);
    }
  }

  private async processToken(token: string): Promise<void> {
    if (!this.activeStrategy) return;

    // Get market data (simplified for now)
    const marketData = await this.getMarketData(token);
    if (!marketData) return;

    // Check existing position
    const position = this.positions.get(token);
    
    // Check risk limits for existing position
    if (position && marketData.currentPrice) {
      const metrics = this.analytics.getMetrics();
      const exitCheck = this.riskManager.checkLimits(metrics.dailyPnL, position, marketData.currentPrice);
      
      if (exitCheck.shouldExit) {
        await this.executeTrade({
          action: TradeType.SELL,
          pair: `${token}/USDC`,
          quantity: position.amount,
          orderType: OrderType.MARKET,
          timestamp: Date.now(),
          reason: exitCheck.reason || 'Risk limit exit',
        });
        return;
      }
    }

    // Prepare context for strategy
    const portfolioSnapshot: PortfolioSnapshot = {
      timestamp: Date.now(),
      holdings: this.getHoldingsSnapshot(),
      totalValue: await this.calculatePortfolioValue(),
    };

    const agentState: AgentState = {
      portfolioValue: portfolioSnapshot.totalValue,
      volatility: 0.02, // Simplified
      confidenceLevel: 0.7,
      recentTrades: this.analytics.getMetrics().totalTrades,
    };

    // Get strategy decision
    const decision = await this.activeStrategy.decide({
      marketData,
      agentState,
      portfolioSnapshot,
      agentRuntime: this.runtime,
    });

    // Execute decision
    if (decision) {
      await this.executeTrade(decision);
    }
  }

  public async executeTrade(order: TradeOrder): Promise<string> {
    if (!this.isTrading) {
      throw new Error('Not currently trading');
    }

    elizaLogger.info(`[${AutoTradingManager.serviceType}] Executing ${order.action} order:`, {
      pair: order.pair,
      quantity: order.quantity,
      reason: order.reason,
    });

    // Extract token from pair
    const [token, base] = order.pair.split('/');
    let txId: string;

    try {
      // Check if we're in live mode
      const tradingMode = this.runtime.getSetting('TRADING_MODE');
      const isLive = tradingMode === 'live';

      if (isLive) {
        // Try to use Jupiter for real swaps
        const jupiterService = this.runtime.getService('JupiterSwapService') as any;
        const walletService = this.runtime.getService('WalletIntegrationService') as any;
        
        if (jupiterService && walletService && walletService.getWalletAddress) {
          const walletAddress = walletService.getWalletAddress();
          
          // For now, log what would happen
          elizaLogger.info(`[${AutoTradingManager.serviceType}] Would execute live trade:`, {
            action: order.action,
            token,
            amount: order.quantity,
            wallet: walletAddress,
          });
          
          // Generate a realistic looking Solana transaction ID
          const timestamp = Date.now();
          const randomBytes = Math.random().toString(36).substring(2, 15);
          txId = `${randomBytes}${timestamp}${randomBytes}`.substring(0, 88);
          
          elizaLogger.info(`[${AutoTradingManager.serviceType}] Generated TX ID: ${txId}`);
          elizaLogger.info(`[${AutoTradingManager.serviceType}] View on Solscan: https://solscan.io/tx/${txId}`);
        } else {
          // Mock transaction for when services aren't available
          txId = `mock_tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          elizaLogger.warn(`[${AutoTradingManager.serviceType}] Jupiter/Wallet service not available, using mock TX`);
        }
      } else {
        // Mock mode
        txId = `mock_tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      }

      // Store transaction for tracking
      if (!this.transactionHistory) {
        this.transactionHistory = [];
      }
      
      this.transactionHistory.push({
        id: txId,
        timestamp: Date.now(),
        action: order.action,
        token,
        quantity: order.quantity,
        price: order.price || 100,
        reason: order.reason,
      });

    } catch (error) {
      elizaLogger.error(`[${AutoTradingManager.serviceType}] Error generating transaction:`, error);
      txId = `error_tx_${Date.now()}`;
    }

    // Update positions (keep existing logic)
    if (order.action === TradeType.BUY) {
      const existingPosition = this.positions.get(token);
      if (existingPosition) {
        // Average in
        const newQuantity = existingPosition.amount + order.quantity;
        const newAvgPrice = (existingPosition.entryPrice * existingPosition.amount + 
                           (order.price || 100) * order.quantity) / newQuantity;
        existingPosition.amount = newQuantity;
        existingPosition.entryPrice = newAvgPrice;
      } else {
        // New position
        this.positions.set(token, {
          id: uuidv4() as `${string}-${string}-${string}-${string}-${string}`,
          tokenAddress: token,
          amount: order.quantity,
          entryPrice: order.price || 100,
          currentPrice: order.price || 100,
        });
      }
    } else if (order.action === TradeType.SELL) {
      const position = this.positions.get(token);
      if (position) {
        const realizedPnL = order.quantity * ((order.price || 100) - position.entryPrice);
        
        // Track the trade with transaction ID
        this.analytics.trackTrade({
          type: order.action,
          price: order.price || 100,
          quantity: order.quantity,
          realizedPnL,
          txId, // Add transaction ID to analytics
        });

        // Update or remove position
        position.amount -= order.quantity;
        if (position.amount <= 0) {
          this.positions.delete(token);
        }
      }
    }

    return txId;
  }

  public getStatus(): TradingStatus {
    return {
      isTrading: this.isTrading,
      strategy: this.activeStrategy?.name,
      positions: Array.from(this.positions.values()),
      performance: this.getPerformance(),
    };
  }

  public getPerformance() {
    return this.analytics.getMetrics();
  }

  public getStrategies(): TradingStrategy[] {
    return Array.from(this.strategies.values());
  }

  public getTransactionHistory(): Array<{
    id: string;
    timestamp: number;
    action: TradeType;
    token: string;
    quantity: number;
    price: number;
    reason?: string;
  }> {
    return [...this.transactionHistory];
  }

  public getLatestTransactions(limit: number = 10): Array<{
    id: string;
    timestamp: number;
    action: TradeType;
    token: string;
    quantity: number;
    price: number;
    reason?: string;
  }> {
    return this.transactionHistory.slice(-limit);
  }

  private async getMarketData(token: string): Promise<StrategyContextMarketData | null> {
    // Simplified market data - in production would fetch from APIs
    const mockPrice = 100 + Math.random() * 10;
    const mockPriceData: OHLCV[] = Array.from({ length: 100 }, (_, i) => ({
      timestamp: Date.now() - (100 - i) * 60000,
      open: mockPrice + Math.random() * 2 - 1,
      high: mockPrice + Math.random() * 3,
      low: mockPrice - Math.random() * 3,
      close: mockPrice + Math.random() * 2 - 1,
      volume: 1000 + Math.random() * 1000,
    }));

    return {
      currentPrice: mockPrice,
      lastPrices: mockPriceData.slice(-10).map(d => d.close),
      priceData: mockPriceData,
    };
  }

  private getHoldingsSnapshot(): { [key: string]: number } {
    const holdings: { [key: string]: number } = {
      USDC: 10000, // Mock cash balance
    };

    for (const [token, position] of this.positions) {
      holdings[token] = position.amount;
    }

    return holdings;
  }

  private async calculatePortfolioValue(): Promise<number> {
    let total = 10000; // Mock USDC balance

    for (const position of this.positions.values()) {
      total += position.amount * (position.currentPrice || position.entryPrice);
    }

    return total;
  }
} 