import { Service, AgentRuntime } from '@elizaos/core';
import { Trade, PortfolioSnapshot, PerformanceMetrics, SimulationReport } from '../types.ts';

function calculateStandardDeviation(values: number[]): number {
  const n = values.length;
  if (n < 2) {
    return 0;
  }
  const mean = values.reduce((a, b) => a + b) / n;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1);
  return Math.sqrt(variance);
}

export class PerformanceReportingService extends Service {
  public static readonly serviceType = 'PerformanceReportingService';
  public readonly capabilityDescription = 'Generates performance reports for trading simulations.';

  constructor(runtime: AgentRuntime) {
    super(runtime);
  }

  public static async start(runtime: AgentRuntime): Promise<PerformanceReportingService> {
    console.log(
      `[${PerformanceReportingService.serviceType}] static start called - creating instance.`
    );
    const instance = new PerformanceReportingService(runtime);
    await instance.start();
    return instance;
  }

  public async start(): Promise<void> {
    console.log(`[${PerformanceReportingService.serviceType}] instance start called.`);
  }

  public async stop(): Promise<void> {
    console.log(`[${PerformanceReportingService.serviceType}] instance stop called.`);
  }

  /**
   * Generates a performance metrics object from a list of trades and portfolio history.
   * @param trades - Array of executed trades.
   * @param portfolioHistory - Array of portfolio snapshots over time.
   * @param initialCapital - The starting capital of the simulation.
   * @param finalCapital - The ending capital of the simulation.
   * @param firstAssetPrice - The price of the asset at the start of the simulation.
   * @param lastAssetPrice - The price of the asset at the end of the simulation.
   * @returns PerformanceMetrics object.
   */
  public generateMetrics(
    trades: Trade[],
    portfolioHistory: PortfolioSnapshot[],
    initialCapital: number,
    finalCapital: number,
    firstAssetPrice?: number,
    lastAssetPrice?: number
  ): PerformanceMetrics {
    const totalTrades = trades.length;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalProfitFromWins = 0;
    let totalLossFromLosses = 0;

    trades.forEach((trade) => {
      if (trade.realizedPnl !== undefined) {
        if (trade.realizedPnl > 0) {
          winningTrades++;
          totalProfitFromWins += trade.realizedPnl;
        } else if (trade.realizedPnl < 0) {
          losingTrades++;
          totalLossFromLosses += Math.abs(trade.realizedPnl);
        }
      }
    });

    const totalPnlAbsolute = finalCapital - initialCapital;
    const totalPnlPercentage = initialCapital > 0 ? totalPnlAbsolute / initialCapital : 0;
    const winLossRatio =
      losingTrades > 0 ? winningTrades / losingTrades : winningTrades > 0 ? Infinity : 0;
    const averageWinAmount = winningTrades > 0 ? totalProfitFromWins / winningTrades : 0;
    const averageLossAmount = losingTrades > 0 ? totalLossFromLosses / losingTrades : 0;

    let maxDrawdown = 0;
    const portfolioReturns: number[] = [];
    if (portfolioHistory.length > 1) {
      let peak = portfolioHistory[0].totalValue; // Initialize with first value
      for (let i = 1; i < portfolioHistory.length; i++) {
        const yesterdayValue = portfolioHistory[i - 1].totalValue;
        const todayValue = portfolioHistory[i].totalValue;
        if (yesterdayValue > 0) {
          const dailyReturn = (todayValue - yesterdayValue) / yesterdayValue;
          portfolioReturns.push(dailyReturn);
        }

        if (todayValue > peak) {
          peak = todayValue;
        }
        const drawdown = peak > 0 && peak > todayValue ? (peak - todayValue) / peak : 0;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
    }

    // Sharpe Ratio Calculation (assuming 0 risk-free rate)
    let sharpeRatio: number | undefined = undefined;
    if (portfolioReturns.length > 1) {
      const avgReturn =
        portfolioReturns.reduce((acc, val) => acc + val, 0) / portfolioReturns.length;
      const stdDev = calculateStandardDeviation(portfolioReturns);
      // Annualize Sharpe Ratio, assuming daily returns. Sqrt(252) for trading days in a year.
      if (stdDev > 0) {
        sharpeRatio = (avgReturn / stdDev) * Math.sqrt(252);
      }
    }

    let buyAndHoldPnlPercentage: number | undefined = undefined;
    if (firstAssetPrice !== undefined && lastAssetPrice !== undefined && firstAssetPrice > 0) {
      buyAndHoldPnlPercentage = (lastAssetPrice - firstAssetPrice) / firstAssetPrice;
    }

    return {
      totalPnlAbsolute: parseFloat(totalPnlAbsolute.toFixed(4)),
      totalPnlPercentage: parseFloat(totalPnlPercentage.toFixed(4)),
      sharpeRatio: sharpeRatio !== undefined ? parseFloat(sharpeRatio.toFixed(4)) : undefined,
      sortinoRatio: undefined,
      winLossRatio: parseFloat(winLossRatio.toFixed(4)),
      averageWinAmount: parseFloat(averageWinAmount.toFixed(4)),
      averageLossAmount: parseFloat(averageLossAmount.toFixed(4)),
      maxDrawdown: parseFloat(maxDrawdown.toFixed(4)),
      totalTrades,
      winningTrades,
      losingTrades,
      firstAssetPrice: firstAssetPrice,
      lastAssetPrice: lastAssetPrice,
      buyAndHoldPnlPercentage:
        buyAndHoldPnlPercentage !== undefined
          ? parseFloat(buyAndHoldPnlPercentage.toFixed(4))
          : undefined,
    };
  }

  /**
   * Formats the full simulation report.
   * This might involve converting to Markdown, JSON string, or preparing for UI.
   * For now, it just ensures the SimulationReport structure is complete with calculated metrics.
   */
  public formatReport(
    simulationId: string,
    strategyId: string,
    strategyParams: any,
    symbol: string,
    timeframe: string,
    startDate: string, // ISO string
    endDate: string, // ISO string
    initialCapital: number,
    finalCapital: number,
    metrics: PerformanceMetrics,
    trades: Trade[],
    portfolioHistory: PortfolioSnapshot[]
  ): SimulationReport {
    return {
      strategy: strategyId,
      pair: symbol,
      startDate: new Date(startDate).getTime(),
      endDate: new Date(endDate).getTime(),
      trades,
      portfolioSnapshots: portfolioHistory,
      finalPortfolioValue: finalCapital,
      metrics,
    };
  }
}
