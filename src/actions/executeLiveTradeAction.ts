import type { IAgentRuntime, Memory, Action, HandlerCallback } from '@elizaos/core';
import { ServiceType } from '@elizaos/core';
import type { IWalletService } from '@elizaos/core';

export const executeLiveTradeAction: Action = {
  name: 'EXECUTE_LIVE_TRADE',
  similes: ['LIVE_TRADE', 'REAL_TRADE', 'EXECUTE_TRADE', 'PLACE_ORDER', 'MAKE_TRADE'],
  description: 'Execute a live trade on supported blockchains',
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text?.toLowerCase() || '';

    // Check for live trade keywords
    const tradeKeywords = [
      'live trade',
      'real trade',
      'execute',
      'place order',
      'buy',
      'sell',
      'swap',
      'trade',
      'purchase',
      'exchange',
    ];

    // Must have at least one trade keyword and not be asking about backtesting/simulation
    const hasTradeKeyword = tradeKeywords.some((keyword) => text.includes(keyword));
    const isSimulation =
      text.includes('backtest') || text.includes('simulation') || text.includes('simulate');

    return hasTradeKeyword && !isSimulation;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: any,
    options: any,
    callback?: HandlerCallback
  ) => {
    try {
      const text = message.content.text?.toLowerCase() || '';

      // Parse trade details from message
      const action = text.includes('sell') ? 'sell' : 'buy';

      // Extract amount and token
      const amountMatch = text.match(/(\d+(?:\.\d+)?)/);
      const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;

      if (!amount || amount <= 0) {
        if (callback) {
          await callback({
            text: "Please specify a valid amount for the trade. Example: 'buy 10 SOL' or 'sell 0.5 ETH'",
          });
        }
        return;
      }

      // Try to get wallet service
      let walletService = runtime.getService(ServiceType.WALLET) as IWalletService;

      if (!walletService) {
        // Try common wallet service names as fallback
        const walletServiceNames = ['WalletService', 'SolanaWalletService', 'EVMWalletService'];
        for (const name of walletServiceNames) {
          walletService = runtime.getService(name) as IWalletService;
          if (walletService) break;
        }
      }

      if (!walletService) {
        if (callback) {
          await callback({
            text: '⚠️ **Trading Not Available**\n\nNo wallet services are currently available. Please ensure:\n1. A wallet plugin is installed (e.g., @elizaos/plugin-solana)\n2. Your wallet is properly configured with private keys\n3. The wallet service is enabled',
          });
        }
        return;
      }

      // Get the token resolver service
      const tokenResolver = runtime.getService('TokenResolverService');

      // Extract token symbol from message
      const tokenMatch = text.match(/\b(sol|eth|btc|usdc|usdt|bnb|[a-z]+)\b/i);
      const tokenSymbol = tokenMatch ? tokenMatch[1].toUpperCase() : 'SOL';

      // Get current portfolio to check balances
      const portfolio = await walletService.getPortfolio();

      if (action === 'sell') {
        // Check if user has the token to sell
        const asset = portfolio.assets.find(
          (a) =>
            a.symbol?.toUpperCase() === tokenSymbol || a.name?.toUpperCase().includes(tokenSymbol)
        );

        if (!asset || (asset.uiAmount || 0) < amount) {
          if (callback) {
            await callback({
              text: `❌ **Insufficient Balance**\n\nYou don't have enough ${tokenSymbol} to sell.\nCurrent balance: ${asset?.uiAmount || 0} ${tokenSymbol}`,
            });
          }
          return;
        }
      }

      // For now, provide informative response about the trade request
      if (callback) {
        await callback({
          text: `📊 **Trade Request Received**

**Action:** ${action.toUpperCase()}
**Amount:** ${amount} ${tokenSymbol}
**Estimated Value:** ~$${(amount * 100).toFixed(2)} (example price)

⚠️ **Note:** Live trading execution is currently in development. 

To execute trades:
1. Use a wallet plugin with trading capabilities
2. Ensure sufficient balance for fees
3. Check network status before trading

For testing, try: "Run a backtest for ${tokenSymbol}"`,
        });
      }
    } catch (error) {
      console.error('Error in executeLiveTradeAction:', error);
      if (callback) {
        await callback({
          text: '❌ An error occurred while processing your trade request. Please try again later.',
        });
      }
    }
  },
  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Buy 10 SOL',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '💰 Processing your order to buy 10 SOL...',
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Execute a live trade: sell 0.5 ETH',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '📉 Preparing to sell 0.5 ETH at current market price...',
        },
      },
    ],
  ],
};
