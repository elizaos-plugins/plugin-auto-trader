import type { Action, IAgentRuntime, Memory, HandlerCallback, State } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';
import { AutoTradingService } from '../services/AutoTradingService.ts';

export const stopTradingAction: Action = {
  name: 'STOP_TRADING',
  description: 'Stop automated trading',

  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Stop trading',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Stopping automated trading. All positions remain open. You can check your portfolio status anytime.',
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Pause auto-trader',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: "Auto-trading has been paused. Your open positions will not be affected. You can restart trading whenever you're ready.",
        },
      },
    ],
  ],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = (message.content.text || '').toLowerCase();
    return text.includes('stop') || text.includes('pause') || text.includes('halt');
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<boolean> => {
    try {
      const autoTradingService = runtime.getService('AutoTradingService') as AutoTradingService;
      if (!autoTradingService) {
        throw new Error('AutoTradingService not found');
      }

      const wasTrading = autoTradingService.getIsTrading();
      await autoTradingService.stopTrading();

      let response = '';
      if (wasTrading) {
        const positions = autoTradingService.getPositions();
        const dailyPnL = autoTradingService.getDailyPnL();

        response = `🛑 Auto-trading stopped.

📊 Current Status:
• Open positions: ${positions.length}
• Today's P&L: ${dailyPnL >= 0 ? '+' : ''}$${dailyPnL.toFixed(2)}

Your open positions will remain active. You can:
- Check portfolio status anytime
- Restart trading when ready
- Manually manage positions if needed`;
      } else {
        response = 'Auto-trading is not currently active.';
      }

      if (callback) {
        callback({
          text: response,
          action: 'STOP_TRADING',
        });
      }

      return true;
    } catch (error) {
      elizaLogger.error('Error stopping trading:', error);

      if (callback) {
        callback({
          text: `Failed to stop trading: ${error instanceof Error ? error.message : 'Unknown error'}`,
          action: 'STOP_TRADING',
        });
      }

      return false;
    }
  },
};
