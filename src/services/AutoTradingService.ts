import { Service, AgentRuntime, elizaLogger, UUID } from '@elizaos/core';
import { TradingStrategy, Position, TradeOrder, TradeType, OrderType, OHLCV } from '../types.ts';
import { StrategyRegistryService } from './StrategyRegistryService.ts';
import { TokenResolverService } from './TokenResolverService.ts';
import { AnalyticsService } from './analyticsService.ts';
import { DefaultHistoricalDataService } from './HistoricalDataService.ts';
import { WalletIntegrationService } from './WalletIntegrationService.ts';
import { JupiterSwapService } from './JupiterSwapService.ts';
import { RealtimePriceFeedService } from './RealtimePriceFeedService.ts';
import { RiskManagementService } from './RiskManagementService.ts';
import { TransactionMonitoringService } from './TransactionMonitoringService.ts';
import { Connection, PublicKey } from '@solana/web3.js';
import { VERIFIED_MEME_COINS } from '../config/memeCoins.ts';
import { v4 as uuidv4 } from 'uuid';

export interface TradingConfig {
  strategy: string;
  tokens: string[]; // Token addresses to trade
  maxPositionSize: number;
  intervalMs: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  maxDailyLoss?: number;
}

export interface TradeExecution {
  tokenAddress: string;
  type: 'BUY' | 'SELL';
  amount: number;
  price: number;
  txSignature?: string;
  timestamp: number;
  status: 'pending' | 'success' | 'failed';
  error?: string;
}

export class AutoTradingService extends Service {
  public static readonly serviceType = 'AutoTradingService';
  public readonly capabilityDescription =
    'Autonomous trading service that executes strategies in real-time';

  private isTrading = false;
  private tradingInterval?: ReturnType<typeof setInterval>;
  private currentStrategy?: TradingStrategy;
  private currentConfig?: TradingConfig;
  private positions: Map<string, Position> = new Map();
  private dailyPnL = 0;
  private totalPnL = 0;
  private lastTradingLoopTime = 0;

  // Service dependencies
  private strategyRegistry!: StrategyRegistryService;
  private tokenResolver!: TokenResolverService;
  private analytics!: AnalyticsService;
  private historicalData!: DefaultHistoricalDataService;
  private walletService?: WalletIntegrationService;
  private jupiterService?: JupiterSwapService;
  private priceFeedService?: RealtimePriceFeedService;
  private riskManagementService?: RiskManagementService;
  private transactionMonitoringService?: TransactionMonitoringService;

  constructor(runtime: AgentRuntime) {
    super(runtime);
  }

  public static async start(runtime: AgentRuntime): Promise<AutoTradingService> {
    elizaLogger.info(`[${AutoTradingService.serviceType}] Starting...`);
    const instance = new AutoTradingService(runtime);
    await instance.start();
    return instance;
  }

  public async start(): Promise<void> {
    elizaLogger.info(`[${AutoTradingService.serviceType}] Initializing dependencies...`);

    // Get required services
    this.strategyRegistry = this.runtime.getService(
      'StrategyRegistryService'
    ) as StrategyRegistryService;
    this.tokenResolver = this.runtime.getService('TokenResolverService') as TokenResolverService;
    this.analytics = this.runtime.getService('AnalyticsService') as AnalyticsService;
    this.historicalData = this.runtime.getService(
      'HistoricalDataService'
    ) as DefaultHistoricalDataService;

    if (!this.strategyRegistry || !this.tokenResolver || !this.analytics || !this.historicalData) {
      throw new Error(`[${AutoTradingService.serviceType}] Failed to resolve dependencies`);
    }

    // Optional services for enhanced functionality
    this.walletService = this.runtime.getService(
      'WalletIntegrationService'
    ) as WalletIntegrationService;
    this.jupiterService = this.runtime.getService('JupiterSwapService') as JupiterSwapService;
    this.priceFeedService = this.runtime.getService(
      'RealtimePriceFeedService'
    ) as RealtimePriceFeedService;
    this.riskManagementService = this.runtime.getService(
      'RiskManagementService'
    ) as RiskManagementService;
    this.transactionMonitoringService = this.runtime.getService(
      'TransactionMonitoringService'
    ) as TransactionMonitoringService;

    if (
      this.runtime.getSetting('TRADING_MODE') === 'live' &&
      !this.walletService?.isWalletAvailable()
    ) {
      elizaLogger.warn(
        `[${AutoTradingService.serviceType}] Live trading mode but wallet not available`
      );
    }

    // Load saved positions from database/memory
    await this.loadSavedPositions();

    // Check if auto-start is enabled
    const autoStart = this.runtime.getSetting('AUTO_START') === 'true';
    if (autoStart) {
      const defaultStrategy =
        this.runtime.getSetting('DEFAULT_STRATEGY') || 'optimized-momentum-v1';
      const defaultTokens = this.runtime.getSetting('ALLOWED_TOKENS')?.split(',') || ['BONK'];
      const maxPositionSize = parseFloat(this.runtime.getSetting('MAX_POSITION_SIZE') || '1000');

      await this.startTrading({
        strategy: defaultStrategy,
        tokens: this.resolveTokenAddresses(defaultTokens),
        maxPositionSize,
        intervalMs: 60000, // 1 minute default
      });
    }

    elizaLogger.info(`[${AutoTradingService.serviceType}] Started successfully`);
  }

