import { Service, AgentRuntime, elizaLogger } from '@elizaos/core';
import WebSocket from 'ws';

export interface PriceUpdate {
  tokenAddress: string;
  price: number;
  volume24h: number;
  priceChange24h: number;
  timestamp: number;
  source: 'birdeye' | 'pyth' | 'jupiter';
}

export type PriceUpdateCallback = (update: PriceUpdate) => void;

export class RealtimePriceFeedService extends Service {
  public static readonly serviceType = 'RealtimePriceFeedService';
  public readonly capabilityDescription =
    'Provides real-time price updates via WebSocket connections';

  private birdeyeWs?: WebSocket;
  private pythWs?: WebSocket;
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private subscriptions = new Map<string, Set<PriceUpdateCallback>>();
  private latestPrices = new Map<string, PriceUpdate>();
  private reconnectAttempts = new Map<string, number>();

  // Birdeye WebSocket configuration
  private readonly BIRDEYE_WS_URL = 'wss://public-api.birdeye.so/socket';
  private readonly PYTH_WS_URL = 'wss://hermes.pyth.network/ws';

  constructor(runtime: AgentRuntime) {
    super(runtime);
  }

  public static async start(runtime: AgentRuntime): Promise<RealtimePriceFeedService> {
    elizaLogger.info(`[${RealtimePriceFeedService.serviceType}] Starting...`);
    const instance = new RealtimePriceFeedService(runtime);
    await instance.start();
    return instance;
  }

  public async start(): Promise<void> {
    elizaLogger.info(
      `[${RealtimePriceFeedService.serviceType}] Initializing real-time price feeds...`
    );

    // Start WebSocket connections
    await this.connectBirdeye();
    await this.connectPyth();

    elizaLogger.info(`[${RealtimePriceFeedService.serviceType}] Started successfully`);
  }

  public async stop(): Promise<void> {
    elizaLogger.info(`[${RealtimePriceFeedService.serviceType}] Stopping...`);

    // Close WebSocket connections
    if (this.birdeyeWs) {
      this.birdeyeWs.close();
    }
    if (this.pythWs) {
      this.pythWs.close();
    }

    // Clear reconnect timers
    this.reconnectTimers.forEach((timer) => clearTimeout(timer));
    this.reconnectTimers.clear();

    // Clear subscriptions
    this.subscriptions.clear();
    this.latestPrices.clear();

    elizaLogger.info(`[${RealtimePriceFeedService.serviceType}] Stopped`);
  }

