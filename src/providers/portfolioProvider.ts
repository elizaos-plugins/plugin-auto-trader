import type { IAgentRuntime, Memory, Provider, State } from '@elizaos/core';
import { ServiceType } from '@elizaos/core';
import type { IWalletService } from '@elizaos/core';

export const portfolioProvider: Provider = {
  name: 'PORTFOLIO_PROVIDER',
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    try {
      // Get wallet service using ServiceType
      let walletService = runtime.getService(ServiceType.WALLET) as IWalletService;

      // If not found, try by name as fallback
      if (!walletService) {
        // Try common wallet service names
        const walletServiceNames = [
          'WalletService',
          'SolanaWalletService',
          'WalletIntegrationService',
        ];
        for (const name of walletServiceNames) {
          walletService = runtime.getService(name) as IWalletService;
          if (walletService) break;
        }
      }

      if (!walletService) {
        return { text: 'Portfolio information is currently unavailable.' };
      }

      // Get current portfolio state
      const portfolio = await walletService.getPortfolio();

      if (!portfolio || !portfolio.assets) {
        return { text: '📊 **Portfolio Status**\n\nYour portfolio is currently empty.' };
      }

      // Calculate total portfolio value
      const totalBalance = portfolio.totalValueUsd;

      // Format portfolio information
      let portfolioText = `📊 **Current Portfolio Status**\n\n`;
      portfolioText += `📈 **Total Portfolio Value:** $${totalBalance.toFixed(2)}\n\n`;

      // List holdings
      const holdings = portfolio.assets.filter((asset) => asset.uiAmount && asset.uiAmount > 0);
      if (holdings.length > 0) {
        portfolioText += `🏦 **Current Holdings:**\n`;
        for (const asset of holdings) {
          const value = asset.valueUsd || 0;
          const percentOfPortfolio =
            totalBalance > 0 ? ((value / totalBalance) * 100).toFixed(1) : '0.0';

          portfolioText += `• **${asset.symbol || asset.name || 'Unknown'}**: ${asset.uiAmount?.toFixed(4)} (~$${value.toFixed(2)}) - ${percentOfPortfolio}%\n`;
        }
      } else {
        portfolioText += `🏦 **Current Holdings:** No active positions\n`;
      }

      // Calculate portfolio allocation
      if (totalBalance > 0) {
        const cashAsset = portfolio.assets.find((a) => a.symbol === 'USDC' || a.symbol === 'USD');
        const cashBalance = cashAsset?.valueUsd || 0;
        const cashPercentage = ((cashBalance / totalBalance) * 100).toFixed(1);
        const investedPercentage = (((totalBalance - cashBalance) / totalBalance) * 100).toFixed(1);
        portfolioText += `\n📊 **Allocation:**\n`;
        portfolioText += `• Cash: ${cashPercentage}%\n`;
        portfolioText += `• Invested: ${investedPercentage}%\n`;
      }

      return { text: portfolioText };
    } catch (error) {
      console.error('[PortfolioProvider] Error:', error);
      return { text: 'Unable to retrieve portfolio information at this time.' };
    }
  },
};