  public async stop(): Promise<void> {
    await this.stopTrading();
    elizaLogger.info(`[${AutoTradingService.serviceType}] Stopped`);
  }

  public async startTrading(config: TradingConfig): Promise<void> {
    if (this.isTrading) {
      elizaLogger.warn(`[${AutoTradingService.serviceType}] Trading is already active`);
      return;
    }

    // Validate configuration
    const strategy = this.strategyRegistry.getStrategy(config.strategy);
    if (!strategy) {
      throw new Error(`Strategy ${config.strategy} not found`);
    }

    // Initialize strategy if needed
    if (strategy.initialize) {
      await strategy.initialize(this.runtime);
    }

    this.currentStrategy = strategy;
    this.currentConfig = config;
    this.isTrading = true;
    this.dailyPnL = 0; // Reset daily P&L

    elizaLogger.info(
      `[${AutoTradingService.serviceType}] Starting trading with strategy: ${strategy.name}`
    );

    // Start the trading loop
    this.tradingInterval = setInterval(() => {
      this.tradingLoop().catch((error) => {
        elizaLogger.error(`[${AutoTradingService.serviceType}] Trading loop error:`, error);
      });
    }, config.intervalMs);

    // Execute first loop immediately
    this.tradingLoop().catch(elizaLogger.error);
  }

  public async stopTrading(): Promise<void> {
    if (!this.isTrading) {
      elizaLogger.warn(`[${AutoTradingService.serviceType}] Trading is not active`);
      return;
    }

    this.isTrading = false;
    if (this.tradingInterval) {
      clearInterval(this.tradingInterval);
      this.tradingInterval = undefined;
    }

    elizaLogger.info(`[${AutoTradingService.serviceType}] Trading stopped`);
  }

  private async tradingLoop(): Promise<void> {
    if (!this.isTrading || !this.currentStrategy || !this.currentConfig) {
      return;
    }

    const startTime = Date.now();
    elizaLogger.debug(`[${AutoTradingService.serviceType}] Trading loop started`);

    try {
      // Check risk limits first
      if (!this.checkRiskLimits()) {
        elizaLogger.warn(
          `[${AutoTradingService.serviceType}] Risk limits exceeded, skipping trading loop`
        );
        return;
      }

      // Process each token
      for (const tokenAddress of this.currentConfig.tokens) {
        await this.processToken(tokenAddress);
      }

      // Update metrics
      await this.updateMetrics();
    } catch (error) {
      elizaLogger.error(`[${AutoTradingService.serviceType}] Trading loop error:`, error);
    }

    const duration = Date.now() - startTime;
    elizaLogger.debug(
      `[${AutoTradingService.serviceType}] Trading loop completed in ${duration}ms`
    );
    this.lastTradingLoopTime = Date.now();
  }

