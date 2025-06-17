import type { Provider, IAgentRuntime, Memory, State } from '@elizaos/core';
import { AutoTradingService } from '../services/AutoTradingService.ts';
import { VERIFIED_MEME_COINS } from '../config/memeCoins.ts';

export const tradingStatusProvider: Provider = {
  name: 'TRADING_STATUS',

  get: async (runtime: IAgentRuntime, _message: Memory, _state: State) => {
    try {
      const autoTradingService = runtime.getService('AutoTradingService') as AutoTradingService;
      if (!autoTradingService) {
        return { text: 'Trading services not available' };
      }

      const isTrading = autoTradingService.getIsTrading();
      const strategy = autoTradingService.getCurrentStrategy();
      const positions = autoTradingService.getPositions();
      const dailyPnL = autoTradingService.getDailyPnL();
      const totalPnL = autoTradingService.getTotalPnL();

      if (!isTrading) {
        return {
          text: `🔴 Auto-Trading: STOPPED
        
No active trading session. Use "start trading" to begin.`,
        };
      }

      // Format position details
      const positionDetails = positions
        .map((pos) => {
          const token = VERIFIED_MEME_COINS.find((t) => t.address === pos.tokenAddress);
          const symbol = token?.symbol || pos.tokenAddress.slice(0, 8) + '...';
          const pnl = pos.unrealizedPnl || 0;
          const pnlPercent = ((pnl / (pos.amount * pos.entryPrice)) * 100).toFixed(2);

          return `• ${symbol}: ${pos.amount.toFixed(4)} @ $${pos.entryPrice.toFixed(6)} (${pnlPercent}%)`;
        })
        .join('\n');

      return {
        text: `🟢 Auto-Trading: ACTIVE

📊 Current Status:
• Strategy: ${strategy?.name || 'Unknown'}
• Positions: ${positions.length}
• Today's P&L: ${dailyPnL >= 0 ? '+' : ''}$${dailyPnL.toFixed(2)}
• Total P&L: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}

${positions.length > 0 ? `📈 Open Positions:\n${positionDetails}` : '📉 No open positions'}`,
      };
    } catch (error) {
      console.error('Error in tradingStatusProvider:', error);
      return { text: 'Unable to fetch trading status' };
    }
  },
};
