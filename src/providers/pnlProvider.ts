import type { Provider, IAgentRuntime, Memory, State } from '@elizaos/core';
import { AutoTradingService } from '../services/AutoTradingService.ts';
import { AnalyticsService } from '../services/analyticsService.ts';

export const pnlProvider: Provider = {
  name: 'PNL_STATUS',

  get: async (runtime: IAgentRuntime, _message: Memory, _state: State) => {
    try {
      const autoTradingService = runtime.getService('AutoTradingService') as AutoTradingService;
      const analyticsService = runtime.getService('AnalyticsService') as AnalyticsService;

      if (!autoTradingService || !analyticsService) {
        return { text: 'Trading services not available' };
      }

      const dailyPnL = autoTradingService.getDailyPnL();
      const totalPnL = autoTradingService.getTotalPnL();
      const positions = autoTradingService.getPositions();
      const winRate = analyticsService.getWinRate();

      // Calculate unrealized P&L
      let unrealizedPnL = 0;
      positions.forEach((pos) => {
        if (pos.currentPrice && pos.currentPrice > 0) {
          const pnl = (pos.currentPrice - pos.entryPrice) * pos.amount;
          unrealizedPnL += pnl;
        }
      });

      // Format performance summary
      const response = `💰 **P&L Summary**

📊 **Today's Performance:**
• Realized P&L: ${dailyPnL >= 0 ? '+' : ''}$${dailyPnL.toFixed(2)} ${dailyPnL >= 0 ? '📈' : '📉'}
• Unrealized P&L: ${unrealizedPnL >= 0 ? '+' : ''}$${unrealizedPnL.toFixed(2)}
• Total Today: ${dailyPnL + unrealizedPnL >= 0 ? '+' : ''}$${(dailyPnL + unrealizedPnL).toFixed(2)}

📈 **All-Time Performance:**
• Total P&L: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}
• Win Rate: ${winRate.toFixed(1)}%
• Open Positions: ${positions.length}

${dailyPnL > 100 ? '🎉 Great trading day!' : dailyPnL > 0 ? '✅ Profitable day so far!' : dailyPnL < -100 ? '⚠️ Consider reviewing your strategy' : '📊 Breaking even today'}`;

      return { text: response };
    } catch (error) {
      console.error('Error in pnlProvider:', error);
      return { text: 'Unable to fetch P&L information' };
    }
  },
};
