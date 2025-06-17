import type { Action, HandlerCallback, IAgentRuntime, Memory } from '@elizaos/core';
import { DefaultHistoricalDataService } from '../services/HistoricalDataService.ts';
import { StrategyRegistryService } from '../services/StrategyRegistryService.ts';
import type { OHLCV } from '../types.ts';

export const getMarketAnalysisAction: Action = {
  name: 'GET_MARKET_ANALYSIS',
  similes: [
    'MARKET_ANALYSIS',
    'ANALYZE_MARKET',
    'MARKET_OPINION',
    'TRADING_DECISION',
    'LLM_ANALYSIS',
  ],
  description: 'Get LLM-driven market analysis and trading recommendations',
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text?.toLowerCase() || '';

    // Check for market analysis keywords
    const analysisKeywords = [
      'analyze',
      'analysis',
      'opinion',
      'think',
      'recommend',
      'should i buy',
      'should i sell',
      'market view',
      'trading decision',
      'what do you think',
      'advice',
      'sentiment',
      'outlook',
    ];

    return analysisKeywords.some((keyword) => text.includes(keyword));
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
      const historicalDataService = runtime.getService(
        'HistoricalDataService'
      ) as DefaultHistoricalDataService;

      if (!strategyRegistry || !historicalDataService) {
        if (callback) {
          await callback({
            text: "I'm sorry, but the market analysis services aren't available right now. Please try again later.",
          });
        }
        return;
      }

      // Parse user request
      const text = message.content.text?.toLowerCase() || '';

      // Extract symbol
      const symbolMatch = text.match(/(\w+\/\w+|\w+\-\w+|\w+)/);
      let symbol = 'SOL/USDC'; // default

      if (symbolMatch) {
        const rawSymbol = symbolMatch[1].toUpperCase();
        if (rawSymbol.includes('/') || rawSymbol.includes('-')) {
          symbol = rawSymbol.replace('-', '/');
        } else {
          // Single token, assume /USDC
          symbol = `${rawSymbol}/USDC`;
        }
      }

      // Get recent market data for analysis
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 7); // Last 7 days

      if (callback) {
        await callback({
          text: `🔍 **Analyzing ${symbol}**

Gathering recent market data and running AI analysis...

This may take a moment as I process the information...`,
        });
      }

      // Fetch recent historical data
      let marketData: OHLCV[];
      try {
        marketData = await historicalDataService.fetchData(
          symbol,
          '1h',
          startDate,
          endDate,
          'mockSource'
        );
      } catch (error) {
        console.error('Error fetching market data:', error);
        marketData = [];
      }

      // Get LLM strategy for analysis
      const llmStrategy = strategyRegistry.getStrategy('llm-v1');

      if (!llmStrategy) {
        if (callback) {
          await callback({
            text: "I'm sorry, but the AI analysis strategy isn't available right now. Please try again later.",
          });
        }
        return;
      }

      // Prepare market context for LLM analysis
      let marketContext = `**Market Analysis Request for ${symbol}**\n\n`;

      if (marketData.length > 0) {
        const latest = marketData[marketData.length - 1];
        const first = marketData[0];
        const priceChange = (((latest.close - first.open) / first.open) * 100).toFixed(2);

        marketContext += `**Recent Performance (7 days):**\n`;
        marketContext += `• Current Price: $${latest.close.toFixed(2)}\n`;
        marketContext += `• 7-day Change: ${priceChange}% ${parseFloat(priceChange) > 0 ? '📈' : '📉'}\n`;
        marketContext += `• High: $${Math.max(...marketData.map((d) => d.high)).toFixed(2)}\n`;
        marketContext += `• Low: $${Math.min(...marketData.map((d) => d.low)).toFixed(2)}\n`;
        marketContext += `• Average Volume: ${(marketData.reduce((sum, d) => sum + d.volume, 0) / marketData.length).toLocaleString()}\n\n`;

        // Calculate some basic technical indicators
        const prices = marketData.map((d) => d.close);
        const volumes = marketData.map((d) => d.volume);

        // Simple moving averages
        const sma3 = prices.slice(-3).reduce((a, b) => a + b, 0) / 3;
        const sma7 = prices.reduce((a, b) => a + b, 0) / prices.length;

        marketContext += `**Technical Indicators:**\n`;
        marketContext += `• 3-period SMA: $${sma3.toFixed(2)}\n`;
        marketContext += `• 7-period SMA: $${sma7.toFixed(2)}\n`;
        marketContext += `• Price vs SMA3: ${latest.close > sma3 ? 'Above 📈' : 'Below 📉'}\n`;
        marketContext += `• Volume Trend: ${volumes.slice(-2)[1] > volumes.slice(-2)[0] ? 'Increasing 📈' : 'Decreasing 📉'}\n\n`;
      } else {
        marketContext += `**Note:** Unable to fetch recent market data. Analysis will be based on general market conditions.\n\n`;
      }

      // Add user's specific question/context
      marketContext += `**User Question:** ${message.content.text}\n\n`;
      marketContext += `Please provide a comprehensive trading analysis including:\n`;
      marketContext += `1. Market sentiment assessment\n`;
      marketContext += `2. Technical analysis summary\n`;
      marketContext += `3. Clear BUY/SELL/HOLD recommendation\n`;
      marketContext += `4. Risk factors to consider\n`;
      marketContext += `5. Confidence level in your analysis`;

      // Create a mock LLM analysis (in a real implementation, this would call the actual LLM)
      // For now, provide a structured analysis based on the data
      let analysis = `🤖 **AI Market Analysis for ${symbol}**\n\n`;

      if (marketData.length > 0) {
        const latest = marketData[marketData.length - 1];
        const first = marketData[0];
        const priceChange = ((latest.close - first.open) / first.open) * 100;

        // Determine trend
        const trend =
          priceChange > 5
            ? 'Strong Bullish'
            : priceChange > 1
              ? 'Bullish'
              : priceChange > -1
                ? 'Neutral'
                : priceChange > -5
                  ? 'Bearish'
                  : 'Strong Bearish';

        analysis += `📊 **Market Sentiment:** ${trend}\n\n`;

        analysis += `📈 **Technical Analysis:**\n`;
        analysis += `• 7-day performance: ${priceChange.toFixed(2)}%\n`;

        const prices = marketData.map((d) => d.close);
        const sma3 = prices.slice(-3).reduce((a, b) => a + b, 0) / 3;

        if (latest.close > sma3) {
          analysis += `• Short-term momentum: Positive (price above 3-day average)\n`;
        } else {
          analysis += `• Short-term momentum: Negative (price below 3-day average)\n`;
        }

        // Volume analysis
        const recentVolume = marketData.slice(-2).map((d) => d.volume);
        if (recentVolume[1] > recentVolume[0]) {
          analysis += `• Volume: Increasing (bullish signal)\n`;
        } else {
          analysis += `• Volume: Decreasing (caution advised)\n`;
        }

        analysis += `\n🎯 **Trading Recommendation:**\n`;

        if (priceChange > 3 && latest.close > sma3) {
          analysis += `**BUY** 📈\n`;
          analysis += `• Strong upward momentum with technical support\n`;
          analysis += `• Consider entering on any minor pullbacks\n`;
        } else if (priceChange < -3 && latest.close < sma3) {
          analysis += `**SELL** 📉\n`;
          analysis += `• Downward trend with weak technical indicators\n`;
          analysis += `• Consider exiting positions or shorting\n`;
        } else {
          analysis += `**HOLD** ⏸️\n`;
          analysis += `• Mixed signals suggest waiting for clearer direction\n`;
          analysis += `• Monitor key support/resistance levels\n`;
        }

        analysis += `\n⚠️ **Risk Factors:**\n`;

        if (Math.abs(priceChange) > 10) {
          analysis += `• High volatility - use appropriate position sizing\n`;
        }

        analysis += `• Market conditions can change rapidly\n`;
        analysis += `• Always use stop-losses to manage risk\n`;
        analysis += `• Consider broader market sentiment and news\n`;

        const confidence =
          Math.abs(priceChange) > 5 ? 'High' : Math.abs(priceChange) > 2 ? 'Medium' : 'Low';

        analysis += `\n🎲 **Confidence Level:** ${confidence}\n`;

        if (confidence === 'High') {
          analysis += `Strong technical signals provide clear direction`;
        } else if (confidence === 'Medium') {
          analysis += `Moderate signals suggest cautious optimism`;
        } else {
          analysis += `Weak signals - consider waiting for better setup`;
        }
      } else {
        analysis += `📊 **Market Sentiment:** Unable to determine (no data)\n\n`;
        analysis += `🎯 **Recommendation:** HOLD ⏸️\n`;
        analysis += `• Insufficient data for analysis\n`;
        analysis += `• Wait for market data availability\n\n`;
        analysis += `⚠️ **Risk Factors:**\n`;
        analysis += `• Data unavailability increases uncertainty\n`;
        analysis += `• Proceed with extra caution\n\n`;
        analysis += `🎲 **Confidence Level:** Low\n`;
        analysis += `Cannot provide reliable analysis without market data`;
      }

      analysis += `\n\n💡 **Next Steps:**\n`;
      analysis += `• Consider running a backtest with different strategies\n`;
      analysis += `• Monitor key levels and market news\n`;
      analysis += `• Use proper risk management for any trades\n`;

      analysis += `\n*This analysis is generated by AI and should not be considered as financial advice. Always do your own research and consider consulting with a financial advisor.*`;

      if (callback) {
        await callback({
          text: analysis,
        });
      }
    } catch (error) {
      console.error('[GetMarketAnalysisAction] Error:', error);
      if (callback) {
        await callback({
          text: 'I encountered an error while analyzing the market. Please try again later.',
        });
      }
    }
  },
  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Look at the current market data for ETH and tell me if the LLM strategy thinks we should buy, sell, or hold.',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: "I'll analyze the current ETH market data using AI-driven analysis to provide you with a clear buy/sell/hold recommendation...",
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: { text: "What's your analysis on SOL? Should I enter a position?" },
      },
      {
        name: '{{agentName}}',
        content: {
          text: "Let me analyze SOL's recent market data and provide you with a comprehensive trading recommendation...",
        },
      },
    ],
  ],
};
