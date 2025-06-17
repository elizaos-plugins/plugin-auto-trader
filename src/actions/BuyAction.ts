import {
  Action,
  ActionExample,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  elizaLogger,
} from '@elizaos/core';
import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { z } from 'zod';

// Schema for buy parameters
const BuyParamsSchema = z.object({
  tokenAddress: z.string().describe('The token address to buy'),
  amount: z.number().positive().describe('Amount in USDC to spend'),
  slippageBps: z
    .number()
    .min(0)
    .max(5000)
    .default(100)
    .describe('Slippage in basis points (100 = 1%)'),
  priorityFee: z.number().min(0).default(0.0001).describe('Priority fee in SOL'),
});

export const buyAction: Action = {
  name: 'BUY_TOKEN',
  description: 'Execute a buy order for a token on Solana',
  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Buy $100 worth of BONK',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: "I'll buy $100 worth of BONK for you",
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Purchase 500 USDC of WIF with 2% slippage',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Executing purchase of 500 USDC worth of WIF with 2% slippage',
        },
      },
    ],
  ],

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    try {
      // Check if wallet service is available
      const walletService = runtime.getService('WalletIntegrationService');
      if (!walletService) {
        elizaLogger.error('[BuyAction] Wallet service not available');
        return false;
      }

      // Check if we're in live trading mode
      const tradingMode = runtime.getSetting('TRADING_MODE');
      if (tradingMode !== 'live') {
        elizaLogger.warn('[BuyAction] Not in live trading mode');
        return false;
      }

      // Check for buy-related keywords
      const text = message.content.text?.toLowerCase() || '';
      const buyKeywords = ['buy', 'purchase', 'acquire', 'get', 'swap usdc for'];
      return buyKeywords.some((keyword) => text.includes(keyword));
    } catch (error) {
      elizaLogger.error('[BuyAction] Validation error:', error);
      return false;
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback
  ): Promise<void> => {
    try {
      elizaLogger.info('[BuyAction] Starting buy order execution');

      // Parse parameters from message text
      const text = message.content.text || '';
      const params = parseBuyParams(text);

      if (!params) {
        if (callback) {
          callback({
            text: "I couldn't parse your buy order. Please specify the amount and token.",
            action: 'BUY_TOKEN_ERROR',
          });
        }
        return;
      }

      elizaLogger.info('[BuyAction] Parsed parameters:', params);

      // Get services
      const walletService = runtime.getService('WalletIntegrationService');

      if (!walletService) {
        throw new Error('Wallet service not available');
      }

      // For now, inform user that live trading is not fully implemented
      if (callback) {
        callback({
          text: `I understand you want to buy $${params.amount} worth of tokens. 

However, live trading execution is currently limited due to transaction signing requirements.

To execute trades, please:
1. Use a DEX interface directly
2. Or wait for full transaction signing support in plugin-solana

For testing strategies, use paper trading mode.`,
          action: 'BUY_TOKEN_INFO',
        });
      }
    } catch (error: any) {
      elizaLogger.error('[BuyAction] Error:', error);
      if (callback) {
        callback({
          text: `Error: ${error.message}`,
          action: 'BUY_TOKEN_ERROR',
        });
      }
    }
  },
};

// Helper function to parse buy parameters from text
function parseBuyParams(text: string): { amount: number; token?: string } | null {
  // Match patterns like "$100", "100 USDC", "100 dollars"
  const amountMatch = text.match(/\$?(\d+(?:\.\d+)?)\s*(?:usd|usdc|dollars?)?/i);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1]);
  if (isNaN(amount) || amount <= 0) return null;

  // Try to extract token name/symbol
  const tokenMatch = text.match(/(?:of|worth of|buy|purchase)\s+(\w+)/i);
  const token = tokenMatch?.[1];

  return { amount, token };
}

export default buyAction;
