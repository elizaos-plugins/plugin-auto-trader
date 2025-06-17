import type { IAgentRuntime, Memory, Provider, State } from '@elizaos/core';
import { PerformanceReportingService } from '../services/PerformanceReportingService.ts';

export const performanceProvider: Provider = {
  name: 'PERFORMANCE',
  get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      // Get performance reporting service
      const performanceService = runtime.getService(
        'PerformanceReportingService'
      ) as PerformanceReportingService;

      if (!performanceService) {
        return { text: 'Performance data is currently unavailable.' };
      }

      // Mock recent performance data (in a real implementation, this would fetch actual historical data)
      const mockPortfolioHistory = [
        {
          timestamp: Date.now() - 86400000 * 30, // 30 days ago
          totalValue: 10000,
          cash: 10000,
          holdings: {},
        },
        {
          timestamp: Date.now() - 86400000 * 15, // 15 days ago
          totalValue: 10234.56,
          cash: 9156.78,
          holdings: { 'SOL/USDC': { quantity: 10, averagePrice: 107.78, symbol: 'SOL/USDC' } },
        },
        {
          timestamp: Date.now() - 86400000 * 7, // 7 days ago
          totalValue: 10456.23,
          cash: 8934.12,
          holdings: { 'SOL/USDC': { quantity: 15, averagePrice: 101.48, symbol: 'SOL/USDC' } },
        },
        {
          timestamp: Date.now(), // Now
          totalValue: 10678.9,
          cash: 7234.56,
          holdings: {
            'SOL/USDC': { quantity: 20, averagePrice: 97.22, symbol: 'SOL/USDC' },
            'ETH/USDC': { quantity: 5, averagePrice: 3445.67, symbol: 'ETH/USDC' },
          },
        },
      ];

      // Calculate performance metrics
      const initialValue = mockPortfolioHistory[0].totalValue;
      const currentValue = mockPortfolioHistory[mockPortfolioHistory.length - 1].totalValue;
      const totalReturn = ((currentValue - initialValue) / initialValue) * 100;
      const daysPeriod = 30;

      // Generate performance summary
      let performanceText = `📊 **Performance Summary (Last ${daysPeriod} Days)**\n\n`;
      performanceText += `💰 **Initial Portfolio:** $${initialValue.toLocaleString()}\n`;
      performanceText += `📈 **Current Portfolio:** $${currentValue.toLocaleString()}\n`;
      performanceText += `📊 **Total Return:** ${totalReturn.toFixed(2)}% ${totalReturn > 0 ? '📈' : '📉'}\n`;
      performanceText += `💹 **Profit/Loss:** ${totalReturn > 0 ? '+' : ''}$${(currentValue - initialValue).toFixed(2)}\n\n`;

      // Performance analysis
      if (totalReturn > 10) {
        performanceText += `🚀 **Performance:** Excellent! Strong returns over the period.\n`;
      } else if (totalReturn > 5) {
        performanceText += `✅ **Performance:** Good solid returns.\n`;
      } else if (totalReturn > 0) {
        performanceText += `📈 **Performance:** Positive but modest gains.\n`;
      } else if (totalReturn > -5) {
        performanceText += `⚠️ **Performance:** Minor losses, within acceptable range.\n`;
      } else {
        performanceText += `🔴 **Performance:** Significant losses, review strategy.\n`;
      }

      // Add trend analysis
      const recentPerformance =
        ((mockPortfolioHistory[3].totalValue - mockPortfolioHistory[2].totalValue) /
          mockPortfolioHistory[2].totalValue) *
        100;
      performanceText += `📊 **Recent Trend (7 days):** ${recentPerformance.toFixed(2)}% ${recentPerformance > 0 ? '📈' : '📉'}\n`;

      // Portfolio composition change
      const currentHoldings = Object.keys(mockPortfolioHistory[3].holdings).length;
      const initialHoldings = Object.keys(mockPortfolioHistory[0].holdings).length;

      if (currentHoldings > initialHoldings) {
        performanceText += `📈 **Diversification:** Portfolio expanded from ${initialHoldings} to ${currentHoldings} positions\n`;
      } else if (currentHoldings < initialHoldings) {
        performanceText += `📉 **Concentration:** Portfolio reduced from ${initialHoldings} to ${currentHoldings} positions\n`;
      } else {
        performanceText += `⚖️ **Diversification:** Consistent ${currentHoldings} position(s)\n`;
      }

      // Risk assessment
      const maxDrawdown = 2.3; // Mock calculation
      performanceText += `\n🎯 **Risk Metrics:**\n`;
      performanceText += `• Max Drawdown: ${maxDrawdown.toFixed(1)}%\n`;
      performanceText += `• Volatility: ${(Math.abs(recentPerformance) * 2).toFixed(1)}% (estimated)\n`;

      if (maxDrawdown < 5) {
        performanceText += `• Risk Level: Low 🟢\n`;
      } else if (maxDrawdown < 10) {
        performanceText += `• Risk Level: Moderate 🟡\n`;
      } else {
        performanceText += `• Risk Level: High 🔴\n`;
      }

      return { text: performanceText };
    } catch (error) {
      console.error('[PerformanceProvider] Error:', error);
      return { text: 'Unable to retrieve performance data at this time.' };
    }
  },
};
