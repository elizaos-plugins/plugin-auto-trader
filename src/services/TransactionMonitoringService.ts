import { Service, AgentRuntime, elizaLogger } from '@elizaos/core';
import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
  ConfirmedSignatureInfo,
} from '@solana/web3.js';
import { Trade, TradeType } from '../types.ts';
import { WalletIntegrationService } from './WalletIntegrationService.ts';

export interface TransactionStatus {
  signature: string;
  status: 'pending' | 'confirmed' | 'failed';
  confirmations: number;
  timestamp: number;
  error?: string;
}

export interface TransactionMetrics {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  averageConfirmationTime: number;
  averageSlippage: number;
  totalFees: number;
}

export interface TransactionLog {
  signature: string;
  timestamp: number;
  type: 'swap' | 'transfer' | 'other';
  status: 'success' | 'failed';
  from: string;
  to: string;
  tokenAddress?: string;
  amount?: number;
  price?: number;
  fee: number;
  slippage?: number;
  error?: string;
  raw: any;
}

export class TransactionMonitoringService extends Service {
  public static readonly serviceType = 'TransactionMonitoringService';
  public readonly capabilityDescription =
    'Monitors and logs blockchain transactions with detailed analytics';

  private connection!: Connection;
  private pendingTransactions = new Map<string, TransactionStatus>();
  private transactionLogs: TransactionLog[] = [];
  private walletAddress?: PublicKey;
  private monitoringInterval?: NodeJS.Timeout;
  private signatureSubscriptions = new Map<string, number>();

  constructor(runtime: AgentRuntime) {
    super(runtime);
  }

  public static async start(runtime: AgentRuntime): Promise<TransactionMonitoringService> {
    elizaLogger.info(`[${TransactionMonitoringService.serviceType}] Starting...`);
    const instance = new TransactionMonitoringService(runtime);
    await instance.start();
    return instance;
  }

  public async start(): Promise<void> {
    elizaLogger.info(
      `[${TransactionMonitoringService.serviceType}] Initializing transaction monitoring...`
    );

    // Initialize connection
    const rpcUrl =
      this.runtime.getSetting('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: rpcUrl.replace('https', 'wss'),
    });

    // Get wallet address if available
    const walletService = this.runtime.getService(
      'WalletIntegrationService'
    ) as WalletIntegrationService;
    if (walletService) {
      const address = walletService.getWalletAddress();
      if (address) {
        this.walletAddress = new PublicKey(address);
      }
    }

    // Start monitoring pending transactions
    this.startMonitoring();

    // Load transaction history if wallet is available
    if (this.walletAddress) {
      await this.loadRecentTransactions();
    }

