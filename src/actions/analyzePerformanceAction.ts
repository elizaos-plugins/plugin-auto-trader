import type { IAgentRuntime, Memory, Action, HandlerCallback } from '@elizaos/core';
import { PerformanceReportingService } from '../services/PerformanceReportingService.ts';
import { TradeType, OrderType, Trade, PortfolioSnapshot } from '../types.ts';

export const analyzePerformanceAction: Action = {
  name: 'ANALYZE_PERFORMANCE',
  similes: [
    'PERFORMANCE_ANALYSIS',
    'CHECK_PERFORMANCE',
    'TRADING_RESULTS',
    'ANALYZE_RESULTS',
    'PERFORMANCE_REPORT',
  ],
  description: 'Analyze trading performance and provide detailed metrics',
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text?.toLowerCase() || '';

    // Check for performance analysis keywords
    const performanceKeywords = [
      'performance',
      'analyze',
      'results',
      'metrics',
      'report',
      'how did',
      'how well',
      'profit',
      'loss',
      'p&l',
      'pnl',
      'winning',
      'losing',
      'trades',
      'sharpe',
      'drawdown',
    ];

    return performanceKeywords.some((keyword) => text.includes(keyword));
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: any,
    options: any,
    callback?: HandlerCallback
  ) => {
    try {
      // Get services
      const performanceService = runtime.getService(
        'PerformanceReportingService'
      ) as PerformanceReportingService;

      if (!performanceService) {
        if (callback) {
          await callback({
            text: "I'm sorry, but the performance analysis service isn't available right now. Please try again later.",
          });
        }
        return;
      }

      // For demo purposes, create mock performance data
      // In a real implementation, this would fetch actual performance history
      const mockTrades: Trade[] = [
        {
          pair: 'SOL/USDC',
          action: TradeType.BUY,
          quantity: 10,
          orderType: OrderType.MARKET,
          timestamp: Date.now() - 86400000 * 7, // 7 days ago
          executedPrice: 95.5,
          executedTimestamp: Date.now() - 86400000 * 7,
          fees: 2.5,
          realizedPnl: 0,
        },
        {
          pair: 'SOL/USDC',
          action: TradeType.SELL,
          quantity: 10,
          orderType: OrderType.MARKET,
          timestamp: Date.now() - 86400000 * 3, // 3 days ago
          executedPrice: 102.25,
          executedTimestamp: Date.now() - 86400000 * 3,
          fees: 2.5,
          realizedPnl: 62.5, // (102.25 - 95.50) * 10 - 5.00 fees
        },
      ];

      const mockPortfolioHistory: PortfolioSnapshot[] = [
        {
          timestamp: Date.now() - 86400000 * 7,
          totalValue: 10000,
          holdings: { SOL: 10 },
        },
        {
          timestamp: Date.now() - 86400000 * 3,
          totalValue: 10062.5,
          holdings: {},
        },
      ];

      // Generate performance metrics
      const metrics = performanceService.generateMetrics(
        mockTrades,
        mockPortfolioHistory,
        10000, // initial capital
        10062.5, // final capital
        95.5, // first asset price
        102.25 // last asset price
      );

      // Format results for user
      const response = `📈 **Performance Analysis Report**

**Overall Performance:**
• Total Return: ${metrics.totalPnlPercentage.toFixed(2)}% (${metrics.totalPnlAbsolute > 0 ? '+' : ''}$${metrics.totalPnlAbsolute.toFixed(2)})
• Win Rate: ${((metrics.winningTrades / Math.max(metrics.totalTrades, 1)) * 100).toFixed(1)}%
• Risk-Adjusted Return: ${metrics.sharpeRatio?.toFixed(2) || 'N/A'} (Sharpe Ratio)

**Trading Statistics:**
• Total Trades: ${metrics.totalTrades}
• Winning Trades: ${metrics.winningTrades}
• Losing Trades: ${metrics.losingTrades}
• Average Win: $${metrics.averageWinAmount.toFixed(2)}
• Average Loss: $${Math.abs(metrics.averageLossAmount).toFixed(2)}

**Risk Metrics:**
• Maximum Drawdown: ${(metrics.maxDrawdown * 100).toFixed(2)}%
• Win/Loss Ratio: ${metrics.winLossRatio.toFixed(2)}x

**Benchmark Comparison:**
• Buy & Hold Return: ${metrics.buyAndHoldPnlPercentage?.toFixed(2) || 'N/A'}%
• Strategy vs Buy & Hold: ${
        metrics.buyAndHoldPnlPercentage
          ? (metrics.totalPnlPercentage - metrics.buyAndHoldPnlPercentage).toFixed(2)
          : 'N/A'
      }% ${
        metrics.buyAndHoldPnlPercentage &&
        metrics.totalPnlPercentage > metrics.buyAndHoldPnlPercentage
          ? '🎯'
          : '⚠️'
      }

**Analysis:**
${
  metrics.totalPnlAbsolute > 0
    ? '✅ Positive performance! Your strategy is generating profits.'
    : '❌ Negative performance. Consider reviewing your strategy parameters.'
}

${
  metrics.winningTrades > metrics.losingTrades
    ? '🎯 Good win rate - more winning than losing trades.'
    : '⚠️ Low win rate - consider improving trade selection.'
}

${
  metrics.maxDrawdown < 0.1
    ? '🛡️ Low drawdown indicates good risk management.'
    : '⚠️ High drawdown suggests increased risk exposure.'
}`;

      if (callback) {
        await callback({
          text: response,
        });
      }
    } catch (error) {
      console.error('[AnalyzePerformanceAction] Error:', error);
      if (callback) {
        await callback({
          text: 'I encountered an error while analyzing performance. Please try again later.',
        });
      }
    }
  },
  examples: [
    [
      {
        name: '{{user1}}',
        content: { text: 'How did my trading strategy perform? Can you analyze the results?' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: "I'll analyze your trading performance and provide a detailed breakdown of your results, including profit/loss, win rate, and risk metrics...",
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: { text: 'What are my trading metrics and drawdown?' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Let me generate a comprehensive performance report with your trading metrics and risk analysis...',
        },
      },
    ],
  ],
};
