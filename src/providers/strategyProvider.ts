import type { IAgentRuntime, Memory, Provider, State } from '@elizaos/core';
import { StrategyRegistryService } from '../services/StrategyRegistryService.ts';

export const strategyProvider: Provider = {
  name: 'STRATEGY',
  get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      // Get strategy registry service
      const strategyRegistry = runtime.getService(
        'StrategyRegistryService'
      ) as StrategyRegistryService;

      if (!strategyRegistry) {
        return { text: 'Strategy information is currently unavailable.' };
      }

      // Get available strategies
      const availableStrategies = strategyRegistry.listStrategies();

      // Format strategy information
      let strategyText = `🎯 **Available Trading Strategies**\n\n`;

      // List each strategy with details
      for (const strategy of availableStrategies) {
        if (!strategy) continue;

        strategyText += `**${strategy.name}** (${strategy.id}):\n`;

        // Add strategy descriptions and capabilities
        switch (strategy.id) {
          case 'random-v1':
            strategyText += `• Type: Probabilistic trading\n`;
            strategyText += `• Best for: Baseline testing and market exploration\n`;
            strategyText += `• Configurable: Trade probability, position sizing\n`;
            strategyText += `• Risk Level: Variable (depends on probability settings)\n`;
            strategyText += `• Use case: Testing market conditions, baseline comparison\n`;
            break;

          case 'rule-based-v1':
            strategyText += `• Type: Technical analysis\n`;
            strategyText += `• Best for: Systematic trading based on indicators\n`;
            strategyText += `• Configurable: RSI thresholds, Moving averages, Stop-loss/Take-profit\n`;
            strategyText += `• Risk Level: Moderate (systematic risk management)\n`;
            strategyText += `• Use case: Trend following, momentum trading\n`;
            break;

          case 'llm-v1':
            strategyText += `• Type: AI-driven analysis\n`;
            strategyText += `• Best for: Complex market analysis and adaptive trading\n`;
            strategyText += `• Configurable: System prompts, risk tolerance, analysis depth\n`;
            strategyText += `• Risk Level: Variable (depends on AI analysis)\n`;
            strategyText += `• Use case: Market sentiment analysis, adaptive strategies\n`;
            break;

          default:
            strategyText += `• Type: Custom strategy\n`;
            strategyText += `• Configuration varies by implementation\n`;
        }

        strategyText += `\n`;
      }

      // Add configuration guidance
      strategyText += `⚙️ **Configuration Options:**\n\n`;
      strategyText += `**Common Parameters:**\n`;
      strategyText += `• Initial Capital: Starting portfolio value\n`;
      strategyText += `• Time Period: Backtest duration (days/weeks/months)\n`;
      strategyText += `• Position Size: Percentage of portfolio per trade\n`;
      strategyText += `• Stop Loss: Maximum acceptable loss per trade\n`;
      strategyText += `• Take Profit: Target profit level\n\n`;

      strategyText += `**Strategy-Specific:**\n`;
      strategyText += `• Random: Trade probability (5-50%)\n`;
      strategyText += `• Rule-Based: RSI levels (20-80), Moving average periods\n`;
      strategyText += `• LLM: Risk tolerance, market analysis depth\n\n`;

      // Add performance expectations
      strategyText += `📊 **Performance Expectations:**\n\n`;
      strategyText += `**Random Strategy:**\n`;
      strategyText += `• Expected return: ~Market average (with high variance)\n`;
      strategyText += `• Win rate: ~50% (random)\n`;
      strategyText += `• Best for: Baseline comparison\n\n`;

      strategyText += `**Rule-Based Strategy:**\n`;
      strategyText += `• Expected return: Depends on market conditions\n`;
      strategyText += `• Win rate: 45-65% (systematic)\n`;
      strategyText += `• Best for: Trending markets\n\n`;

      strategyText += `**LLM Strategy:**\n`;
      strategyText += `• Expected return: Adaptive to market conditions\n`;
      strategyText += `• Win rate: 50-70% (context-aware)\n`;
      strategyText += `• Best for: Complex market analysis\n\n`;

      // Usage recommendations
      strategyText += `💡 **Usage Recommendations:**\n\n`;
      strategyText += `**For Beginners:**\n`;
      strategyText += `• Start with Random strategy to understand backtesting\n`;
      strategyText += `• Move to Rule-Based for systematic trading\n`;
      strategyText += `• Use conservative position sizing (10-20%)\n\n`;

      strategyText += `**For Advanced Users:**\n`;
      strategyText += `• Combine multiple strategies for diversification\n`;
      strategyText += `• Use LLM strategy for market analysis\n`;
      strategyText += `• Experiment with different time periods\n\n`;

      strategyText += `**Risk Management:**\n`;
      strategyText += `• Always use stop-loss orders\n`;
      strategyText += `• Limit position sizes to manage risk\n`;
      strategyText += `• Backtest thoroughly before live trading\n`;
      strategyText += `• Monitor performance regularly\n\n`;

      strategyText += `🔧 **Quick Start Commands:**\n`;
      strategyText += `• "Run backtest with random strategy"\n`;
      strategyText += `• "Compare all strategies on SOL"\n`;
      strategyText += `• "Configure rule-based strategy with 5% stop-loss"\n`;
      strategyText += `• "Analyze ETH market with LLM strategy"`;

      return { text: strategyText };
    } catch (error) {
      console.error('[StrategyProvider] Error:', error);
      return { text: 'Unable to retrieve strategy information at this time.' };
    }
  },
};
