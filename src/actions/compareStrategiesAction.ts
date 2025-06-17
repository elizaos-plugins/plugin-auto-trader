import type { IAgentRuntime, Memory, Action, HandlerCallback } from '@elizaos/core';
import { SimulationService, type SimulationParams } from '../services/SimulationService.ts';
import { StrategyRegistryService } from '../services/StrategyRegistryService.ts';

export const compareStrategiesAction: Action = {
  name: 'COMPARE_STRATEGIES',
  similes: ['STRATEGY_COMPARISON', 'COMPARE_PERFORMANCE', 'STRATEGY_ANALYSIS'],
  description: 'Compare the performance of multiple trading strategies',
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text?.toLowerCase() || '';
    const compareKeywords = [
      'compare',
      'strategies',
      'performance',
      'which strategy',
      'best strategy',
    ];
    return compareKeywords.some((keyword) => text.includes(keyword));
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
            text: 'Strategy comparison services are not available. Please try again later.',
          });
        }
        return;
      }

      // Define strategies to compare
      const strategiesToCompare = [
        {
          id: 'random-v1',
          name: 'Random Strategy',
          params: { tradeAttemptProbability: 0.1 },
        },
        {
          id: 'rule-based-v1',
          name: 'Rule-Based Strategy',
          params: {
            rules: [{ type: 'volume', minVolume24h: 1000000, action: 'BUY' }],
          },
        },
        {
          id: 'llm-v1',
          name: 'LLM Strategy',
          params: { systemPrompt: 'You are a conservative trading bot.' },
        },
      ];

      // Simulation parameters
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30); // 30 days backtest

      const symbol = 'SOL';
      const initialCapital = 10000;

      const results: any[] = [];
      let bestStrategy: any = null;
      let bestReturn = -Infinity;

      // Run simulations for each strategy
      for (const strategy of strategiesToCompare) {
        try {
          const simParams: SimulationParams = {
            strategyName: strategy.id, // Use strategy.id as strategyName
            pair: `${symbol}/USDC`, // Convert symbol to pair format
            interval: '1h', // Convert timeframe to interval
            startDate,
            endDate,
            initialCapital,
            dataSource: 'mockSource',
          };

          const report = await simulationService.runBacktest(simParams);
          const returnPercent =
            ((report.finalPortfolioValue - initialCapital) / initialCapital) * 100;

          const result = {
            strategyName: strategy.name,
            strategyId: strategy.id,
            initialCapital: initialCapital,
            finalCapital: report.finalPortfolioValue,
            returnPercent: returnPercent.toFixed(2),
            totalTrades: report.trades.length,
            winningTrades: report.metrics.winningTrades,
            losingTrades: report.metrics.losingTrades,
            maxDrawdown: (report.metrics.maxDrawdown * 100).toFixed(2),
            sharpeRatio: report.metrics.sharpeRatio?.toFixed(2) || 'N/A',
          };

          results.push(result);

          if (returnPercent > bestReturn) {
            bestReturn = returnPercent;
            bestStrategy = result;
          }
        } catch (error) {
          console.error(`Error simulating ${strategy.name}:`, error);
          results.push({
            strategyName: strategy.name,
            strategyId: strategy.id,
            error: 'Simulation failed',
          });
        }
      }

      // Format comparison results
      let response = `📊 **Strategy Comparison Results**
*30-Day Backtest on ${symbol}/USDC*

`;

      results.forEach((result, index) => {
        if (result.error) {
          response += `**${index + 1}. ${result.strategyName}**
❌ ${result.error}

`;
        } else {
          response += `**${index + 1}. ${result.strategyName}** ${result === bestStrategy ? '🏆' : ''}
• Return: ${result.returnPercent}% ${result.returnPercent > 0 ? '📈' : '📉'}
• Total Trades: ${result.totalTrades}
• Win Rate: ${result.totalTrades > 0 ? ((result.winningTrades / result.totalTrades) * 100).toFixed(1) : 0}%
• Max Drawdown: ${result.maxDrawdown}%
• Sharpe Ratio: ${result.sharpeRatio}

`;
        }
      });

      if (bestStrategy) {
        response += `🎯 **Best Performing Strategy**: ${bestStrategy.strategyName}
• Generated ${bestStrategy.returnPercent}% returns
• ${bestStrategy.winningTrades} winning trades out of ${bestStrategy.totalTrades}

💡 **Recommendation**: Based on this backtest, ${bestStrategy.strategyName} showed the best performance. However, past performance doesn't guarantee future results. Consider market conditions and risk tolerance when choosing a strategy.`;
      }

      if (callback) {
        await callback({
          text: response,
        });
      }
    } catch (error) {
      console.error('[CompareStrategiesAction] Error:', error);
      if (callback) {
        await callback({
          text: 'An error occurred while comparing strategies. Please try again later.',
        });
      }
    }
  },
  examples: [
    [
      {
        name: '{{user1}}',
        content: { text: 'Compare the different trading strategies' },
      },
      {
        name: '{{agentName}}',
        content: { text: "I'll run a comparison of our available trading strategies..." },
      },
    ],
  ],
};
