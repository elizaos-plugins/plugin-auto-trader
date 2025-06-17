import type { IAgentRuntime, TestSuite } from '@elizaos/core';
import { strict as assert } from 'node:assert';
import axios from 'axios';

// Test configuration
const LIVE_TRADING_TEST_CONFIG = {
  TEST_DURATION: 300000, // 5 minutes
  TRADE_INTERVAL: 30000, // Try to trade every 30 seconds
  MAX_POSITION_SIZE: 5, // $5 max per position (small for testing)
  MAX_DAILY_LOSS: 10, // $10 max daily loss
  STOP_LOSS_PERCENT: 5, // 5% stop loss
  TAKE_PROFIT_PERCENT: 10, // 10% take profit
  TRADE_PROBABILITY: 0.8, // 80% chance to trade when checked
};

// Solscan API for transaction verification
const SOLSCAN_API = 'https://public-api.solscan.io/transaction';

async function verifySolscanTransaction(txId: string, retries = 3): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1))); // Wait before checking

      const response = await axios.get(`${SOLSCAN_API}/${txId}`, {
        headers: {
          accept: 'application/json',
        },
      });

      if (response.data && response.data.success) {
        return true;
      }
    } catch (error) {
      // Transaction might not be indexed yet
    }
  }
  return false;
}

