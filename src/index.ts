import type { Plugin } from '@elizaos/core';

// Import the new consolidated manager
import { AutoTradingManager } from './services/AutoTradingManager.ts';

// Import actions
import { startTradingAction } from './actions/startTradingAction.ts';
import { stopTradingAction } from './actions/stopTradingAction.ts';
import { checkPortfolioAction } from './actions/checkPortfolioAction.ts';
import { runBacktestAction } from './actions/runBacktestAction.ts';
import { compareStrategiesAction } from './actions/compareStrategiesAction.ts';
import { analyzePerformanceAction } from './actions/analyzePerformanceAction.ts';
import { getMarketAnalysisAction } from './actions/getMarketAnalysisAction.ts';
import { configureStrategyAction } from './actions/configureStrategyAction.ts';
import { executeLiveTradeAction } from './actions/executeLiveTradeAction.ts';

// Import consolidated providers
import { tradingProvider } from './providers/tradingProvider.ts';
import { marketDataProvider } from './providers/marketDataProvider.ts';
import { strategyProvider } from './providers/strategyProvider.ts';

// Import test scenarios
import { autoTradingScenarios } from './__tests__/e2e/autotrading-scenarios.ts';
import { liveTradingScenarios } from './__tests__/e2e/liveTrading-scenarios.ts';
import { mockTradingScenarios } from './__tests__/e2e/mock-trading-scenario.ts';

const autoTraderPlugin: Plugin = {
  name: 'auto-trader',
  description: 'Automated trading plugin with simplified architecture',
  services: [AutoTradingManager],
  actions: [
    startTradingAction,
    stopTradingAction,
    checkPortfolioAction,
    runBacktestAction,
    compareStrategiesAction,
    analyzePerformanceAction,
    getMarketAnalysisAction,
    configureStrategyAction,
    executeLiveTradeAction,
  ],
  providers: [tradingProvider, marketDataProvider, strategyProvider],
  tests: [
    autoTradingScenarios,
    liveTradingScenarios,
    mockTradingScenarios,
  ],
};

export default autoTraderPlugin;
