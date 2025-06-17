import { Service, AgentRuntime, elizaLogger, ServiceType } from '@elizaos/core';
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { JupiterSwapService } from './JupiterSwapService.ts';
import type { IWalletService } from '@elizaos/core';

export interface WalletBalance {
  sol: number;
  tokens: Map<string, { amount: number; decimals: number }>;
}

/**
 * WalletIntegrationService acts as an adapter between the auto-trader
 * and the ElizaOS wallet service (plugin-solana)
 */
export class WalletIntegrationService extends Service {
  public static readonly serviceType = 'WalletIntegrationService';
  public readonly capabilityDescription =
    'Adapter for wallet operations using ElizaOS wallet service';

  private connection!: Connection;
  private walletService?: IWalletService;
  private walletPublicKey?: PublicKey;

  constructor(runtime: AgentRuntime) {
    super(runtime);
  }

  public static async start(runtime: AgentRuntime): Promise<WalletIntegrationService> {
    elizaLogger.info(`[${WalletIntegrationService.serviceType}] Starting...`);
    const instance = new WalletIntegrationService(runtime);
    await instance.start();
    return instance;
  }

  public async start(): Promise<void> {
    elizaLogger.info(`[${WalletIntegrationService.serviceType}] Initializing wallet adapter...`);

    // Initialize Solana connection
    const rpcUrl =
      this.runtime.getSetting('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');

    // Get the ElizaOS wallet service
    this.walletService = this.runtime.getService(ServiceType.WALLET) as IWalletService;

    if (!this.walletService) {
      // Try fallback names
      const walletServiceNames = ['WalletService', 'SolanaWalletService'];
      for (const name of walletServiceNames) {
        this.walletService = this.runtime.getService(name) as IWalletService;
        if (this.walletService) break;
      }
    }

    if (!this.walletService) {
      // Check if we're in test mode or paper trading mode
      const isTestMode = this.runtime.getSetting('ELIZA_TEST_MODE') === 'true';
      const tradingMode = this.runtime.getSetting('TRADING_MODE');
      
      if (isTestMode || tradingMode !== 'live') {
        elizaLogger.warn(
          `[${WalletIntegrationService.serviceType}] No wallet service found. Running in mock mode for testing/paper trading.`
        );
        // Continue without wallet service for testing
      } else {
        elizaLogger.error(
          `[${WalletIntegrationService.serviceType}] No wallet service found. Please ensure plugin-solana is installed and configured.`
        );
        throw new Error('Wallet service not available');
      }
    }

    // Get the wallet address from the service
    // Note: The wallet public key should be available from the wallet service
    // For now, we'll need to get it from the portfolio assets or settings
    try {
      // Try to get wallet address from settings first
      const walletAddress =
        this.runtime.getSetting('SOLANA_ADDRESS') || this.runtime.getSetting('WALLET_PUBLIC_KEY');
      if (walletAddress) {
        this.walletPublicKey = new PublicKey(walletAddress);
        elizaLogger.info(
          `[${WalletIntegrationService.serviceType}] Using wallet from settings: ${walletAddress}`
        );
      } else if (!this.walletService) {
        // Use a mock address for testing
        this.walletPublicKey = new PublicKey('11111111111111111111111111111111');
        elizaLogger.info(
          `[${WalletIntegrationService.serviceType}] Using mock wallet for testing`
        );
      }
    } catch (error) {
      elizaLogger.error(
        `[${WalletIntegrationService.serviceType}] Failed to get wallet address:`,
        error
      );
    }

    elizaLogger.info(`[${WalletIntegrationService.serviceType}] Started successfully`);
  }

  public async stop(): Promise<void> {
    elizaLogger.info(`[${WalletIntegrationService.serviceType}] Stopped`);
  }

  public isWalletAvailable(): boolean {
    return !!this.walletService && !!this.walletPublicKey;
  }

  public getWalletAddress(): string | null {
    return this.walletPublicKey?.toBase58() || null;
  }