    elizaLogger.info(`[${TransactionMonitoringService.serviceType}] Started successfully`);
  }

  public async stop(): Promise<void> {
    elizaLogger.info(`[${TransactionMonitoringService.serviceType}] Stopping...`);

    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Unsubscribe from all signature subscriptions
    for (const [signature, subscriptionId] of this.signatureSubscriptions) {
      try {
        await this.connection.removeSignatureListener(subscriptionId);
      } catch (error) {
        elizaLogger.error(
          `[${TransactionMonitoringService.serviceType}] Error removing subscription:`,
          error
        );
      }
    }
    this.signatureSubscriptions.clear();

    elizaLogger.info(`[${TransactionMonitoringService.serviceType}] Stopped`);
  }

  /**
   * Start monitoring pending transactions
   */
  private startMonitoring(): void {
    // Check pending transactions every 5 seconds
    this.monitoringInterval = setInterval(async () => {
      await this.checkPendingTransactions();
    }, 5000);
  }

  /**
   * Monitor a new transaction
   */
  public async monitorTransaction(
    signature: string,
    expectedType: 'swap' | 'transfer' | 'other' = 'swap'
  ): Promise<void> {
    elizaLogger.info(
      `[${TransactionMonitoringService.serviceType}] Monitoring transaction: ${signature}`
    );

    // Add to pending
    this.pendingTransactions.set(signature, {
      signature,
      status: 'pending',
      confirmations: 0,
      timestamp: Date.now(),
    });

    // Subscribe to signature updates
    try {
      const subscriptionId = this.connection.onSignature(
        signature,
        async (signatureResult) => {
          if (signatureResult.err) {
            await this.handleTransactionError(signature, signatureResult.err);
          } else {
            await this.handleTransactionConfirmation(signature);
          }
        },
        'confirmed'
      );

      this.signatureSubscriptions.set(signature, subscriptionId);
    } catch (error) {
      elizaLogger.error(
        `[${TransactionMonitoringService.serviceType}] Error subscribing to signature:`,
        error
      );
    }
  }

  /**
   * Check all pending transactions
   */
  private async checkPendingTransactions(): Promise<void> {
    const now = Date.now();
    const timeout = 120000; // 2 minutes timeout

    for (const [signature, status] of this.pendingTransactions) {
      // Check for timeout
      if (now - status.timestamp > timeout) {
        await this.handleTransactionTimeout(signature);
        continue;
      }

      // Check transaction status
      try {
        const result = await this.connection.getSignatureStatus(signature);

        if (result.value) {
          if (result.value.err) {
            await this.handleTransactionError(signature, result.value.err);
          } else if (
            result.value.confirmationStatus === 'confirmed' ||
            result.value.confirmationStatus === 'finalized'
          ) {
            status.confirmations = result.value.confirmations || 0;
            if (status.confirmations > 0) {
              await this.handleTransactionConfirmation(signature);
            }
          }
        }
      } catch (error) {
        elizaLogger.error(
          `[${TransactionMonitoringService.serviceType}] Error checking transaction ${signature}:`,
          error
        );
      }
    }
  }

  /**
   * Handle transaction confirmation
   */
  private async handleTransactionConfirmation(signature: string): Promise<void> {
    const status = this.pendingTransactions.get(signature);
    if (!status) return;

    status.status = 'confirmed';
    const confirmationTime = Date.now() - status.timestamp;

    elizaLogger.info(
      `[${TransactionMonitoringService.serviceType}] Transaction confirmed: ${signature} in ${confirmationTime}ms`
    );

    // Get transaction details
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (tx) {
        await this.logTransaction(signature, tx, 'success');
      }
    } catch (error) {
      elizaLogger.error(
        `[${TransactionMonitoringService.serviceType}] Error getting transaction details:`,
        error
      );
    }

    // Clean up
    this.pendingTransactions.delete(signature);
    const subscriptionId = this.signatureSubscriptions.get(signature);
    if (subscriptionId) {
      await this.connection.removeSignatureListener(subscriptionId);
      this.signatureSubscriptions.delete(signature);
    }
  }

  /**
   * Handle transaction error
   */
  private async handleTransactionError(signature: string, error: any): Promise<void> {
    const status = this.pendingTransactions.get(signature);
    if (!status) return;

    status.status = 'failed';
    status.error = error.toString();

    elizaLogger.error(
      `[${TransactionMonitoringService.serviceType}] Transaction failed: ${signature}`,
      error
    );

    // Log failed transaction
    await this.logTransaction(signature, null, 'failed', error.toString());

    // Clean up
    this.pendingTransactions.delete(signature);
    const subscriptionId = this.signatureSubscriptions.get(signature);
    if (subscriptionId) {
      await this.connection.removeSignatureListener(subscriptionId);
      this.signatureSubscriptions.delete(signature);
    }
  }

  /**
   * Handle transaction timeout
   */
  private async handleTransactionTimeout(signature: string): Promise<void> {
    elizaLogger.warn(
      `[${TransactionMonitoringService.serviceType}] Transaction timeout: ${signature}`
    );

    await this.handleTransactionError(signature, new Error('Transaction timeout'));
  }

  /**
   * Log transaction details
   */
  private async logTransaction(
    signature: string,
    tx: ParsedTransactionWithMeta | null,
    status: 'success' | 'failed',
    error?: string
  ): Promise<void> {
    const log: TransactionLog = {
      signature,
      timestamp: Date.now(),
      type: 'other',
      status,
      from: '',
      to: '',
      fee: 0,
      error,
      raw: tx,
    };

    if (tx && tx.transaction) {
      // Extract fee
      log.fee = (tx.meta?.fee || 0) / 1e9; // Convert lamports to SOL

      // Extract addresses
      const instructions = tx.transaction.message.instructions;
      if (instructions.length > 0) {
        const firstInstruction = instructions[0];
        if ('parsed' in firstInstruction && firstInstruction.parsed) {
          log.from = firstInstruction.parsed.info?.source || '';
          log.to = firstInstruction.parsed.info?.destination || '';

          // Determine transaction type
          if (
            firstInstruction.program === 'spl-token' &&
            firstInstruction.parsed.type === 'transfer'
          ) {
            log.type = 'transfer';
            log.amount = firstInstruction.parsed.info?.amount || 0;
            log.tokenAddress = firstInstruction.parsed.info?.mint || '';
          }
        }
      }

      // Check for swap transactions (Jupiter, Raydium, etc.)
      const hasSwapProgram = instructions.some((inst) => {
        if ('programId' in inst) {
          const programId = inst.programId.toString();
          return (
            programId.includes('JUP') ||
            programId.includes('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8')
          );
        }
        return false;
      });

      if (hasSwapProgram) {
        log.type = 'swap';
        // Extract swap details from logs if available
        if (tx.meta?.logMessages) {
          const swapLog = tx.meta.logMessages.find(
            (msg) => msg.includes('swap') || msg.includes('Swap')
          );
          if (swapLog) {
            // Parse swap details from log (implementation depends on DEX)
          }
        }
      }
    }

    // Add to logs
    this.transactionLogs.push(log);

    // Keep only last 1000 logs
    if (this.transactionLogs.length > 1000) {
      this.transactionLogs = this.transactionLogs.slice(-1000);
    }

    // Save to persistent storage if needed
    await this.saveTransactionLog(log);
  }

  /**
   * Save transaction log to persistent storage
   */
  private async saveTransactionLog(log: TransactionLog): Promise<void> {
    // Implementation depends on storage solution
    // Could save to database, file, or cloud storage
    elizaLogger.debug(`[${TransactionMonitoringService.serviceType}] Saved transaction log:`, {
      signature: log.signature,
      type: log.type,
      status: log.status,
    });
  }

  /**
   * Load recent transactions for the wallet
   */
  private async loadRecentTransactions(): Promise<void> {
    if (!this.walletAddress) return;

    try {
      elizaLogger.info(
        `[${TransactionMonitoringService.serviceType}] Loading recent transactions...`
      );

      const signatures = await this.connection.getSignaturesForAddress(this.walletAddress, {
        limit: 100,
      });

      for (const sigInfo of signatures) {
        if (
          sigInfo.confirmationStatus === 'confirmed' ||
          sigInfo.confirmationStatus === 'finalized'
        ) {
          try {
            const tx = await this.connection.getParsedTransaction(sigInfo.signature, {
              maxSupportedTransactionVersion: 0,
            });

            if (tx) {
              await this.logTransaction(
                sigInfo.signature,
                tx,
                sigInfo.err ? 'failed' : 'success',
                sigInfo.err ? JSON.stringify(sigInfo.err) : undefined
              );
            }
          } catch (error) {
            elizaLogger.error(
              `[${TransactionMonitoringService.serviceType}] Error loading transaction:`,
              error
            );
          }
        }
      }

      elizaLogger.info(
        `[${TransactionMonitoringService.serviceType}] Loaded ${signatures.length} recent transactions`
      );
    } catch (error) {
      elizaLogger.error(
        `[${TransactionMonitoringService.serviceType}] Error loading transaction history:`,
        error
      );
    }
  }

  /**
   * Get transaction status
   */
  public getTransactionStatus(signature: string): TransactionStatus | null {
    return this.pendingTransactions.get(signature) || null;
  }

  /**
   * Get transaction logs
   */
  public getTransactionLogs(options?: {
    type?: 'swap' | 'transfer' | 'other';
    status?: 'success' | 'failed';
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): TransactionLog[] {
    let logs = [...this.transactionLogs];

    if (options?.type) {
      logs = logs.filter((log) => log.type === options.type);
    }

    if (options?.status) {
      logs = logs.filter((log) => log.status === options.status);
    }

    if (options?.startTime) {
      logs = logs.filter((log) => log.timestamp >= options.startTime!);
    }

    if (options?.endTime) {
      logs = logs.filter((log) => log.timestamp <= options.endTime!);
    }

    // Sort by timestamp descending
    logs.sort((a, b) => b.timestamp - a.timestamp);

    if (options?.limit) {
      logs = logs.slice(0, options.limit);
    }

    return logs;
  }

  /**
   * Get transaction metrics
   */
  public getTransactionMetrics(startTime?: number, endTime?: number): TransactionMetrics {
    const logs = this.getTransactionLogs({ startTime, endTime });

    const metrics: TransactionMetrics = {
      totalTransactions: logs.length,
      successfulTransactions: logs.filter((log) => log.status === 'success').length,
      failedTransactions: logs.filter((log) => log.status === 'failed').length,
      averageConfirmationTime: 0,
      averageSlippage: 0,
      totalFees: logs.reduce((sum, log) => sum + log.fee, 0),
    };

    // Calculate average confirmation time for pending transactions that completed
    const completedPending = Array.from(this.pendingTransactions.values()).filter(
      (tx) => tx.status === 'confirmed'
    );

    if (completedPending.length > 0) {
      const totalTime = completedPending.reduce((sum, tx) => sum + (Date.now() - tx.timestamp), 0);
      metrics.averageConfirmationTime = totalTime / completedPending.length;
    }

    // Calculate average slippage for swaps
    const swaps = logs.filter((log) => log.type === 'swap' && log.slippage !== undefined);
    if (swaps.length > 0) {
      metrics.averageSlippage = swaps.reduce((sum, log) => sum + log.slippage!, 0) / swaps.length;
    }

    return metrics;
  }

  /**
   * Export transaction logs
   */
  public async exportTransactionLogs(format: 'json' | 'csv' = 'json'): Promise<string> {
    const logs = this.getTransactionLogs();

    if (format === 'json') {
      return JSON.stringify(logs, null, 2);
    } else {
      // CSV format
      const headers = [
        'Signature',
        'Timestamp',
        'Type',
        'Status',
        'From',
        'To',
        'Amount',
        'Token',
        'Fee',
        'Error',
      ];
      const rows = logs.map((log) => [
        log.signature,
        new Date(log.timestamp).toISOString(),
        log.type,
        log.status,
        log.from,
        log.to,
        log.amount || '',
        log.tokenAddress || '',
        log.fee.toFixed(9),
        log.error || '',
      ]);

      return [headers, ...rows].map((row) => row.join(',')).join('\n');
    }
  }
}