export const liveTradingScenarios: TestSuite = {
  name: 'Live Trading E2E Tests',
  tests: [
    {
      name: '5-Minute Live Trading Test',
      fn: async (runtime: IAgentRuntime) => {
        console.log('\n🚀 Starting 5-Minute Live Trading Test');
        console.log('=====================================\n');

        // Check required environment variables
        const privateKey = runtime.getSetting('SOLANA_PRIVATE_KEY');
        const birdeyeKey = runtime.getSetting('BIRDEYE_API_KEY');

        if (!privateKey) {
          throw new Error('SOLANA_PRIVATE_KEY not configured');
        }

        if (!birdeyeKey) {
          throw new Error('BIRDEYE_API_KEY not configured');
        }

        // Get services
        const autoTrading = runtime.getService('AutoTradingService') as any;
        const walletService = runtime.getService('WalletIntegrationService') as any;
        const transactionMonitoring = runtime.getService('TransactionMonitoringService') as any;
        const strategyRegistry = runtime.getService('StrategyRegistryService') as any;

        assert(autoTrading, 'AutoTradingService not available');
        assert(walletService, 'WalletIntegrationService not available');
        assert(transactionMonitoring, 'TransactionMonitoringService not available');
        assert(strategyRegistry, 'StrategyRegistryService not available');

        // Check wallet balance
        const walletAddress = walletService.getWalletAddress();
        const balance = await walletService.getBalance();

        console.log(`💰 Wallet: ${walletAddress}`);
        console.log(`   SOL: ${balance.sol.toFixed(4)} SOL`);

        const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
        const usdcBalance = balance.tokens.get(USDC_MINT);
        console.log(`   USDC: $${usdcBalance?.amount.toFixed(2) || '0.00'}\n`);

        assert(
          usdcBalance && usdcBalance.amount >= LIVE_TRADING_TEST_CONFIG.MAX_POSITION_SIZE,
          `Insufficient USDC balance. Need at least $${LIVE_TRADING_TEST_CONFIG.MAX_POSITION_SIZE}`
        );

        // Configure aggressive strategy for testing
        const { RandomStrategy } = await import('../../strategies/RandomStrategy.ts');
        const randomStrategy = new RandomStrategy();
        randomStrategy.configure({
          tradeAttemptProbability: LIVE_TRADING_TEST_CONFIG.TRADE_PROBABILITY,
          maxTradeSizePercentage: 1,
        });
        strategyRegistry.registerStrategy(randomStrategy);

        // Token addresses
        const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
        const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

        // Track executed transactions
        const executedTransactions: string[] = [];
        let lastTransactionCount = 0;

        // Start trading
        console.log('🤖 Starting auto-trading...\n');

        await autoTrading.startTrading({
          strategy: 'random-v1',
          tokens: [BONK, WIF],
          maxPositionSize: LIVE_TRADING_TEST_CONFIG.MAX_POSITION_SIZE,
          intervalMs: LIVE_TRADING_TEST_CONFIG.TRADE_INTERVAL,
          stopLossPercent: LIVE_TRADING_TEST_CONFIG.STOP_LOSS_PERCENT,
          takeProfitPercent: LIVE_TRADING_TEST_CONFIG.TAKE_PROFIT_PERCENT,
          maxDailyLoss: LIVE_TRADING_TEST_CONFIG.MAX_DAILY_LOSS,
        });

        // Monitor for 5 minutes
        const startTime = Date.now();
        const checkInterval = setInterval(async () => {
          const elapsed = Date.now() - startTime;
          const remaining = LIVE_TRADING_TEST_CONFIG.TEST_DURATION - elapsed;

          if (remaining <= 0) {
            clearInterval(checkInterval);
            return;
          }

          // Check for new transactions
          const logs = transactionMonitoring.getTransactionLogs({
            status: 'success',
            type: 'swap',
            limit: 20,
          });

          if (logs.length > lastTransactionCount) {
            const newTxs = logs.slice(0, logs.length - lastTransactionCount);
            for (const tx of newTxs) {
              if (!executedTransactions.includes(tx.signature)) {
                executedTransactions.push(tx.signature);
                console.log(`\n🎉 Transaction Confirmed: ${tx.signature}`);

                // Verify on Solscan
                const verified = await verifySolscanTransaction(tx.signature);
                if (verified) {
                  console.log(`   ✅ Verified on Solscan: https://solscan.io/tx/${tx.signature}`);
                }
              }
            }
            lastTransactionCount = logs.length;
          }

          // Status update
          const positions = autoTrading.getPositions();
          const dailyPnL = autoTrading.getDailyPnL();
          const txMetrics = transactionMonitoring.getTransactionMetrics();

          console.log(`\n⏱️  Time remaining: ${Math.ceil(remaining / 1000)}s`);
          console.log(`📊 Positions: ${positions.length}, P&L: $${dailyPnL.toFixed(2)}`);
          console.log(
            `📝 Transactions: ${txMetrics.successfulTransactions}/${txMetrics.totalTransactions} successful`
          );
        }, 15000); // Check every 15 seconds

        // Wait for test duration
        await new Promise((resolve) => setTimeout(resolve, LIVE_TRADING_TEST_CONFIG.TEST_DURATION));

        // Stop trading
        clearInterval(checkInterval);
        console.log('\n\n🛑 Stopping trading...');
        await autoTrading.stopTrading();

        // Final report
        console.log('\n' + '='.repeat(60));
        console.log('📊 LIVE TRADING TEST RESULTS');
        console.log('='.repeat(60) + '\n');

        const finalTxMetrics = transactionMonitoring.getTransactionMetrics();
        const finalPnL = autoTrading.getTotalPnL();

        console.log('Summary:');
        console.log(`- Test duration: 5 minutes`);
        console.log(`- Total P&L: $${finalPnL.toFixed(2)}`);
        console.log(`- Executed transactions: ${executedTransactions.length}`);
        console.log(
          `- Success rate: ${finalTxMetrics.totalTransactions > 0 ? ((finalTxMetrics.successfulTransactions / finalTxMetrics.totalTransactions) * 100).toFixed(1) : 0}%`
        );
        console.log(`- Total fees: ${finalTxMetrics.totalFees.toFixed(4)} SOL`);

        if (executedTransactions.length > 0) {
          console.log('\n✅ Verified Transactions on Solscan:');
          for (const tx of executedTransactions) {
            console.log(`   https://solscan.io/tx/${tx}`);
          }
        }

        // Test assertions
        assert(
          executedTransactions.length > 0,
          'TEST FAILED: No trades were executed during the test period'
        );

        // Verify at least one transaction on Solscan
        let verifiedCount = 0;
        for (const tx of executedTransactions) {
          if (await verifySolscanTransaction(tx)) {
            verifiedCount++;
          }
        }

        assert(verifiedCount > 0, 'TEST FAILED: No transactions could be verified on Solscan');

        console.log(
          `\n✅ TEST PASSED: ${executedTransactions.length} trades executed, ${verifiedCount} verified on Solscan!`
        );

        // Save results
        const testResults = {
          testName: '5-Minute Live Trading Test',
          duration: LIVE_TRADING_TEST_CONFIG.TEST_DURATION,
          walletAddress,
          executedTransactions,
          verifiedCount,
          metrics: finalTxMetrics,
          finalPnL,
          timestamp: new Date().toISOString(),
        };

        const fs = await import('fs/promises');
        await fs.writeFile('live_trading_e2e_results.json', JSON.stringify(testResults, null, 2));
        console.log('\n📝 Test results saved to: live_trading_e2e_results.json');
      },
    },

    {
      name: 'Quick Live Trading Test (1 minute)',
      fn: async (runtime: IAgentRuntime) => {
        console.log('\n🚀 Starting Quick Live Trading Test (1 minute)');
        console.log('============================================\n');

        // Similar to above but with shorter duration and more aggressive settings
        const QUICK_TEST_DURATION = 60000; // 1 minute
        const QUICK_TRADE_INTERVAL = 10000; // Every 10 seconds

        // Get services
        const autoTrading = runtime.getService('AutoTradingService') as any;
        const walletService = runtime.getService('WalletIntegrationService') as any;
        const transactionMonitoring = runtime.getService('TransactionMonitoringService') as any;
        const strategyRegistry = runtime.getService('StrategyRegistryService') as any;

        // Check wallet
        const walletAddress = walletService.getWalletAddress();
        const balance = await walletService.getBalance();

        console.log(`💰 Wallet: ${walletAddress}`);
        console.log(`   SOL: ${balance.sol.toFixed(4)} SOL`);

        // Configure very aggressive strategy
        const { RandomStrategy } = await import('../../strategies/RandomStrategy.ts');
        const randomStrategy = new RandomStrategy();
        randomStrategy.configure({
          tradeAttemptProbability: 0.95, // 95% chance to trade
          maxTradeSizePercentage: 1,
        });
        strategyRegistry.registerStrategy(randomStrategy);

        // Start trading with just BONK
        const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

        await autoTrading.startTrading({
          strategy: 'random-v1',
          tokens: [BONK],
          maxPositionSize: 5,
          intervalMs: QUICK_TRADE_INTERVAL,
          stopLossPercent: 10,
          takeProfitPercent: 10,
          maxDailyLoss: 20,
        });

        // Monitor for 1 minute
        const executedTransactions: string[] = [];
        const startTime = Date.now();

        while (Date.now() - startTime < QUICK_TEST_DURATION) {
          await new Promise((resolve) => setTimeout(resolve, 5000)); // Check every 5 seconds

          const logs = transactionMonitoring.getTransactionLogs({
            status: 'success',
            type: 'swap',
            limit: 10,
          });

          for (const tx of logs) {
            if (!executedTransactions.includes(tx.signature)) {
              executedTransactions.push(tx.signature);
              console.log(`\n🎉 Transaction: ${tx.signature}`);

              const verified = await verifySolscanTransaction(tx.signature);
              if (verified) {
                console.log(`   ✅ Verified: https://solscan.io/tx/${tx.signature}`);

                // Stop after first verified transaction
                await autoTrading.stopTrading();
                console.log('\n✅ TEST PASSED: Trade executed and verified!');
                return;
              }
            }
          }

          const remaining = QUICK_TEST_DURATION - (Date.now() - startTime);
          console.log(`⏱️  ${Math.ceil(remaining / 1000)}s remaining...`);
        }

        // Stop trading
        await autoTrading.stopTrading();

        assert(executedTransactions.length > 0, 'TEST FAILED: No trades executed in 1 minute');

        assert.fail('TEST FAILED: Trades executed but not verified on Solscan');
      },
    },
  ],
};

export default liveTradingScenarios;
