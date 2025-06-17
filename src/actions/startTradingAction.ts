import type { Action, IAgentRuntime, Memory, HandlerCallback, State } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';
import { AutoTradingManager } from '../services/AutoTradingManager.ts';
import { VERIFIED_MEME_COINS } from '../config/memeCoins.ts';

export const startTradingAction: Action = {
  name: 'START_TRADING',
  description: 'Start automated trading with a specified strategy and configuration',

  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Start trading with momentum strategy on BONK with $1000',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Starting automated trading with momentum strategy on BONK. Maximum position size: $1000. Trading interval: 1 minute.',
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Begin auto-trading using mean reversion on top 3 meme coins',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Starting automated trading with mean reversion strategy on BONK, WIF, and POPCAT. Using default position size of $1000.',
        },
      },
    ],
  ],

  validate: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    // Always valid - we'll parse what we can from the message
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<boolean> => {
    try {
      const autoTradingManager = runtime.getService('AutoTradingManager') as AutoTradingManager;
      if (!autoTradingManager) {
        throw new Error('AutoTradingManager not found');
      }

      // Parse configuration from message
      const text = (message.content.text || '').toLowerCase();

      // Extract strategy
      let strategy = 'optimized-momentum-v1'; // default
      if (text.includes('momentum')) strategy = 'optimized-momentum-v1';
      else if (text.includes('mean reversion')) strategy = 'mean-reversion';
      else if (text.includes('breakout')) strategy = 'breakout';
      else if (text.includes('random')) strategy = 'random';

      // Extract tokens
      let tokens: string[] = [];
      if (text.includes('bonk')) tokens.push('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
      if (text.includes('wif')) tokens.push('EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm');
      if (text.includes('popcat')) tokens.push('7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr');

      // If "top X meme coins" pattern
      const topMatch = text.match(/top (\d+) meme coins/);
      if (topMatch) {
        const count = parseInt(topMatch[1]);
        tokens = VERIFIED_MEME_COINS.slice(0, count).map((t) => t.address);
      }

      // Default to BONK if no tokens specified
      if (tokens.length === 0) {
        tokens = [VERIFIED_MEME_COINS[0].address]; // BONK
      }

      // Extract position size
      let maxPositionSize = 1000; // default
      const amountMatch = text.match(/\$(\d+)/);
      if (amountMatch) {
        maxPositionSize = parseInt(amountMatch[1]);
      }

      // Extract stop loss and take profit
      let stopLossPercent = 5; // default
      let takeProfitPercent = 10; // default

      const slMatch = text.match(/stop\s*loss\s*(?:at\s*)?(\d+)%/);
      if (slMatch) {
        stopLossPercent = parseInt(slMatch[1]);
      }

      const tpMatch = text.match(/take\s*profit\s*(?:at\s*)?(\d+)%/);
      if (tpMatch) {
        takeProfitPercent = parseInt(tpMatch[1]);
      }

      // Start trading
      await autoTradingManager.startTrading({
        strategy,
        tokens,
        maxPositionSize,
        intervalMs: 60000, // 1 minute default
        stopLossPercent,
        takeProfitPercent,
        maxDailyLoss: maxPositionSize * 0.1, // 10% of position size
      });

      const tokenSymbols = tokens
        .map((addr) => {
          const token = VERIFIED_MEME_COINS.find((t) => t.address === addr);
          return token?.symbol || addr.slice(0, 8) + '...';
        })
        .join(', ');

      const response = `🚀 Auto-trading started!
Strategy: ${strategy}
Tokens: ${tokenSymbols}
Max position size: $${maxPositionSize}
Stop loss: ${stopLossPercent}%
Take profit: ${takeProfitPercent}%
Trading interval: 1 minute

I'll monitor the markets continuously and execute trades based on the ${strategy} strategy signals.`;

      if (callback) {
        callback({
          text: response,
          action: 'START_TRADING',
        });
      }

      return true;
    } catch (error) {
      elizaLogger.error('Error starting trading:', error);

      if (callback) {
        callback({
          text: `Failed to start trading: ${error instanceof Error ? error.message : 'Unknown error'}`,
          action: 'START_TRADING',
        });
      }

      return false;
    }
  },
};
