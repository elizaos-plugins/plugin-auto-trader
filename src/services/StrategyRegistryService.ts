import { Service, AgentRuntime } from '@elizaos/core'; // Import Service and AgentRuntime
import { TradingStrategy } from '../types.ts';
import { RandomStrategy } from '../strategies/RandomStrategy.ts';
import { RuleBasedStrategy } from '../strategies/RuleBasedStrategy.ts';
import { LLMStrategy, setLLMService } from '../strategies/LLMStrategy.ts';
import { OptimizedRuleBasedStrategy } from '../strategies/OptimizedRuleBasedStrategy.ts';
import { AdaptiveRuleBasedStrategy } from '../strategies/AdaptiveRuleBasedStrategy.ts';
import { MultiTimeframeStrategy } from '../strategies/MultiTimeframeStrategy.ts';
import { MomentumBreakoutStrategy } from '../strategies/MomentumBreakoutStrategy.ts';
import { OptimizedMomentumStrategy } from '../strategies/OptimizedMomentumStrategy.ts';

// Removed IElizaService, as we now extend Service

/**
 * Manages the registration and retrieval of trading strategies.
 */
export class StrategyRegistryService extends Service {
  // Extend Service
  // serviceType is often a public static readonly property or passed to super()
  public static override readonly serviceType = 'StrategyRegistryService';
  public readonly capabilityDescription =
    'Manages registration and retrieval of trading strategies.'; // Implement abstract member

  private strategies: Map<string, TradingStrategy> = new Map();
  // this.runtime is inherited from the base Service class and set by super(runtime)

  constructor(runtime: AgentRuntime) {
    super(runtime);
  }

  // Static start method (factory pattern as per Untitled-1 example)
  public static async start(runtime: AgentRuntime): Promise<StrategyRegistryService> {
    console.log(
      `[${StrategyRegistryService.serviceType}] static start called - creating instance.`
    );
    // The runtime calls this static method, which returns the instance.
    // The runtime then likely calls the instance .start() method on this returned instance.
    return new StrategyRegistryService(runtime);
  }

  // Instance start method - this is what the runtime likely calls on the instance.
  // This contains the actual initialization logic for this service instance.
  public async start(): Promise<void> {
    console.log(
      `[${StrategyRegistryService.serviceType}] instance start called - registering strategies.`
    );

    // Import and register the default strategies
    const { RandomStrategy } = await import('../strategies/RandomStrategy.ts');
    const { RuleBasedStrategy } = await import('../strategies/RuleBasedStrategy.ts');
    const { LLMStrategy } = await import('../strategies/LLMStrategy.ts');
    const { OptimizedRuleBasedStrategy } = await import(
      '../strategies/OptimizedRuleBasedStrategy.ts'
    );
    const { AdaptiveRuleBasedStrategy } = await import(
      '../strategies/AdaptiveRuleBasedStrategy.ts'
    );
    const { MultiTimeframeStrategy } = await import('../strategies/MultiTimeframeStrategy.ts');
    const { MomentumBreakoutStrategy } = await import('../strategies/MomentumBreakoutStrategy.ts');
    const { OptimizedMomentumStrategy } = await import(
      '../strategies/OptimizedMomentumStrategy.ts'
    );
    const { MeanReversionStrategy } = await import('../strategies/MeanReversionStrategy.ts');

    this.registerStrategy(new RandomStrategy());
    this.registerStrategy(new RuleBasedStrategy());
    this.registerStrategy(new LLMStrategy());
    this.registerStrategy(new OptimizedRuleBasedStrategy());
    this.registerStrategy(new AdaptiveRuleBasedStrategy());
    this.registerStrategy(new MultiTimeframeStrategy());
    this.registerStrategy(new MomentumBreakoutStrategy());
    this.registerStrategy(new OptimizedMomentumStrategy());
    this.registerStrategy(new MeanReversionStrategy());

    console.log(
      `[${StrategyRegistryService.serviceType}] Registered ${this.strategies.size} strategies.`
    );
  }

  // Instance stop method
  public async stop(): Promise<void> {
    console.log(`[${StrategyRegistryService.serviceType}] instance stop called.`);
    this.clearStrategies();
    console.log(`[${StrategyRegistryService.serviceType}] instance stopped successfully.`);
  }

  /**
   * Registers a new trading strategy.
   * @param strategy - The trading strategy instance to register.
   * @throws Error if a strategy with the same ID is already registered.
   */
  public registerStrategy(strategy: TradingStrategy): void {
    if (!strategy || !strategy.id) {
      throw new Error('Strategy and strategy ID cannot be null or empty.');
    }
    if (this.strategies.has(strategy.id)) {
      throw new Error(`Strategy with ID "${strategy.id}" is already registered.`);
    }
    this.strategies.set(strategy.id, strategy);
    console.log(
      `[${StrategyRegistryService.serviceType}] Strategy "${strategy.name}" (ID: ${strategy.id}) registered.`
    );
  }

  /**
   * Retrieves a registered trading strategy by its ID.
   * @param id - The unique ID of the strategy.
   * @returns The trading strategy instance, or null if not found.
   */
  public getStrategy(id: string): TradingStrategy | null {
    if (!id) {
      // Or throw new Error('Strategy ID cannot be null or empty.'); depending on desired strictness
      return null;
    }
    return this.strategies.get(id) || null;
  }

  /**
   * Lists all registered trading strategies.
   * @returns An array of all registered trading strategy instances.
   */
  public listStrategies(): TradingStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Clears all registered strategies.
   * Useful for testing or system resets.
   */
  public clearStrategies(): void {
    this.strategies.clear();
    console.log(`[${StrategyRegistryService.serviceType}] All strategies cleared.`);
  }
}
