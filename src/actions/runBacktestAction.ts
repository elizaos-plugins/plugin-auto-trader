import type { IAgentRuntime, Memory, Action, HandlerCallback } from '@elizaos/core';
import { SimulationService } from '../services/SimulationService.ts';
import { StrategyRegistryService } from '../services/StrategyRegistryService.ts';

export const runBacktestAction: Action = {
  name: 'RUN_BACKTEST',
  similes: ['RUN_SIMULATION', 'BACKTEST', 'TEST_STRATEGY', 'SIMULATE_TRADING', 'ANALYZE_STRATEGY'],
  description: 'Run a trading backtest simulation with specified parameters',
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text?.toLowerCase() || '';

    // Check for backtest-related keywords
    const backtestKeywords = [
      'backtest',
      'simulation',
      'test strategy',
      'simulate',
      'run test',
      'analyze strategy',
      'performance test',
    ];

    return backtestKeywords.some((keyword) => text.includes(keyword));
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
      const simulationService = runtime.getService('SimulationService') as SimulationService;
      const strategyRegistry = runtime.getService(
        'StrategyRegistryService'
      ) as StrategyRegistryService;

      if (!simulationService || !strategyRegistry) {
        if (callback) {
          await callback({
            text: "I'm sorry, but the trading services aren't available right now. Please try again later.",
          });
        }
        return;
      }

      // Parse user request
      const text = message.content.text?.toLowerCase() || '';

      // Extract parameters from natural language
      const symbolMatch = text.match(/(\w+\/\w+|\w+\-\w+)/);
      const symbol = symbolMatch ? symbolMatch[1].replace('-', '/') : 'SOL/USDC';

      const capitalMatch = text.match(/\$?([\d,]+)/);
      const initialCapital = capitalMatch ? parseInt(capitalMatch[1].replace(',', '')) : 10000;

      const daysMatch = text.match(/(\d+)\s*days?/);
      const days = daysMatch ? parseInt(daysMatch[1]) : 30;

      // Strategy detection
      let strategyId = 'random-v1'; // default
      if (text.includes('random')) {
        strategyId = 'random-v1';
      } else if (text.includes('rule') || text.includes('technical')) {
        strategyId = 'rule-based-v1';
      } else if (text.includes('llm') || text.includes('ai')) {
        strategyId = 'llm-v1';
      }

      // Set up simulation parameters
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - days);

      const simParams = {
        strategyName: strategyId,
        pair: symbol,
        interval: '1h',
        startDate,
        endDate,
        initialCapital,
        dataSource: 'mockSource',
      };

      // Run the backtest
      const report = await simulationService.runBacktest(simParams);

      // Format results for user
      const returnPercent = (
        ((report.finalPortfolioValue - initialCapital) / initialCapital) *
        100
      ).toFixed(2);
      const strategy = strategyRegistry.getStrategy(strategyId);

      const response = `📊 **Backtest Results for ${symbol}**

**Strategy:** ${strategy?.name || 'Unknown'}
**Period:** ${days} days (${startDate.toDateString()} to ${endDate.toDateString()})
**Initial Capital:** $${initialCapital.toLocaleString()}
**Final Capital:** $${report.finalPortfolioValue.toLocaleString()}
**Total Return:** ${returnPercent}% ${parseFloat(returnPercent) > 0 ? '📈' : '📉'}

**Trading Activity:**
• Number of Trades: ${report.trades.length}
• Winning Trades: ${report.metrics.winningTrades}
• Losing Trades: ${report.metrics.losingTrades}
• Win Rate: ${report.trades.length > 0 ? ((report.metrics.winningTrades / report.trades.length) * 100).toFixed(1) : 0}%
• Average Win: $${report.metrics.averageWinAmount?.toFixed(2) || '0.00'}
• Average Loss: $${report.metrics.averageLossAmount ? Math.abs(report.metrics.averageLossAmount).toFixed(2) : '0.00'}

**Risk Metrics:**
• Total Return: ${(report.metrics.totalPnlPercentage * 100).toFixed(2)}%
• Volatility: ${report.metrics.sharpeRatio ? 'Calculated via Sharpe' : 'N/A'}
• Sharpe Ratio: ${report.metrics.sharpeRatio?.toFixed(2) || 'N/A'}
• Max Drawdown: ${(report.metrics.maxDrawdown * 100).toFixed(2)}%

${
  report.trades.length === 0
    ? '⚠️ No trades were executed during this period. Consider adjusting strategy parameters.'
    : '✅ Simulation completed successfully!'
}`;

      if (callback) {
        await callback({
          text: response,
        });
      }
    } catch (error) {
      console.error('[RunBacktestAction] Error:', error);
      if (callback) {
        await callback({
          text: 'I encountered an error while running the backtest. Please check your parameters and try again.',
        });
      }
    }
  },
  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Can you run a backtest for SOL/USDC using the random strategy with $10,000 starting capital for the last 30 days?',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: "I'll run a backtest for SOL/USDC using the random strategy with $10,000 initial capital over the last 30 days. Let me analyze the performance...",
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: { text: 'Test the rule-based strategy on ETH with $5000 for 60 days' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Running a 60-day backtest for ETH using the rule-based strategy with $5,000 initial capital...',
        },
      },
    ],
  ],
};
