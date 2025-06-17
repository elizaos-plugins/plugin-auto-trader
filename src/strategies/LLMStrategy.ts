import {
  TradingStrategy,
  TradeOrder,
  TradeType,
  OrderType,
  StrategyContextMarketData,
  AgentState,
  OHLCV,
  PortfolioSnapshot,
} from '../types.ts';
import { AgentRuntime } from '@elizaos/core';

// Updated hypothetical interface for an ElizaOS LLM Service
interface ElizaOSLLMService {
  generate(
    prompt: string,
    options?: {
      systemPrompt?: string;
      model?: string;
      maxTokens?: number;
      temperature?: number;
      structuredOutputSchema?: any; // e.g., a JSON schema for the expected output format
      // stream?: boolean; // For streaming responses, not used in this single-shot decision logic
    }
  ): Promise<string | object>; // Can return a string (to be JSON parsed) or an already parsed object
}

// Placeholder for the actual ElizaOS LLM service instance
// In a real ElizaOS plugin, this would likely be obtained via dependency injection or a service locator
let elizaOSLlmService: ElizaOSLLMService | null = null;

// Function to set the LLM service (for testing or runtime initialization)
export function setLLMService(service: ElizaOSLLMService) {
  elizaOSLlmService = service;
}

interface LLMTradeDecisionInternal {
  action: 'BUY' | 'SELL' | 'HOLD';
  symbol?: string;
  quantity?: number | null | undefined;
  orderType?: OrderType;
  price?: number;
  reason?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are a cryptocurrency trading analyst. Your goal is to make a decision to BUY, SELL, or HOLD based on the data provided. Respond ONLY with a single, valid JSON object in the format specified in the "structuredOutputSchema". Do not include any other text, explanations, or markdown formatting.`;

export class LLMStrategy implements TradingStrategy {
  public readonly id = 'llm-v1';
  public readonly name = 'LLM-Based Trading Strategy';
  public readonly description =
    'Uses AI language models to make trading decisions based on market analysis.';

  private runtime?: AgentRuntime;
  private params: LLMStrategyParams = {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.7,
    defaultTradeSizePercentage: 0.01, // 1%
  };

  constructor(runtime?: AgentRuntime) {
    this.runtime = runtime;
  }

  async initialize(runtime: AgentRuntime): Promise<void> {
    this.runtime = runtime;
  }

  isReady(): boolean {
    return true; // For now, always ready
  }

  configure(params: LLMStrategyParams): void {
    if (
      params.defaultTradeSizePercentage !== undefined &&
      (params.defaultTradeSizePercentage <= 0 || params.defaultTradeSizePercentage > 1)
    ) {
      throw new Error(
        'defaultTradeSizePercentage must be between 0 (exclusive) and 1 (inclusive).'
      );
    }
    if (params.defaultFixedTradeQuantity !== undefined && params.defaultFixedTradeQuantity <= 0) {
      throw new Error('defaultFixedTradeQuantity must be positive.');
    }
    if (params.maxTokens !== undefined && params.maxTokens <= 0) {
      throw new Error('maxTokens must be positive.');
    }
    if (params.temperature !== undefined && (params.temperature < 0 || params.temperature > 2)) {
      throw new Error('temperature must be between 0 and 2.');
    }
    this.params = { ...this.params, ...params };
  }

  private buildPrompt(marketData: StrategyContextMarketData, agentState: AgentState): string {
    let prompt = this.params.customPromptPrefix ? `${this.params.customPromptPrefix}\n\n` : '';

    prompt += `Market Data:\n`;
    if (marketData.currentPrice) prompt += `- Current Price: ${marketData.currentPrice}\n`;

    if (marketData.priceData && marketData.priceData.length > 0) {
      const latest = marketData.priceData[marketData.priceData.length - 1];
      prompt += `- Latest Candle (Time: ${new Date(latest.timestamp).toISOString()}): O=${latest.open}, H=${latest.high}, L=${latest.low}, C=${latest.close}, V=${latest.volume}\n`;

      const recentCloses = marketData.priceData
        .slice(-5)
        .map((c) => c.close)
        .join(', ');
      prompt += `- Recent Price Trend (last 5 closes): ${recentCloses}\n`;
    }

    if (marketData.indicators) {
      prompt += `- Indicators: ${JSON.stringify(marketData.indicators)}\n`;
    }

    prompt += `\nAgent State:\n`;
    prompt += `- Portfolio Value: ${agentState.portfolioValue.toFixed(2)}\n`;
    prompt += `- Recent Trades: ${agentState.recentTrades}\n`;
    prompt += `- Confidence Level: ${agentState.confidenceLevel}\n`;

    // Default symbol for context
    const symbol = 'SOL/USDC';

    prompt += `\nDecision Instructions:\nYour response MUST be a single JSON object.
- For a trade: { "action": "BUY" or "SELL", "symbol": "${symbol}", "quantity": <number (float) or null if unsure>, "orderType": "MARKET" or "LIMIT" (default MARKET), "price": <number_if_limit_order>, "reason": "<brief_reasoning>" }
- To do nothing: { "action": "HOLD", "reason": "<brief_reasoning>" }
- If quantity is null or 0, system will attempt to use default trade size.
`;

    if (this.params.structuredOutputSchema) {
      prompt += `\nAdhere STRICTLY to this JSON schema for your response (prioritize above structure for key fields like action, symbol, quantity, orderType, price, reason):
${JSON.stringify(this.params.structuredOutputSchema)}
`;
    } else {
      prompt += `Example BUY: { "action": "BUY", "symbol": "${symbol}", "quantity": 1.5, "orderType": "MARKET", "reason": "Price broke resistance." }
Example HOLD: { "action": "HOLD", "reason": "Market too choppy." }
`;
    }

    if (this.params.customPromptSuffix) {
      prompt += `\n${this.params.customPromptSuffix}`;
    }
    return prompt;
  }

  public parseLLMResponse(response: string | object): LLMTradeDecisionInternal | null {
    try {
      const responseObject: any = typeof response === 'string' ? JSON.parse(response) : response;

      if (!responseObject || typeof responseObject.action !== 'string') {
        console.warn('[LLMStrategy] LLM response missing or invalid action field.', responseObject);
        return null;
      }
      const action = responseObject.action.toUpperCase();
      if (action !== 'BUY' && action !== 'SELL' && action !== 'HOLD') {
        console.warn('[LLMStrategy] LLM response invalid action value:', action);
        return null;
      }

      const decision: LLMTradeDecisionInternal = {
        action: action as 'BUY' | 'SELL' | 'HOLD',
        reason: responseObject.reason,
        symbol: undefined,
        quantity: undefined,
        orderType: undefined,
        price: undefined,
      };

      if (action === 'BUY' || action === 'SELL') {
        if (typeof responseObject.symbol !== 'string' || !responseObject.symbol.trim()) {
          console.warn(
            '[LLMStrategy] LLM BUY/SELL response missing or empty symbol.',
            responseObject
          );
          return null;
        }
        decision.symbol = responseObject.symbol;

        const llmQuantity = responseObject.quantity;
        if (llmQuantity === undefined || llmQuantity === null) {
          decision.quantity = llmQuantity;
        } else if (typeof llmQuantity === 'number') {
          if (llmQuantity < 0) {
            console.warn(
              '[LLMStrategy] LLM BUY/SELL response: quantity is negative.',
              responseObject
            );
            return null;
          }
          decision.quantity = llmQuantity;
        } else {
          console.warn(
            '[LLMStrategy] LLM BUY/SELL response: quantity type is invalid (not a number, null, or undefined).',
            responseObject
          );
          return null;
        }

        decision.orderType = (
          responseObject.orderType?.toUpperCase() === 'LIMIT' ? 'LIMIT' : 'MARKET'
        ) as OrderType;

        if (decision.orderType === 'LIMIT') {
          if (typeof responseObject.price !== 'number' || responseObject.price <= 0) {
            console.warn(
              '[LLMStrategy] LLM LIMIT order response missing or invalid price.',
              responseObject
            );
            return null;
          }
          decision.price = responseObject.price;
        }
      }
      return decision;
    } catch (error: any) {
      console.error(
        '[LLMStrategy] Error parsing LLM JSON response:',
        error.message,
        'Raw response:',
        response
      );
      return null;
    }
  }

  async shouldExecute(
    marketData: StrategyContextMarketData,
    agentState: AgentState
  ): Promise<TradeOrder | null> {
    const llmService = this.runtime?.getService<any>('LLMService');
    if (!llmService) {
      console.error(`[${this.id}] Could not find LLMService.`);
      return null;
    }

    const prompt = this.buildPrompt(marketData, agentState);

    try {
      const llmResponse = await llmService.generateText({
        prompt,
        systemPrompt: this.params.systemPrompt,
        model: this.params.modelName,
        temperature: this.params.temperature,
        maxTokens: this.params.maxTokens,
      });

      const tradeAction = this.parseLLMResponse(llmResponse);

      if (!tradeAction || tradeAction.action === 'HOLD') {
        return null;
      }

      const symbol = tradeAction.symbol || 'SOL/USDC';

      if (tradeAction.symbol && tradeAction.symbol.toUpperCase() !== symbol.toUpperCase()) {
        console.warn(
          `[${this.id}] LLM suggested trading for ${tradeAction.symbol} but current context is for ${symbol}. Ignoring.`
        );
        return null;
      }

      let quantity = tradeAction.quantity;
      if (!quantity || quantity <= 0) {
        quantity = this.calculateTradeQuantity(marketData, agentState);
      }

      if (quantity <= 1e-8) {
        return null;
      }

      return {
        pair: symbol,
        action: tradeAction.action as TradeType,
        quantity: parseFloat(quantity.toFixed(8)),
        orderType: (tradeAction.orderType || OrderType.MARKET) as OrderType,
        price: tradeAction.price,
        timestamp: Date.now(),
        reason: tradeAction.reason || 'LLM decision',
      };
    } catch (error) {
      console.error(`[${this.id}] Error during LLM interaction or processing:`, error);
      return null;
    }
  }

  private calculateTradeQuantity(
    marketData: StrategyContextMarketData,
    agentState: AgentState
  ): number {
    if (
      this.params.defaultTradeSizePercentage &&
      marketData.currentPrice &&
      marketData.currentPrice > 0 &&
      agentState.portfolioValue &&
      agentState.portfolioValue > 0
    ) {
      // Use portfolio value as proxy for available capital
      return (
        (agentState.portfolioValue * this.params.defaultTradeSizePercentage) /
        marketData.currentPrice
      );
    }
    if (this.params.defaultFixedTradeQuantity) {
      return this.params.defaultFixedTradeQuantity;
    }
    return 0;
  }

  private createOrder(
    marketData: StrategyContextMarketData,
    action: 'BUY' | 'SELL' | 'HOLD',
    quantity: number,
    agentState: AgentState,
    reason: string,
    meta: { price?: number; orderType?: OrderType; llmRawResponse?: string }
  ): TradeOrder | null {
    if (quantity <= 0) return null;

    const symbol = 'SOL/USDC'; // Default symbol

    if (action === 'SELL') {
      // Check holdings would be done at higher level with portfolio snapshot
      console.warn(`[${this.id}] SELL order validation should be done with portfolio snapshot`);
    }

    if (action === 'BUY') {
      const cost = (meta.price || marketData.currentPrice || 0) * quantity;
      if (cost > agentState.portfolioValue) {
        console.warn(
          `[${this.id}] Attempted to BUY ${quantity} of ${symbol} for ${cost}, but portfolio value is only ${agentState.portfolioValue}.`
        );
        return null;
      }
    }

    return {
      pair: symbol,
      action: action as TradeType,
      quantity: parseFloat(quantity.toFixed(8)),
      orderType: meta?.orderType || OrderType.MARKET,
      price: meta?.price,
      timestamp: Date.now(),
      reason: reason,
    };
  }

  async decide(params: {
    marketData: StrategyContextMarketData;
    agentState: AgentState;
    portfolioSnapshot: PortfolioSnapshot;
    agentRuntime?: AgentRuntime;
  }): Promise<TradeOrder | null> {
    const { marketData, agentState, portfolioSnapshot, agentRuntime } = params;

    const llmService = (agentRuntime || this.runtime)?.getService<any>('LLMService');
    if (!llmService) {
      console.error(`[${this.id}] Could not find LLMService.`);
      return null;
    }

    // Build prompt using new portfolio snapshot data
    const prompt = this.buildPromptForDecide(marketData, portfolioSnapshot);

    try {
      const llmResponse = await llmService.generateText({
        prompt,
        systemPrompt: this.params.systemPrompt,
        model: this.params.modelName,
        temperature: this.params.temperature,
        maxTokens: this.params.maxTokens,
      });

      const tradeAction = this.parseLLMResponse(llmResponse);

      if (!tradeAction || tradeAction.action === 'HOLD') {
        return null;
      }

      // Extract symbol from market data
      const symbol =
        marketData.priceData && marketData.priceData.length > 0
          ? 'SOL/USDC' // Default pair
          : 'SOL/USDC';

      // Calculate quantity with proper defaults
      let quantityToTrade: number;
      if (tradeAction.quantity && tradeAction.quantity > 0) {
        quantityToTrade = tradeAction.quantity;
      } else if (
        this.params.defaultTradeSizePercentage &&
        portfolioSnapshot.totalValue > 0 &&
        marketData.currentPrice &&
        marketData.currentPrice > 0
      ) {
        const tradeValue = portfolioSnapshot.totalValue * this.params.defaultTradeSizePercentage;
        quantityToTrade = tradeValue / marketData.currentPrice;
      } else if (
        this.params.defaultFixedTradeQuantity &&
        this.params.defaultFixedTradeQuantity > 0
      ) {
        quantityToTrade = this.params.defaultFixedTradeQuantity;
      } else {
        // Default minimal amount
        quantityToTrade = 0.01;
      }

      // Validate quantity
      if (quantityToTrade <= 0) return null;

      // For SELL orders, check if we have sufficient holdings
      if (tradeAction.action === TradeType.SELL) {
        const assetSymbol = symbol.split('/')[0];
        const holding = portfolioSnapshot.holdings[assetSymbol] || 0;
        if (holding < quantityToTrade) {
          console.warn(
            `[LLMStrategy] Not enough holdings to sell. Required: ${quantityToTrade}, Available: ${holding}`
          );
          return null;
        }
      }

      return {
        pair: symbol,
        action: tradeAction.action as TradeType,
        quantity: quantityToTrade,
        orderType: tradeAction.orderType || OrderType.MARKET,
        price: tradeAction.price,
        timestamp: Date.now(),
        reason: tradeAction.reason || 'LLM decision',
      };
    } catch (error) {
      console.error(`[${this.id}] Error during LLM interaction or processing:`, error);
      return null;
    }
  }

  private buildPromptForDecide(
    marketData: StrategyContextMarketData,
    portfolioSnapshot: PortfolioSnapshot
  ): string {
    let prompt = this.params.customPromptPrefix ? `${this.params.customPromptPrefix}\n\n` : '';

    prompt += `Market Data:\n`;
    prompt += `- Current Price: ${marketData.currentPrice}\n`;

    if (marketData.priceData && marketData.priceData.length > 0) {
      const recentCloses = marketData.priceData
        .slice(-5)
        .map((c) => c.close)
        .join(', ');
      prompt += `- Recent Price Trend (last 5 closes): ${recentCloses}\n`;
    }

    prompt += `\nPortfolio:\n`;
    prompt += `- Total Value: ${portfolioSnapshot.totalValue.toFixed(2)}\n`;

    for (const [asset, amount] of Object.entries(portfolioSnapshot.holdings)) {
      if (amount > 0) {
        prompt += `- ${asset}: ${amount}\n`;
      }
    }

    prompt += `\nDecision Instructions:\nYour response MUST be a single JSON object.
- For a trade: { "action": "BUY" or "SELL", "quantity": <number or null>, "orderType": "MARKET" or "LIMIT", "price": <number_if_limit>, "reason": "<brief_reasoning>" }
- To do nothing: { "action": "HOLD", "reason": "<brief_reasoning>" }
`;

    if (this.params.customPromptSuffix) {
      prompt += `\n${this.params.customPromptSuffix}`;
    }

    return prompt;
  }
}

export interface LLMStrategyParams {
  modelName?: string;
  customPromptPrefix?: string;
  customPromptSuffix?: string;
  maxTokens?: number;
  temperature?: number;
  defaultTradeSizePercentage?: number;
  defaultFixedTradeQuantity?: number;
  structuredOutputSchema?: any;
  systemPrompt?: string;
}