  private async processToken(tokenAddress: string): Promise<void> {
    try {
      // Get current market data
      const marketData = await this.getMarketData(tokenAddress);
      if (!marketData || !marketData.priceData || marketData.priceData.length === 0) {
        elizaLogger.warn(`[${AutoTradingService.serviceType}] No market data for ${tokenAddress}`);
        return;
      }

      // Get current position
      const position = this.positions.get(tokenAddress);

      // Prepare context for strategy
      const portfolioValue = await this.calculatePortfolioValue();
      const agentState = {
        portfolioValue,
        volatility: this.calculateVolatility(marketData.lastPrices),
        confidenceLevel: 0.7,
        recentTrades: this.getRecentTradeCount(),
      };

      const portfolioSnapshot = {
        timestamp: Date.now(),
        holdings: this.getHoldingsSnapshot(),
        totalValue: portfolioValue,
      };

      // Get strategy decision
      const decision = await this.currentStrategy!.decide({
        marketData,
        agentState,
        portfolioSnapshot,
        agentRuntime: this.runtime,
      });

      // Execute decision if any
      if (decision) {
        await this.executeTrade(tokenAddress, decision);
      }

      // Check stop-loss/take-profit for existing positions
      if (position) {
        await this.checkPositionLimits(position, marketData.currentPrice);
      }
    } catch (error) {
      elizaLogger.error(
        `[${AutoTradingService.serviceType}] Error processing token ${tokenAddress}:`,
        error
      );
    }
  }

  private async getMarketData(tokenAddress: string): Promise<any> {
    try {
      let currentPrice: number;
      let priceData: any[];

      // Try real-time price feed first
      if (this.priceFeedService) {
        const latestPrice = this.priceFeedService.getLatestPrice(tokenAddress);
        if (latestPrice && Date.now() - latestPrice.timestamp < 60000) {
          // Less than 1 minute old
          currentPrice = latestPrice.price;
          elizaLogger.debug(
            `[${AutoTradingService.serviceType}] Using real-time price for ${tokenAddress}: $${currentPrice}`
          );
        }
      }

      // Get historical data
      const endDate = new Date();
      const startDate = new Date();
      startDate.setHours(startDate.getHours() - 24); // Last 24 hours

      priceData = await this.historicalData.fetchData(
        tokenAddress,
        '1h',
        startDate,
        endDate,
        'birdeye'
      );

      if (!priceData || priceData.length === 0) {
        // If no historical data but we have real-time price, create minimal data
        if (currentPrice!) {
          return {
            currentPrice,
            lastPrices: [currentPrice],
            priceData: [
              {
                timestamp: Date.now(),
                open: currentPrice,
                high: currentPrice,
                low: currentPrice,
                close: currentPrice,
                volume: 0,
              },
            ],
          };
        }
        return null;
      }

      // Use historical close if no real-time price
      if (!currentPrice!) {
        currentPrice = priceData[priceData.length - 1].close;
      }

      const lastPrices = priceData.map((d) => d.close);

      return {
        currentPrice,
        lastPrices,
        priceData,
      };
    } catch (error) {
      elizaLogger.error(`[${AutoTradingService.serviceType}] Error fetching market data:`, error);
      return null;
    }
  }