  /**
   * Connect to Birdeye WebSocket
   */
  private async connectBirdeye(): Promise<void> {
    const apiKey = this.runtime.getSetting('BIRDEYE_API_KEY');
    if (!apiKey) {
      elizaLogger.warn(
        `[${RealtimePriceFeedService.serviceType}] Birdeye API key not found, skipping WebSocket connection`
      );
      return;
    }

    try {
      this.birdeyeWs = new WebSocket(this.BIRDEYE_WS_URL, {
        headers: {
          'X-API-KEY': apiKey,
          'x-chain': 'solana',
          Origin: 'https://birdeye.so',
        },
      });

      this.birdeyeWs.on('open', () => {
        elizaLogger.info(`[${RealtimePriceFeedService.serviceType}] Birdeye WebSocket connected`);
        this.reconnectAttempts.set('birdeye', 0);

        // Subscribe to all tracked tokens
        this.subscriptions.forEach((_, tokenAddress) => {
          this.subscribeBirdeyeToken(tokenAddress);
        });
      });

      this.birdeyeWs.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleBirdeyeMessage(message);
        } catch (error) {
          elizaLogger.error(
            `[${RealtimePriceFeedService.serviceType}] Error parsing Birdeye message:`,
            error
          );
        }
      });

      this.birdeyeWs.on('error', (error) => {
        elizaLogger.error(
          `[${RealtimePriceFeedService.serviceType}] Birdeye WebSocket error:`,
          error
        );
      });

      this.birdeyeWs.on('close', () => {
        elizaLogger.warn(
          `[${RealtimePriceFeedService.serviceType}] Birdeye WebSocket disconnected`
        );
        this.scheduleReconnect('birdeye');
      });
    } catch (error) {
      elizaLogger.error(
        `[${RealtimePriceFeedService.serviceType}] Failed to connect to Birdeye:`,
        error
      );
      this.scheduleReconnect('birdeye');
    }
  }

  /**
   * Connect to Pyth WebSocket
   */
  private async connectPyth(): Promise<void> {
    try {
      // Pyth Hermes doesn't require authentication
      this.pythWs = new WebSocket(this.PYTH_WS_URL);

      this.pythWs.on('open', () => {
        elizaLogger.info(`[${RealtimePriceFeedService.serviceType}] Pyth WebSocket connected`);
        this.reconnectAttempts.set('pyth', 0);

        // Subscribe to price feeds
        this.subscribePythFeeds();
      });

      this.pythWs.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handlePythMessage(message);
        } catch (error) {
          elizaLogger.error(
            `[${RealtimePriceFeedService.serviceType}] Error parsing Pyth message:`,
            error
          );
        }
      });

      this.pythWs.on('error', (error) => {
        elizaLogger.error(`[${RealtimePriceFeedService.serviceType}] Pyth WebSocket error:`, error);
      });

      this.pythWs.on('close', () => {
        elizaLogger.warn(`[${RealtimePriceFeedService.serviceType}] Pyth WebSocket disconnected`);
        this.scheduleReconnect('pyth');
      });
    } catch (error) {
      elizaLogger.error(
        `[${RealtimePriceFeedService.serviceType}] Failed to connect to Pyth:`,
        error
      );
      this.scheduleReconnect('pyth');
    }
  }

  /**
   * Schedule WebSocket reconnection with exponential backoff
   */
  private scheduleReconnect(service: 'birdeye' | 'pyth'): void {
    // Clear existing timer
    const existingTimer = this.reconnectTimers.get(service);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const attempts = this.reconnectAttempts.get(service) || 0;
    const delay = Math.min(1000 * Math.pow(2, attempts), 30000); // Max 30 seconds

    elizaLogger.info(
      `[${RealtimePriceFeedService.serviceType}] Scheduling ${service} reconnect in ${delay}ms (attempt ${attempts + 1})`
    );

    const timer = setTimeout(async () => {
      this.reconnectAttempts.set(service, attempts + 1);

      if (service === 'birdeye') {
        await this.connectBirdeye();
      } else {
        await this.connectPyth();
      }
    }, delay);

    this.reconnectTimers.set(service, timer);
  }

  /**
   * Subscribe to a token for price updates
   */
  public subscribe(tokenAddress: string, callback: PriceUpdateCallback): void {
    let callbacks = this.subscriptions.get(tokenAddress);
    if (!callbacks) {
      callbacks = new Set();
      this.subscriptions.set(tokenAddress, callbacks);

      // Subscribe on active connections
      if (this.birdeyeWs?.readyState === WebSocket.OPEN) {
        this.subscribeBirdeyeToken(tokenAddress);
      }
    }

    callbacks.add(callback);

    // Send latest price if available
    const latestPrice = this.latestPrices.get(tokenAddress);
    if (latestPrice) {
      callback(latestPrice);
    }
  }

  /**
   * Unsubscribe from a token
   */
  public unsubscribe(tokenAddress: string, callback: PriceUpdateCallback): void {
    const callbacks = this.subscriptions.get(tokenAddress);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.subscriptions.delete(tokenAddress);

        // Unsubscribe on active connections
        if (this.birdeyeWs?.readyState === WebSocket.OPEN) {
          this.unsubscribeBirdeyeToken(tokenAddress);
        }
      }
    }
  }

  /**
   * Get latest price for a token
   */
  public getLatestPrice(tokenAddress: string): PriceUpdate | null {
    return this.latestPrices.get(tokenAddress) || null;
  }

  /**
   * Subscribe to Birdeye token updates
   */
  private subscribeBirdeyeToken(tokenAddress: string): void {
    if (this.birdeyeWs?.readyState === WebSocket.OPEN) {
      this.birdeyeWs.send(
        JSON.stringify({
          type: 'SUBSCRIBE_PRICE',
          data: {
            address: tokenAddress,
            currency: 'usd',
          },
        })
      );
    }
  }

  /**
   * Unsubscribe from Birdeye token updates
   */
  private unsubscribeBirdeyeToken(tokenAddress: string): void {
    if (this.birdeyeWs?.readyState === WebSocket.OPEN) {
      this.birdeyeWs.send(
        JSON.stringify({
          type: 'UNSUBSCRIBE_PRICE',
          data: {
            address: tokenAddress,
          },
        })
      );
    }
  }

  /**
   * Subscribe to Pyth price feeds
   */
  private subscribePythFeeds(): void {
    if (this.pythWs?.readyState === WebSocket.OPEN) {
      // Pyth price feed IDs for common tokens
      const priceFeeds = [
        'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG', // SOL/USD
        'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD', // USDC/USD
        '8GWTTgNjkPjf9yWPE73fgkDCKfZEbAiJKEm3vfnfBvWE', // BONK/USD
      ];

      this.pythWs.send(
        JSON.stringify({
          type: 'subscribe',
          ids: priceFeeds,
        })
      );
    }
  }

  /**
   * Handle Birdeye WebSocket messages
   */
  private handleBirdeyeMessage(message: any): void {
    if (message.type === 'PRICE_UPDATE' && message.data) {
      const { address, value, volume24h, priceChange24h } = message.data;

      const update: PriceUpdate = {
        tokenAddress: address,
        price: value,
        volume24h: volume24h || 0,
        priceChange24h: priceChange24h || 0,
        timestamp: Date.now(),
        source: 'birdeye',
      };

      this.handlePriceUpdate(update);
    }
  }

  /**
   * Handle Pyth WebSocket messages
   */
  private handlePythMessage(message: any): void {
    if (message.type === 'price_update' && message.price_feed) {
      // Map Pyth feed ID to token address
      const feedToToken: Record<string, string> = {
        H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG: 'So11111111111111111111111111111111111111112',
        Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD:
          'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        '8GWTTgNjkPjf9yWPE73fgkDCKfZEbAiJKEm3vfnfBvWE':
          'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      };

      const tokenAddress = feedToToken[message.price_feed.id];
      if (tokenAddress) {
        const price =
          parseFloat(message.price_feed.price.price) * Math.pow(10, message.price_feed.price.expo);

        const update: PriceUpdate = {
          tokenAddress,
          price,
          volume24h: 0, // Pyth doesn't provide volume
          priceChange24h: 0, // Calculate from history if needed
          timestamp: message.price_feed.price.publish_time * 1000,
          source: 'pyth',
        };

        this.handlePriceUpdate(update);
      }
    }
  }

  /**
   * Handle price updates and notify subscribers
   */
  private handlePriceUpdate(update: PriceUpdate): void {
    // Store latest price
    this.latestPrices.set(update.tokenAddress, update);

    // Notify subscribers
    const callbacks = this.subscriptions.get(update.tokenAddress);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(update);
        } catch (error) {
          elizaLogger.error(
            `[${RealtimePriceFeedService.serviceType}] Error in price update callback:`,
            error
          );
        }
      });
    }
  }

  /**
   * Get multiple token prices at once
   */
  public async getBatchPrices(tokenAddresses: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    // First check cached prices
    tokenAddresses.forEach((address) => {
      const cached = this.latestPrices.get(address);
      if (cached && Date.now() - cached.timestamp < 60000) {
        // 1 minute cache
        prices.set(address, cached.price);
      }
    });

    // Fetch missing prices from Birdeye API
    const missing = tokenAddresses.filter((addr) => !prices.has(addr));
    if (missing.length > 0) {
      const apiKey = this.runtime.getSetting('BIRDEYE_API_KEY');
      if (apiKey) {
        try {
          const response = await fetch(
            `https://public-api.birdeye.so/defi/multi_price?list_address=${missing.join(',')}`,
            {
              headers: {
                'X-API-KEY': apiKey,
                'x-chain': 'solana',
              },
            }
          );

          if (response.ok) {
            const data = await response.json();
            if (data.success && data.data) {
              Object.entries(data.data).forEach(([address, info]: [string, any]) => {
                prices.set(address, info.value);

                // Update cache
                this.handlePriceUpdate({
                  tokenAddress: address,
                  price: info.value,
                  volume24h: 0,
                  priceChange24h: 0,
                  timestamp: Date.now(),
                  source: 'birdeye',
                });
              });
            }
          }
        } catch (error) {
          elizaLogger.error(
            `[${RealtimePriceFeedService.serviceType}] Error fetching batch prices:`,
            error
          );
        }
      }
    }

    return prices;
  }
}
