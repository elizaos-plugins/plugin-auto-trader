import type { IAgentRuntime, TestSuite, Content } from '@elizaos/core';
import { strict as assert } from 'node:assert';
import { setupScenario, sendMessageAndWaitForResponse } from './test-utils.ts';

// Mock trading configuration
const MOCK_CONFIG = {
  INITIAL_BALANCE: {
    SOL: 1.5,
    USDC: 1000,
    BONK: 1000000,
    WIF: 500,
  } as Record<string, number>,
  MOCK_PRICES: {
    BONK: 0.00002,
    WIF: 2.5,
    SOL: 100,
  } as Record<string, number>,
  PRICE_VOLATILITY: 0.05, // 5% price swings
  TRADE_SUCCESS_RATE: 0.9, // 90% of trades succeed
};

// Mock price generator
function generateMockPrice(basePrice: number, volatility: number): number {
  const change = (Math.random() - 0.5) * 2 * volatility;
  return basePrice * (1 + change);
}

// Mock transaction generator
function generateMockTransaction(
  type: 'buy' | 'sell',
  token: string,
  amount: number,
  price: number
): any {
  const txId = `mock_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  return {
    signature: txId,
    timestamp: Date.now(),
    status: Math.random() < MOCK_CONFIG.TRADE_SUCCESS_RATE ? 'success' : 'failed',
    type: 'swap',
    metadata: {
      direction: type,
      token,
      amount,
      price,
      usdValue: amount * price,
    },
  };
}

export const mockTradingScenario: TestSuite = {
  name: 'Mock Trading Scenarios',
  tests: [
    {
      name: 'Full Trading Lifecycle Mock Test',
      fn: async (runtime: IAgentRuntime) => {
        console.log('\n🎭 Starting Mock Trading Scenario');
        console.log('=================================\n');
        console.log('💡 This test runs with simulated trades - no real funds required\n');

        // Setup test environment
        const { user, room } = await setupScenario(runtime);

        // Initialize mock services
        const mockBalances = { ...MOCK_CONFIG.INITIAL_BALANCE };
        const mockPrices = { ...MOCK_CONFIG.MOCK_PRICES };
        const mockTransactions: any[] = [];
        const mockPositions: any[] = [];

        // Override service methods for mocking
        const autoTrading = runtime.getService('AutoTradingService') as any;
        const walletService = runtime.getService('WalletIntegrationService') as any;
        const transactionMonitoring = runtime.getService('TransactionMonitoringService') as any;

        // Mock wallet service
        if (walletService) {
          walletService.getBalance = async () => ({
            sol: mockBalances.SOL,
            tokens: new Map([
              ['USDC', { amount: mockBalances.USDC, decimals: 6 }],
              ['BONK', { amount: mockBalances.BONK, decimals: 5 }],
              ['WIF', { amount: mockBalances.WIF, decimals: 6 }],
            ]),
          });

          walletService.getWalletAddress = () => 'MockWallet1111111111111111111111111111111111';
        }

        // Mock transaction monitoring
        if (transactionMonitoring) {
          transactionMonitoring.getTransactionLogs = (filter: any) => {
            return mockTransactions
              .filter(
                (tx) =>
                  (!filter.status || tx.status === filter.status) &&
                  (!filter.type || tx.type === filter.type)
              )
              .slice(0, filter.limit || 10);
          };

          transactionMonitoring.getTransactionMetrics = () => ({
            totalTransactions: mockTransactions.length,
            successfulTransactions: mockTransactions.filter((tx) => tx.status === 'success').length,
            failedTransactions: mockTransactions.filter((tx) => tx.status === 'failed').length,
            totalFees: mockTransactions.length * 0.001, // Mock 0.001 SOL per tx
          });
        }

        // Mock auto trading
        if (autoTrading) {
          autoTrading.getPositions = () => mockPositions;
          autoTrading.getDailyPnL = () => {
            return mockPositions.reduce((pnl, pos) => {
              const currentPrice = mockPrices[pos.token] || 0;
              const unrealizedPnL = (currentPrice - pos.entryPrice) * pos.amount;
              return pnl + unrealizedPnL;
            }, 0);
          };
          autoTrading.getTotalPnL = () => autoTrading.getDailyPnL();
        }

        // Conversation flow
        console.log('💬 Starting conversation with trading agent...\n');

        // 1. Check initial portfolio
        const portfolioResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          'Show me my portfolio balance'
        );
        console.log(`👤 User: Show me my portfolio balance`);
        console.log(`🤖 Agent: ${portfolioResponse.text}\n`);
        assert(portfolioResponse.text, 'Agent should respond with portfolio information');

        // 2. Get market analysis
        const marketResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          "What's your analysis of BONK and WIF right now?"
        );
        console.log(`👤 User: What's your analysis of BONK and WIF right now?`);
        console.log(`🤖 Agent: ${marketResponse.text}\n`);

        // 3. Configure strategy
        const strategyResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          'Set up the momentum strategy with $20 max position size and 5% stop loss'
        );
        console.log(
          `👤 User: Set up the momentum strategy with $20 max position size and 5% stop loss`
        );
        console.log(`🤖 Agent: ${strategyResponse.text}\n`);

        // 4. Start mock trading
        const startResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          'Start trading BONK and WIF with the momentum strategy'
        );
        console.log(`👤 User: Start trading BONK and WIF with the momentum strategy`);
        console.log(`🤖 Agent: ${startResponse.text}\n`);

        // Simulate trading activity
        console.log('📊 Simulating trading activity...\n');

        let tradeCount = 0;
        const tradingDuration = 30000; // 30 seconds of mock trading
        const startTime = Date.now();

        const tradingInterval = setInterval(async () => {
          // Update mock prices
          Object.keys(mockPrices).forEach((token) => {
            mockPrices[token] = generateMockPrice(
              MOCK_CONFIG.MOCK_PRICES[token],
              MOCK_CONFIG.PRICE_VOLATILITY
            );
          });

          // Simulate a trade decision
          if (Math.random() > 0.5 && tradeCount < 5) {
            const tokens = ['BONK', 'WIF'];
            const token = tokens[Math.floor(Math.random() * tokens.length)];
            const isBuy = Math.random() > 0.5;
            const amount = Math.random() * 100;

            // Create mock transaction
            const mockTx = generateMockTransaction(
              isBuy ? 'buy' : 'sell',
              token,
              amount,
              mockPrices[token]
            );

            mockTransactions.push(mockTx);

            if (mockTx.status === 'success') {
              // Update mock position
              if (isBuy) {
                mockPositions.push({
                  token,
                  amount,
                  entryPrice: mockPrices[token],
                  timestamp: Date.now(),
                });

                // Update mock balance
                mockBalances.USDC -= amount * mockPrices[token];
                mockBalances[token] = (mockBalances[token] || 0) + amount;
              } else {
                // Find and close position
                const posIndex = mockPositions.findIndex((p) => p.token === token);
                if (posIndex >= 0) {
                  const position = mockPositions[posIndex];
                  mockPositions.splice(posIndex, 1);

                  // Update mock balance
                  mockBalances.USDC += amount * mockPrices[token];
                  mockBalances[token] = (mockBalances[token] || 0) - amount;
                }
              }

              console.log(`\n💹 Mock Trade Executed:`);
              console.log(`   Type: ${isBuy ? 'BUY' : 'SELL'} ${token}`);
              console.log(`   Amount: ${amount.toFixed(2)} ${token}`);
              console.log(`   Price: $${mockPrices[token].toFixed(6)}`);
              console.log(`   Value: $${(amount * mockPrices[token]).toFixed(2)}`);
              console.log(`   TX: ${mockTx.signature}`);

              tradeCount++;
            }
          }

          // Check if we should stop
          if (Date.now() - startTime > tradingDuration) {
            clearInterval(tradingInterval);
          }
        }, 5000); // Check every 5 seconds

        // Wait for trading to complete
        await new Promise((resolve) => setTimeout(resolve, tradingDuration + 1000));

        // 5. Check status during trading
        const statusResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          'How is the trading going? Show me current P&L'
        );
        console.log(`\n👤 User: How is the trading going? Show me current P&L`);
        console.log(`🤖 Agent: ${statusResponse.text}\n`);

        // 6. Stop trading
        const stopResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          'Stop trading and show me the final report'
        );
        console.log(`👤 User: Stop trading and show me the final report`);
        console.log(`🤖 Agent: ${stopResponse.text}\n`);

        // Final report
        console.log('\n' + '='.repeat(50));
        console.log('📊 MOCK TRADING SCENARIO RESULTS');
        console.log('='.repeat(50) + '\n');

        console.log('Trading Summary:');
        console.log(`- Duration: ${tradingDuration / 1000} seconds`);
        console.log(`- Total trades: ${mockTransactions.length}`);
        console.log(
          `- Successful trades: ${mockTransactions.filter((tx) => tx.status === 'success').length}`
        );
        console.log(
          `- Failed trades: ${mockTransactions.filter((tx) => tx.status === 'failed').length}`
        );
        console.log(`- Open positions: ${mockPositions.length}`);

        console.log('\nFinal Balances:');
        console.log(`- SOL: ${mockBalances.SOL.toFixed(4)}`);
        console.log(`- USDC: $${mockBalances.USDC.toFixed(2)}`);
        console.log(`- BONK: ${mockBalances.BONK.toFixed(0)}`);
        console.log(`- WIF: ${mockBalances.WIF.toFixed(2)}`);

        console.log('\nPrice Changes:');
        Object.keys(MOCK_CONFIG.MOCK_PRICES).forEach((token) => {
          const initialPrice = MOCK_CONFIG.MOCK_PRICES[token];
          const finalPrice = mockPrices[token];
          const change = ((finalPrice - initialPrice) / initialPrice) * 100;
          console.log(
            `- ${token}: $${initialPrice} → $${finalPrice.toFixed(6)} (${change > 0 ? '+' : ''}${change.toFixed(2)}%)`
          );
        });

        // Assertions
        assert(mockTransactions.length > 0, 'Should execute at least one mock trade');
        assert(statusResponse.text, 'Agent should provide status update');
        assert(stopResponse.text, 'Agent should provide final report');

        console.log('\n✅ MOCK TRADING SCENARIO COMPLETED SUCCESSFULLY!');
      },
    },

    {
      name: 'Strategy Comparison Mock Test',
      fn: async (runtime: IAgentRuntime) => {
        console.log('\n🔄 Starting Strategy Comparison Mock Test');
        console.log('========================================\n');

        const { user, room } = await setupScenario(runtime);

        // Ask agent to compare strategies
        const compareResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          'Compare the performance of momentum, RSI, and random strategies for BONK trading'
        );
        console.log(
          `👤 User: Compare the performance of momentum, RSI, and random strategies for BONK trading`
        );
        console.log(`🤖 Agent: ${compareResponse.text}\n`);

        assert(
          compareResponse.text?.includes('momentum') || compareResponse.text?.includes('RSI'),
          'Agent should discuss different strategies'
        );

        // Ask for backtest
        const backtestResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          'Run a backtest of the RSI strategy on BONK for the last 7 days'
        );
        console.log(`👤 User: Run a backtest of the RSI strategy on BONK for the last 7 days`);
        console.log(`🤖 Agent: ${backtestResponse.text}\n`);

        assert(backtestResponse.text, 'Agent should provide backtest results');

        console.log('✅ Strategy comparison test completed!');
      },
    },
  ],
};

export default mockTradingScenario;
