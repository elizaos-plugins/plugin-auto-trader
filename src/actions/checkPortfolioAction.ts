import type { IAgentRuntime, Memory, Action, HandlerCallback } from '@elizaos/core';
import { ServiceType } from '@elizaos/core';
import type { IWalletService } from '@elizaos/core';

// Type definition based on DummyWalletService.getPortfolio() return structure
type PortfolioHolding = {
  quantity: number;
  averagePrice: number;
  currentPrice?: number;
  value: number;
  assetAddress: string;
};

export const checkPortfolioAction: Action = {
  name: 'CHECK_PORTFOLIO',
  similes: [
    'PORTFOLIO_CHECK',
    'VIEW_PORTFOLIO',
    'SHOW_HOLDINGS',
    'LIST_POSITIONS',
    'WALLET_BALANCE',
    'CHECK_BALANCE',
    'MY_PORTFOLIO',
    'MY_HOLDINGS',
    'MY_BALANCE',
  ],
  description: 'Check current portfolio status including holdings and balances',
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text?.toLowerCase() || '';
    const portfolioKeywords = [
      'portfolio',
      'balance',
      'holdings',
      'positions',
      'wallet',
      'check',
      'show',
      'view',
      'list',
      'my',
    ];

    return portfolioKeywords.some((keyword) => text.includes(keyword));
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: any,
    options: any,
    callback?: HandlerCallback
  ) => {
    try {
      // Try to get wallet service using ServiceType
      let walletService = runtime.getService(ServiceType.WALLET) as IWalletService;

      // If not found, try by name as fallback
      if (!walletService) {
        // Try common wallet service names
        const walletServiceNames = ['WalletService', 'SolanaWalletService', 'DummyWalletService'];
        for (const name of walletServiceNames) {
          walletService = runtime.getService(name) as IWalletService;
          if (walletService) break;
        }
      }

      if (!walletService) {
        if (callback) {
          await callback({
            text: '⚠️ No wallet services are currently available. Please ensure a wallet plugin is installed and configured.',
          });
        }
        return;
      }

      // Get portfolio from wallet service
      const portfolio = await walletService.getPortfolio();

      if (!portfolio || portfolio.assets.length === 0) {
        if (callback) {
          await callback({
            text: '📊 **Portfolio Status**\n\nYour portfolio is currently empty.',
          });
        }
        return;
      }

      // Format portfolio data
      const assetList = portfolio.assets
        .filter((asset) => asset.uiAmount && asset.uiAmount > 0)
        .map((asset) => {
          const value = asset.valueUsd || 0;
          const percentOfPortfolio =
            portfolio.totalValueUsd > 0
              ? ((value / portfolio.totalValueUsd) * 100).toFixed(1)
              : '0.0';

          return `• **${asset.symbol || asset.name || 'Unknown'}**: ${asset.uiAmount?.toFixed(4)} (~$${value.toFixed(2)}) - ${percentOfPortfolio}%`;
        })
        .join('\n');

      const response = `📊 **Portfolio Status**

**Total Value:** $${portfolio.totalValueUsd.toFixed(2)}

**Holdings:**
${assetList}

*Last updated: ${new Date().toISOString()}*`;

      if (callback) {
        await callback({
          text: response,
        });
      }
    } catch (error) {
      console.error('Error checking portfolio:', error);
      if (callback) {
        await callback({
          text: '❌ Failed to fetch portfolio data. Please try again later.',
        });
      }
    }
  },
  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Check my portfolio',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '📊 **Portfolio Status**\n\nChecking your current holdings...',
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Show my balance',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '💰 Fetching your wallet balance...',
        },
      },
    ],
  ],
};