  private async executeTrade(tokenAddress: string, order: TradeOrder): Promise<void> {
    elizaLogger.info(
      `[${AutoTradingService.serviceType}] Executing ${order.action} order for ${tokenAddress}`
    );

    // Risk management check
    if (this.riskManagementService) {
      const portfolioValue = await this.calculatePortfolioValue();
      const riskCheck = await this.riskManagementService.validateTradeOrder(
        order,
        this.getPositions(),
        portfolioValue
      );

      if (!riskCheck.valid) {
        elizaLogger.warn(
          `[${AutoTradingService.serviceType}] Order blocked by risk management:`,
          riskCheck.reasons
        );
        return;
      }
    }

    const execution: TradeExecution = {
      tokenAddress,
      type: order.action,
      amount: order.quantity,
      price: 0, // Will be set after execution
      timestamp: Date.now(),
      status: 'pending',
    };

    try {
      // In paper trading mode, simulate the trade
      if (this.runtime.getSetting('TRADING_MODE') !== 'live') {
        execution.price = await this.simulateTrade(tokenAddress, order);
        execution.status = 'success';
        execution.txSignature = `sim_${Date.now()}`;
      } else {
        // Live trading
        if (!this.walletService?.isWalletAvailable()) {
          throw new Error('Wallet not available for live trading');
        }

        // Get current market price for reference
        const marketData = await this.getMarketData(tokenAddress);
        if (!marketData) {
          throw new Error('No market data available');
        }

        // For live trading, we'll use market price with slippage
        const slippage = 0.01; // 1% slippage tolerance
        const expectedPrice =
          order.action === TradeType.BUY
            ? marketData.currentPrice * (1 + slippage)
            : marketData.currentPrice * (1 - slippage);

        // Execute swap through wallet service
        // USDC mint on Solana mainnet
        const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

        const swapParams =
          order.action === TradeType.BUY
            ? {
                inputMint: USDC_MINT,
                outputMint: tokenAddress,
                amount: order.quantity * expectedPrice, // USD amount
                slippage: slippage,
              }
            : {
                inputMint: tokenAddress,
                outputMint: USDC_MINT,
                amount: order.quantity,
                slippage: slippage,
              };

        elizaLogger.info(`[${AutoTradingService.serviceType}] Executing live swap:`, swapParams);

        // Execute the swap
        execution.txSignature = await this.walletService.executeSwap(swapParams);
        execution.price = expectedPrice;
        execution.status = 'success';

        elizaLogger.info(
          `[${AutoTradingService.serviceType}] Live trade executed: ${execution.txSignature}`
        );

        // Monitor transaction
        if (this.transactionMonitoringService && execution.txSignature) {
          await this.transactionMonitoringService.monitorTransaction(execution.txSignature, 'swap');
        }
      }

      // Update positions
      if (execution.status === 'success') {
        await this.updatePosition(tokenAddress, order, execution.price);

        // Set stop-loss and take-profit
        if (this.riskManagementService && order.action === TradeType.BUY) {
          const position = this.positions.get(tokenAddress);
          if (position) {
            this.riskManagementService.setStopLossAndTakeProfit(position);
          }
        }

        // Record trade
        await this.analytics.recordTrade({
          tokenAddress,
          type: order.action,
          amount: order.quantity,
          price: execution.price,
          timestamp: execution.timestamp,
          txSignature: execution.txSignature,
        });
      }
    } catch (error: any) {
      execution.status = 'failed';
      execution.error = error.message;
      elizaLogger.error(`[${AutoTradingService.serviceType}] Trade execution failed:`, error);
    }
  }

  private async simulateTrade(tokenAddress: string, order: TradeOrder): Promise<number> {
    // Get current market price
    const marketData = await this.getMarketData(tokenAddress);
    if (!marketData) {
      throw new Error('No market data available');
    }

    const currentPrice = marketData.currentPrice;
    const slippage = 0.001; // 0.1% slippage

    // Apply slippage
    if (order.action === TradeType.BUY) {
      return currentPrice * (1 + slippage);
    } else {
      return currentPrice * (1 - slippage);
    }
  }

  private async updatePosition(
    tokenAddress: string,
    order: TradeOrder,
    executedPrice: number
  ): Promise<void> {
    const existingPosition = this.positions.get(tokenAddress);

    if (order.action === TradeType.BUY) {
      if (existingPosition) {
        // Average up/down
        const newQuantity = existingPosition.amount + order.quantity;
        const newAvgPrice =
          (existingPosition.entryPrice * existingPosition.amount + executedPrice * order.quantity) /
          newQuantity;

        existingPosition.amount = newQuantity;
        existingPosition.entryPrice = newAvgPrice;
      } else {
        // New position
        this.positions.set(tokenAddress, {
          id: uuidv4() as UUID,
          tokenAddress,
          amount: order.quantity,
          entryPrice: executedPrice,
          currentPrice: executedPrice,
        });
      }
    } else if (order.action === TradeType.SELL && existingPosition) {
      const sellQuantity = Math.min(order.quantity, existingPosition.amount);
      const realizedPnL = sellQuantity * (executedPrice - existingPosition.entryPrice);

      this.dailyPnL += realizedPnL;
      this.totalPnL += realizedPnL;

      existingPosition.amount -= sellQuantity;
      if (existingPosition.amount <= 0) {
        this.positions.delete(tokenAddress);
      }
    }
  }

  private checkRiskLimits(): boolean {
    if (!this.currentConfig) return false;

    // Check daily loss limit
    const maxDailyLoss =
      this.currentConfig.maxDailyLoss ||
      parseFloat(this.runtime.getSetting('DAILY_LOSS_LIMIT') || '1000');

    if (this.dailyPnL < -maxDailyLoss) {
      elizaLogger.warn(
        `[${AutoTradingService.serviceType}] Daily loss limit reached: ${this.dailyPnL}`
      );
      return false;
    }

    return true;
  }