  public async getBalance(): Promise<WalletBalance> {
    if (!this.walletService) {
      // Return mock balance for testing
      elizaLogger.warn(`[${WalletIntegrationService.serviceType}] Using mock balance for testing`);
      return {
        sol: 10,
        tokens: new Map([
          ['USDC', { amount: 10000, decimals: 6 }],
          ['BONK', { amount: 1000000, decimals: 5 }],
        ]),
      };
    }

    const balance: WalletBalance = {
      sol: 0,
      tokens: new Map(),
    };

    try {
      // Get portfolio from wallet service
      const portfolio = await this.walletService.getPortfolio();

      // Extract SOL balance
      const solAsset = portfolio.assets.find((a) => a.symbol === 'SOL');
      if (solAsset && solAsset.uiAmount !== undefined) {
        balance.sol = solAsset.uiAmount;
      }

      // Extract token balances
      for (const asset of portfolio.assets) {
        if (asset.symbol !== 'SOL' && asset.address) {
          balance.tokens.set(asset.address, {
            amount: asset.uiAmount || 0,
            decimals: asset.decimals || 9,
          });
        }
      }
    } catch (error) {
      elizaLogger.error(`[${WalletIntegrationService.serviceType}] Error getting balance:`, error);
      throw error;
    }

    return balance;
  }

  public async executeSwap(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippage?: number;
  }): Promise<string> {
    if (!this.walletService) {
      // Return mock transaction for testing
      elizaLogger.warn(`[${WalletIntegrationService.serviceType}] Using mock swap for testing`);
      return `mock_tx_${Date.now()}`;
    }

    elizaLogger.info(`[${WalletIntegrationService.serviceType}] Executing swap:`, {
      from: params.inputMint,
      to: params.outputMint,
      amount: params.amount,
    });

    // Get Jupiter service for actual swap execution
    const jupiterService = this.runtime.getService('JupiterSwapService') as JupiterSwapService;
    if (!jupiterService) {
      elizaLogger.error(
        `[${WalletIntegrationService.serviceType}] JupiterSwapService not available`
      );
      throw new Error('Jupiter swap service not available');
    }

    try {
      // Get wallet public key
      if (!this.walletPublicKey) {
        throw new Error('Wallet public key not available');
      }

      // Execute swap through Jupiter
      const result = await jupiterService.swap({
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        slippageBps: (params.slippage || 0.01) * 10000, // Convert percentage to basis points
        userPublicKey: this.walletPublicKey.toBase58(),
        priorityFeeLamports: 20000, // Default priority fee
        autoSlippage: true,
        maxAutoSlippageBps: 500, // Max 5% auto slippage
        maxRetries: 3,
      });

      if (!result) {
        throw new Error('Swap failed - no result returned');
      }

      elizaLogger.info(`[${WalletIntegrationService.serviceType}] Swap executed successfully:`, {
        signature: result.signature,
        outputAmount: result.quote.outAmount,
        priceImpact: `${result.quote.priceImpactPct}%`,
      });

      return result.signature;
    } catch (error) {
      elizaLogger.error(`[${WalletIntegrationService.serviceType}] Swap failed:`, error);
      throw error;
    }
  }

  public async getTokenBalance(mint: string): Promise<number> {
    if (!this.walletService) {
      // Return mock balance for testing
      elizaLogger.warn(`[${WalletIntegrationService.serviceType}] Using mock token balance for testing`);
      const mockBalances: Record<string, number> = {
        'USDC': 10000,
        'BONK': 1000000,
        'SOL': 10,
      };
      return mockBalances[mint] || 0;
    }

    try {
      const portfolio = await this.walletService.getPortfolio();
      const asset = portfolio.assets.find((a) => a.address === mint);
      return asset?.uiAmount || 0;
    } catch (error) {
      elizaLogger.error(
        `[${WalletIntegrationService.serviceType}] Error getting token balance:`,
        error
      );
      return 0;
    }
  }

  public getConnection(): Connection {
    return this.connection;
  }

  /**
   * Get the underlying wallet service for direct access if needed
   */
  public getWalletService(): IWalletService | undefined {
    return this.walletService;
  }

  /**
   * Sign and send a transaction using the wallet service
   * This requires the wallet service to support transaction signing
   */
  public async signAndSendTransaction(transaction: Transaction): Promise<string> {
    if (!this.walletService) {
      throw new Error('Wallet service not initialized');
    }

    // For now, we'll throw an error since IWalletService doesn't have a standard signing method
    // Each wallet plugin may implement this differently
    throw new Error('Transaction signing not yet implemented - use Jupiter service for swaps');
  }
}
