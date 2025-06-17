import { AgentRuntime, Service, Plugin } from '@elizaos/core';
import { StrategyRegistryService } from './services/StrategyRegistryService.ts';
import { DefaultHistoricalDataService } from './services/HistoricalDataService.ts';
import { SimulationService } from './services/SimulationService.ts';
import { PerformanceReportingService } from './services/PerformanceReportingService.ts';
import { TokenResolverService } from './services/TokenResolverService.ts';
import { AnalyticsService } from './services/analyticsService.ts';
import { AutoTradingService } from './services/AutoTradingService.ts';
import { WalletIntegrationService } from './services/WalletIntegrationService.ts';
import { JupiterSwapService } from './services/JupiterSwapService.ts';
import { RealtimePriceFeedService } from './services/RealtimePriceFeedService.ts';
import { RiskManagementService } from './services/RiskManagementService.ts';
import { TransactionMonitoringService } from './services/TransactionMonitoringService.ts';

// Import conversational interface components
import { runBacktestAction } from './actions/runBacktestAction.ts';
import { analyzePerformanceAction } from './actions/analyzePerformanceAction.ts';
import { checkPortfolioAction } from './actions/checkPortfolioAction.ts';
import { configureStrategyAction } from './actions/configureStrategyAction.ts';
import { compareStrategiesAction } from './actions/compareStrategiesAction.ts';
import { getMarketAnalysisAction } from './actions/getMarketAnalysisAction.ts';
import { executeLiveTradeAction } from './actions/executeLiveTradeAction.ts';
import { startTradingAction } from './actions/startTradingAction.ts';
import { stopTradingAction } from './actions/stopTradingAction.ts';

import { marketDataProvider } from './providers/marketDataProvider.ts';
import { performanceProvider } from './providers/performanceProvider.ts';
import { portfolioProvider } from './providers/portfolioProvider.ts';
import { strategyProvider } from './providers/strategyProvider.ts';
import { tradingStatusProvider } from './providers/tradingStatusProvider.ts';
import { pnlProvider } from './providers/pnlProvider.ts';

// Import E2E test suites
import testSuites from './__tests__/e2e/index.ts';

// Strategies are now imported and registered within StrategyRegistryService.start()

export const PLUGIN_NAME = 'auto-trader';

// Array to hold service classes for registration with ElizaOS
const autoTraderServiceClasses: (typeof Service)[] = [
  StrategyRegistryService as typeof Service,
  DefaultHistoricalDataService as typeof Service,
  PerformanceReportingService as typeof Service,
  AnalyticsService as typeof Service,
  SimulationService as typeof Service,
  TokenResolverService as typeof Service,
  AutoTradingService as typeof Service,
  WalletIntegrationService as typeof Service,
  JupiterSwapService as typeof Service,
  RealtimePriceFeedService as typeof Service,
  RiskManagementService as typeof Service,
  TransactionMonitoringService as typeof Service,
];

const actions = [
  runBacktestAction,
  analyzePerformanceAction,
  checkPortfolioAction,
  configureStrategyAction,
  compareStrategiesAction,
  getMarketAnalysisAction,
  startTradingAction,
  stopTradingAction,
];

// Only add executeLiveTradeAction if wallet services are available
if (process.env.WALLET_SERVICE_ENABLED !== 'false') {
  actions.push(executeLiveTradeAction);
}

const providers = [
  marketDataProvider,
  performanceProvider,
  portfolioProvider,
  strategyProvider,
  tradingStatusProvider,
  pnlProvider,
];

export const autoTraderPlugin: Plugin = {
  name: PLUGIN_NAME,
  description: 'An automated trading plugin for ElizaOS',
  services: autoTraderServiceClasses,
  actions,
  providers,
  dependencies: ['@elizaos/plugin-solana', '@elizaos/plugin-jupiter'],
  testDependencies: ['@elizaos/plugin-solana', '@elizaos/plugin-jupiter'],
  tests: testSuites,
};

export * from './types/index.ts';
export * from './types/trading.ts';
export { autoTraderPlugin as default };