  private async checkPositionLimits(position: Position, currentPrice: number): Promise<void> {
    if (!this.currentConfig) return;

    position.currentPrice = currentPrice;

    // Use risk management service if available
    if (this.riskManagementService) {
      const positionsToClose = this.riskManagementService.checkStopLossAndTakeProfit([position]);

      for (const pos of positionsToClose) {
        const pnlPercent = ((pos.currentPrice! - pos.entryPrice) / pos.entryPrice) * 100;
        const reason =
          pnlPercent < 0
            ? `Stop loss at ${pnlPercent.toFixed(2)}%`
            : `Take profit at ${pnlPercent.toFixed(2)}%`;

        elizaLogger.info(`[${AutoTradingService.serviceType}] ${reason} for ${pos.tokenAddress}`);

        await this.executeTrade(pos.tokenAddress, {
          action: TradeType.SELL,
          pair: `${pos.tokenAddress}/USDC`,
          quantity: pos.amount,
          orderType: OrderType.MARKET,
          timestamp: Date.now(),
          reason,
        });
      }
    } else {
      // Fallback to config-based limits
      const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

      // Check stop loss
      const stopLoss = this.currentConfig.stopLossPercent || 5;
      if (pnlPercent < -stopLoss) {
        elizaLogger.info(
          `[${AutoTradingService.serviceType}] Stop loss triggered for ${position.tokenAddress}`
        );
        await this.executeTrade(position.tokenAddress, {
          action: TradeType.SELL,
          pair: `${position.tokenAddress}/USDC`,
          quantity: position.amount,
          orderType: OrderType.MARKET,
          timestamp: Date.now(),
          reason: `Stop loss at ${pnlPercent.toFixed(2)}%`,
        });
      }

      // Check take profit
      const takeProfit = this.currentConfig.takeProfitPercent || 10;
      if (pnlPercent > takeProfit) {
        elizaLogger.info(
          `[${AutoTradingService.serviceType}] Take profit triggered for ${position.tokenAddress}`
        );
        await this.executeTrade(position.tokenAddress, {
          action: TradeType.SELL,
          pair: `${position.tokenAddress}/USDC`,
          quantity: position.amount,
          orderType: OrderType.MARKET,
          timestamp: Date.now(),
          reason: `Take profit at ${pnlPercent.toFixed(2)}%`,
        });
      }
    }
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  private async calculatePortfolioValue(): Promise<number> {
    let total = 0;

    // Add cash balance (would come from wallet service)
    const cashBalance = 10000; // Mock for now
    total += cashBalance;

    // Add position values
    for (const [tokenAddress, position] of this.positions) {
      const marketData = await this.getMarketData(tokenAddress);
      if (marketData) {
        position.currentPrice = marketData.currentPrice;
        total += position.amount * marketData.currentPrice;
      }
    }

    return total;
  }

  private getHoldingsSnapshot(): { [key: string]: number } {
    const holdings: { [key: string]: number } = {
      USDC: 10000, // Mock cash balance
    };

    for (const [tokenAddress, position] of this.positions) {
      const tokenInfo = this.tokenResolver.getTokenInfo(tokenAddress);
      holdings[tokenInfo?.symbol || tokenAddress] = position.amount;
    }

    return holdings;
  }

  private getRecentTradeCount(): number {
    // Would query from analytics service
    return 0;
  }

  private async updateMetrics(): Promise<void> {
    const metrics = {
      isTrading: this.isTrading,
      strategy: this.currentStrategy?.name,
      positions: this.positions.size,
      dailyPnL: this.dailyPnL,
      totalPnL: this.totalPnL,
      lastUpdate: Date.now(),
    };

    await this.analytics.updateTradingMetrics(metrics);
  }

  private async loadSavedPositions(): Promise<void> {
    // Would load from database/persistent storage
    elizaLogger.info(`[${AutoTradingService.serviceType}] No saved positions to load`);
  }

  private resolveTokenAddresses(symbols: string[]): string[] {
    return symbols.map((symbol) => {
      const token = VERIFIED_MEME_COINS.find((t) => t.symbol === symbol);
      return token?.address || symbol;
    });
  }

  // Public getters for status
  public getIsTrading(): boolean {
    return this.isTrading;
  }

  public getCurrentStrategy(): TradingStrategy | undefined {
    return this.currentStrategy;
  }

  public getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  public getDailyPnL(): number {
    return this.dailyPnL;
  }

  public getTotalPnL(): number {
    return this.totalPnL;
  }
}
