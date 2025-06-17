import { Service, type IAgentRuntime, logger } from '@elizaos/core';

interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  addresses: {
    [chain: string]: string;
  };
}

export class TokenResolverService extends Service {
  public static override readonly serviceType = 'TokenResolverService';
  public readonly capabilityDescription =
    'Resolves token symbols to chain-specific addresses and metadata';

  private tokenRegistry: Map<string, TokenInfo> = new Map();

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.initializeTokenRegistry();
  }

  public static async start(runtime: IAgentRuntime): Promise<TokenResolverService> {
    logger.info('[TokenResolverService] Starting...');
    const instance = new TokenResolverService(runtime);
    await instance.start();
    return instance;
  }

  public async start(): Promise<void> {
    logger.info('[TokenResolverService] Started successfully');
  }

  public async stop(): Promise<void> {
    logger.info('[TokenResolverService] Stopped');
    this.tokenRegistry.clear();
  }

  private initializeTokenRegistry(): void {
    // Initialize with common tokens
    const tokens: TokenInfo[] = [
      {
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        addresses: {
          solana: 'So11111111111111111111111111111111111111112',
        },
      },
      {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        addresses: {
          solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7uH3',
          ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          polygon: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        },
      },
      {
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
        addresses: {
          ethereum: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native ETH
          polygon: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // Wrapped ETH on Polygon
        },
      },
      {
        symbol: 'MATIC',
        name: 'Polygon',
        decimals: 18,
        addresses: {
          polygon: '0x0000000000000000000000000000000000001010', // Native MATIC
          ethereum: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', // MATIC on Ethereum
        },
      },
      {
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 6,
        addresses: {
          solana: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
          ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          polygon: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        },
      },
    ];

    tokens.forEach((token) => {
      this.tokenRegistry.set(token.symbol, token);
    });

    logger.info(`[TokenResolverService] Initialized with ${this.tokenRegistry.size} tokens`);
  }

  /**
   * Get token address for a specific chain
   */
  public getTokenAddress(symbol: string, chain: string): string | null {
    const token = this.tokenRegistry.get(symbol.toUpperCase());
    if (!token) {
      logger.warn(`[TokenResolverService] Token ${symbol} not found in registry`);
      return null;
    }

    const address = token.addresses[chain.toLowerCase()];
    if (!address) {
      logger.warn(`[TokenResolverService] Token ${symbol} not available on ${chain}`);
      return null;
    }

    return address;
  }

  /**
   * Get token info including all addresses
   */
  public getTokenInfo(symbol: string): TokenInfo | null {
    return this.tokenRegistry.get(symbol.toUpperCase()) || null;
  }

  /**
   * Get all tokens available on a specific chain
   */
  public getTokensForChain(chain: string): TokenInfo[] {
    const tokens: TokenInfo[] = [];
    this.tokenRegistry.forEach((token) => {
      if (token.addresses[chain.toLowerCase()]) {
        tokens.push(token);
      }
    });
    return tokens;
  }

  /**
   * Add or update a token in the registry
   */
  public registerToken(token: TokenInfo): void {
    this.tokenRegistry.set(token.symbol.toUpperCase(), token);
    logger.info(`[TokenResolverService] Registered token ${token.symbol}`);
  }

  /**
   * Check if a token is available on a specific chain
   */
  public isTokenAvailable(symbol: string, chain: string): boolean {
    const token = this.tokenRegistry.get(symbol.toUpperCase());
    return token ? !!token.addresses[chain.toLowerCase()] : false;
  }

  /**
   * Get decimals for a token
   */
  public getTokenDecimals(symbol: string): number | null {
    const token = this.tokenRegistry.get(symbol.toUpperCase());
    return token ? token.decimals : null;
  }
}
