import type { IAgentRuntime, Memory, Action, HandlerCallback } from '@elizaos/core';
import { StrategyRegistryService } from '../services/StrategyRegistryService.ts';
import { SimulationService, type SimulationParams } from '../services/SimulationService.ts';

export const configureStrategyAction: Action = {
  name: 'CONFIGURE_STRATEGY',
  similes: [
    'CONFIG_STRATEGY',
    'SET_STRATEGY',
    'UPDATE_STRATEGY',
    'CHANGE_STRATEGY',
    'ADJUST_STRATEGY',
    'STRATEGY_SETTINGS',
    'STRATEGY_PARAMS',
  ],
  description: 'Configure a trading strategy with custom parameters',
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text?.toLowerCase() || '';

    // Check for configuration keywords
    const configKeywords = [
      'configure',
      'config',
      'set',
      'update',
      'change',
      'adjust',
      'parameter',
      'setting',
      'strategy',
    ];

    return configKeywords.some((keyword) => text.includes(keyword));
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
      const strategyRegistry = runtime.getService(
        'StrategyRegistryService'
      ) as StrategyRegistryService;
      const simulationService = runtime.getService('SimulationService') as SimulationService;

      if (!strategyRegistry) {
        if (callback) {
          await callback({
            text: "The strategy configuration service isn't available right now. Please try again later.",
          });
        }
        return;
      }

      // Extract strategy name and parameters from message
      const text = message.content.text || '';

      // Try to identify strategy
      let strategyId = 'random-v1'; // default
      if (text.match(/random/i)) strategyId = 'random-v1';
      else if (text.match(/rule/i)) strategyId = 'rule-based-v1';
      else if (text.match(/llm|ai/i)) strategyId = 'llm-v1';
      else if (text.match(/momentum/i)) strategyId = 'momentum-v1';
      else if (text.match(/mean.*reversion/i)) strategyId = 'mean-reversion-v1';

      const strategy = strategyRegistry.getStrategy(strategyId);
      if (!strategy) {
        if (callback) {
          await callback({
            text: `Strategy "${strategyId}" not found. Available strategies: random-v1, rule-based-v1, llm-v1, momentum-v1, mean-reversion-v1`,
          });
        }
        return;
      }

      // Parse parameters based on strategy type
      const newParams: any = {};
      const parameterChanges: string[] = [];

      // Common parameters
      const probabilityMatch = text.match(/(\d+)%?\s*(?:probability|chance)/i);
      if (probabilityMatch) {
        const prob = parseInt(probabilityMatch[1]) / 100;
        newParams.tradeAttemptProbability = prob;
        parameterChanges.push(`Trade probability set to ${(prob * 100).toFixed(0)}%`);
      }

      // Strategy-specific parameters
      switch (strategyId) {
        case 'random-v1':
          const buyProbMatch = text.match(/buy.*?(\d+)%/i);
          if (buyProbMatch) {
            newParams.buyProbability = parseInt(buyProbMatch[1]) / 100;
            parameterChanges.push(`Buy probability set to ${buyProbMatch[1]}%`);
          }

          const sizeMatch = text.match(/(\d+)%?\s*(?:size|position)/i);
          if (sizeMatch) {
            newParams.maxTradeSizePercentage = parseInt(sizeMatch[1]) / 100;
            parameterChanges.push(`Max trade size set to ${sizeMatch[1]}%`);
          }
          break;

        case 'rule-based-v1':
          const volumeMatch = text.match(/volume.*?(\d+(?:\.\d+)?)\s*(?:k|m|million)?/i);
          if (volumeMatch) {
            let volume = parseFloat(volumeMatch[1]);
            if (text.match(/k/i)) volume *= 1000;
            if (text.match(/m|million/i)) volume *= 1000000;

            newParams.rules = [
              {
                type: 'VOLUME',
                minVolume24h: volume,
                action: 'BUY',
              },
            ];
            parameterChanges.push(`Minimum volume threshold set to $${volume.toLocaleString()}`);
          }

          const stopLossMatch = text.match(/stop.*?loss.*?(\d+)%?/i);
          if (stopLossMatch) {
            newParams.riskSettings = {
              stopLossPercentage: parseInt(stopLossMatch[1]) / 100,
            };
            parameterChanges.push(`Stop loss set to ${stopLossMatch[1]}%`);
          }
          break;

        case 'llm-v1':
          if (text.includes('aggressive')) {
            newParams.systemPrompt =
              'You are an aggressive trading AI focused on maximizing gains.';
            parameterChanges.push('Set to aggressive trading mode');
          } else if (text.includes('conservative')) {
            newParams.systemPrompt =
              'You are a conservative trading AI focused on capital preservation.';
            parameterChanges.push('Set to conservative trading mode');
          } else if (text.includes('balanced')) {
            newParams.systemPrompt =
              'You are a balanced trading AI seeking optimal risk-adjusted returns.';
            parameterChanges.push('Set to balanced trading mode');
          }
          break;

        case 'momentum-v1':
          const momentumMatch = text.match(/momentum.*?(\d+)/i);
          if (momentumMatch) {
            newParams.momentumThreshold = parseInt(momentumMatch[1]) / 100;
            parameterChanges.push(`Momentum threshold set to ${momentumMatch[1]}%`);
          }
          break;

        case 'mean-reversion-v1':
          const deviationMatch = text.match(/deviation.*?(\d+(?:\.\d+)?)/i);
          if (deviationMatch) {
            newParams.standardDeviations = parseFloat(deviationMatch[1]);
            parameterChanges.push(
              `Bollinger Band deviation set to ${deviationMatch[1]} standard deviations`
            );
          }
          break;
      }

      if (Object.keys(newParams).length === 0) {
        if (callback) {
          await callback({
            text: `I couldn't identify any specific parameters to update. 

Examples of valid configuration commands:
• "Set random strategy to 20% trade probability"
• "Configure rule-based with 1M minimum volume"
• "Change LLM strategy to aggressive mode"
• "Set stop loss to 5%"

Current strategy: ${strategy.name}`,
          });
        }
        return;
      }

      // Configure the strategy
      if (strategy.configure) {
        strategy.configure(newParams);
      }

      let responseText = `✅ **Strategy Configuration Updated**

**Strategy:** ${strategy.name}
**Changes Made:**
${parameterChanges.map((change) => `• ${change}`).join('\n')}`;

      // Run a quick backtest to show the impact
      if (simulationService) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30); // 30 days

        const simParams: SimulationParams = {
          strategyName: strategyId,
          pair: 'SOL/USDC',
          interval: '1h',
          startDate,
          endDate,
          initialCapital: 10000,
          dataSource: 'mockSource',
        };

        const report = await simulationService.runBacktest(simParams);
        const returnPercent = (((report.finalPortfolioValue - 10000) / 10000) * 100).toFixed(2);

        responseText += `

📊 **Quick Backtest Results** (30 days on SOL/USDC):
• Initial Capital: $10,000
• Final Capital: $${report.finalPortfolioValue.toFixed(2)}
• Return: ${returnPercent}%
• Total Trades: ${report.trades.length}
• Max Drawdown: ${(report.metrics.maxDrawdown * 100).toFixed(2)}%`;
      }

      responseText += `

Would you like to run a longer backtest or adjust any other parameters?`;

      if (callback) {
        await callback({
          text: responseText,
        });
      }
    } catch (error) {
      console.error('[ConfigureStrategyAction] Error:', error);
      if (callback) {
        await callback({
          text: 'An error occurred while configuring the strategy. Please try again.',
        });
      }
    }
  },
  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Configure the random strategy with 20% trade probability and 5% position size',
        },
      },
      {
        name: '{{agentName}}',
        content: { text: "I'll update the random strategy with your specified parameters..." },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: { text: 'Set the LLM strategy to conservative mode' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: "I'll configure the LLM strategy to use conservative trading parameters...",
        },
      },
    ],
  ],
};
