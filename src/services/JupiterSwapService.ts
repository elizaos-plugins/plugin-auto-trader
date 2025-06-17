import { Service, AgentRuntime, elizaLogger } from '@elizaos/core';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { WalletIntegrationService } from './WalletIntegrationService.ts';

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  marketInfos: any[];
  routePlan: any[];
  contextSlot: number;
  timeTaken: number;
}

export interface SwapParams {
  inputMint: string;
  outputMint: string;
  amount: number; // in token units, not lamports
  slippageBps?: number; // basis points (100 = 1%)
  userPublicKey: string;
  priorityFeeLamports?: number;
  autoSlippage?: boolean;
  maxAutoSlippageBps?: number;
}

export class JupiterSwapService extends Service {
  public static readonly serviceType = 'JupiterSwapService';
  public readonly capabilityDescription = 'Executes token swaps using Jupiter aggregator';

  private connection!: Connection;
  private walletService?: WalletIntegrationService;
  private readonly QUOTE_API = 'https://quote-api.jup.ag/v6';

  // Token decimals cache
  private decimalsCache = new Map<string, number>([
    ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6], // USDC
    ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6], // USDT
    ['So11111111111111111111111111111111111111112', 9], // SOL
  ]);

  constructor(runtime: AgentRuntime) {
    super(runtime);
  }

  public static async start(runtime: AgentRuntime): Promise<JupiterSwapService> {
    elizaLogger.info(`[${JupiterSwapService.serviceType}] Starting...`);
    const instance = new JupiterSwapService(runtime);
    await instance.start();
    return instance;
  }

  public async start(): Promise<void> {
    elizaLogger.info(`[${JupiterSwapService.serviceType}] Initializing Jupiter swap service...`);

    // Initialize connection
    const rpcUrl =
      this.runtime.getSetting('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');

    // Get wallet service
    this.walletService = this.runtime.getService(
      'WalletIntegrationService'
    ) as WalletIntegrationService;

    if (!this.walletService?.isWalletAvailable()) {
      elizaLogger.warn(
        `[${JupiterSwapService.serviceType}] Wallet service not available - swaps will fail`
      );
    }

    elizaLogger.info(`[${JupiterSwapService.serviceType}] Started successfully`);
  }

  public async stop(): Promise<void> {
    elizaLogger.info(`[${JupiterSwapService.serviceType}] Stopped`);
  }

  /**
   * Get token decimals from chain
   */
  private async getTokenDecimals(mint: string): Promise<number> {
    // Check cache first
    if (this.decimalsCache.has(mint)) {
      return this.decimalsCache.get(mint)!;
    }

    try {
      const mintPubkey = new PublicKey(mint);
      const info = await this.connection.getParsedAccountInfo(mintPubkey);

      if (info.value?.data && 'parsed' in info.value.data) {
        const decimals = info.value.data.parsed.info.decimals;
        this.decimalsCache.set(mint, decimals);
        return decimals;
      }
    } catch (error) {
      elizaLogger.error(
        `[${JupiterSwapService.serviceType}] Error getting decimals for ${mint}:`,
        error
      );
    }

    // Default to 9 (SOL decimals) if we can't determine
    return 9;
  }

  /**
   * Convert token amount to lamports/smallest unit
   */
  private async amountToLamports(mint: string, amount: number): Promise<string> {
    const decimals = await this.getTokenDecimals(mint);
    const lamports = Math.floor(amount * Math.pow(10, decimals));
    return lamports.toString();
  }

  /**
   * Get a swap quote from Jupiter
   */
  public async getQuote(
    params: Omit<SwapParams, 'userPublicKey' | 'priorityFeeLamports'>
  ): Promise<SwapQuote | null> {
    try {
      const amountLamports = await this.amountToLamports(params.inputMint, params.amount);

      const queryParams = new URLSearchParams({
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: amountLamports,
        slippageBps: (params.slippageBps || 100).toString(), // Default 1% slippage
        onlyDirectRoutes: 'false',
        asLegacyTransaction: 'false',
      });

      if (params.autoSlippage) {
        queryParams.append('autoSlippage', 'true');
        if (params.maxAutoSlippageBps) {
          queryParams.append('maxAutoSlippageBps', params.maxAutoSlippageBps.toString());
        }
      }

      elizaLogger.info(
        `[${JupiterSwapService.serviceType}] Getting quote for ${params.amount} ${params.inputMint} -> ${params.outputMint}`
      );

      const response = await fetch(`${this.QUOTE_API}/quote?${queryParams.toString()}`);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Jupiter quote API error: ${response.status} - ${error}`);
      }

      const quote: SwapQuote = await response.json();

      // Log quote details
      const outputDecimals = await this.getTokenDecimals(params.outputMint);
      const outputAmount = parseFloat(quote.outAmount) / Math.pow(10, outputDecimals);

      elizaLogger.info(`[${JupiterSwapService.serviceType}] Quote received:`, {
        outputAmount: outputAmount.toFixed(6),
        priceImpact: `${quote.priceImpactPct}%`,
        routes: quote.routePlan.length,
        timeTaken: `${quote.timeTaken}ms`,
      });

      return quote;
    } catch (error) {
      elizaLogger.error(`[${JupiterSwapService.serviceType}] Error getting quote:`, error);
      return null;
    }
  }

  /**
   * Execute a swap using a quote
   */
  public async executeSwap(
    quote: SwapQuote,
    params: Pick<SwapParams, 'userPublicKey' | 'priorityFeeLamports' | 'slippageBps'>
  ): Promise<string | null> {
    if (!this.walletService?.isWalletAvailable()) {
      throw new Error('Wallet not available for swap execution');
    }

    try {
      elizaLogger.info(`[${JupiterSwapService.serviceType}] Executing swap...`);

      // Get swap transaction from Jupiter
      const swapResponse = await fetch(`${this.QUOTE_API}/swap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: params.userPublicKey,
          wrapAndUnwrapSol: true,
          computeUnitPriceMicroLamports: params.priorityFeeLamports || 20000, // Default priority fee
          dynamicSlippage: {
            minBps: 50,
            maxBps: params.slippageBps || 300,
          },
        }),
      });

      if (!swapResponse.ok) {
        const error = await swapResponse.text();
        throw new Error(`Jupiter swap API error: ${swapResponse.status} - ${error}`);
      }

      const { swapTransaction, lastValidBlockHeight } = await swapResponse.json();

      // Deserialize the transaction
      const transactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);

      // TODO: Transaction signing needs to be handled by the wallet service
      // The wallet service from plugin-solana should provide a signing method
      // For now, we'll return an error indicating that direct signing is not supported
      throw new Error(
        'Direct transaction signing not yet supported - wallet service needs to implement signing'
      );

      // Send and confirm transaction
      elizaLogger.info(`[${JupiterSwapService.serviceType}] Sending transaction...`);

      const signature = await this.connection.sendTransaction(transaction, {
        maxRetries: 3,
        preflightCommitment: 'confirmed',
      });

      elizaLogger.info(`[${JupiterSwapService.serviceType}] Transaction sent: ${signature}`);

      // Wait for confirmation
      const latestBlockhash = await this.connection.getLatestBlockhash();
      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: lastValidBlockHeight || latestBlockhash.lastValidBlockHeight,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      elizaLogger.info(`[${JupiterSwapService.serviceType}] Swap confirmed: ${signature}`);
      return signature;
    } catch (error) {
      elizaLogger.error(`[${JupiterSwapService.serviceType}] Swap execution failed:`, error);
      throw error;
    }
  }

  /**
   * High-level swap function that gets quote and executes
   */
  public async swap(
    params: SwapParams & { maxRetries?: number }
  ): Promise<{ quote: SwapQuote; signature: string } | null> {
    const maxRetries = params.maxRetries || 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Get quote
        const quote = await this.getQuote(params);
        if (!quote) {
          throw new Error('Failed to get quote');
        }

        // Check price impact warning
        if (quote.priceImpactPct > 5) {
          elizaLogger.warn(
            `[${JupiterSwapService.serviceType}] High price impact: ${quote.priceImpactPct}%`
          );

          // If auto-slippage not enabled and impact is high, retry with auto-slippage
          if (!params.autoSlippage && attempt === 1) {
            elizaLogger.info(`[${JupiterSwapService.serviceType}] Retrying with auto-slippage...`);
            params.autoSlippage = true;
            params.maxAutoSlippageBps = 1000; // Max 10% auto slippage
            continue;
          }
        }

        // Execute swap
        const signature = await this.executeSwap(quote, params);
        if (!signature) {
          throw new Error('Failed to execute swap');
        }

        return { quote, signature };
      } catch (error: any) {
        lastError = error;
        elizaLogger.error(
          `[${JupiterSwapService.serviceType}] Swap attempt ${attempt} failed:`,
          error
        );

        if (attempt < maxRetries) {
          // Wait before retry with exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          elizaLogger.info(`[${JupiterSwapService.serviceType}] Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    elizaLogger.error(`[${JupiterSwapService.serviceType}] All swap attempts failed`);
    return null;
  }

  /**
   * Get available routes for a token pair
   */
  public async getRoutes(inputMint: string, outputMint: string): Promise<any[]> {
    try {
      const response = await fetch(`${this.QUOTE_API}/program-id-to-label`);
      if (!response.ok) {
        throw new Error('Failed to fetch routes');
      }

      const routes = await response.json();
      return routes;
    } catch (error) {
      elizaLogger.error(`[${JupiterSwapService.serviceType}] Error fetching routes:`, error);
      return [];
    }
  }

  /**
   * Validate if a swap route is available
   */
  public async isSwapAvailable(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<boolean> {
    const quote = await this.getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps: 500, // 5% for validation
    });

    return quote !== null && parseFloat(quote.outAmount) > 0;
  }
}
