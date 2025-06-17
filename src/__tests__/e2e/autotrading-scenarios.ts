import type { IAgentRuntime, TestSuite } from '@elizaos/core';
import { strict as assert } from 'node:assert';
import { setupScenario, sendMessageAndWaitForResponse } from './test-utils.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * E2E test suite for autonomous trading functionality
 */
export const autoTradingScenarios: TestSuite = {
  name: 'Auto-Trading E2E Tests',
  tests: [
    {
      name: 'should start and stop trading autonomously',
      fn: async (runtime: IAgentRuntime) => {
        const { user, room } = await setupScenario(runtime);

        // Start trading
        const startResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          'Start trading with momentum strategy on BONK with $100'
        );

        console.log('Start trading response:', startResponse.text);
        assert(
          startResponse.text?.includes('Auto-trading started') ||
            startResponse.text?.includes('trading'),
          `Expected trading to start, but got: "${startResponse.text}"`
        );

        // Wait for some trading activity
        await sleep(2000);

        // Check status
        const statusResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          "What's my trading status?"
        );

        console.log('Status response:', statusResponse.text);
        assert(
          statusResponse.text?.includes('ACTIVE') || statusResponse.text?.includes('trading'),
          `Expected active status, but got: "${statusResponse.text}"`
        );

        // Stop trading
        const stopResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          'Stop trading'
        );

        console.log('Stop trading response:', stopResponse.text);
        assert(
          stopResponse.text?.includes('stopped') || stopResponse.text?.includes('Stop'),
          `Expected trading to stop, but got: "${stopResponse.text}"`
        );
      },
    },

    {
      name: 'should check P&L status',
      fn: async (runtime: IAgentRuntime) => {
        const { user, room } = await setupScenario(runtime);

        // Check P&L
        const pnlResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          "What's my P&L?"
        );

        console.log('P&L response:', pnlResponse.text);
        assert(
          pnlResponse.text?.includes('P&L') ||
            pnlResponse.text?.includes('profit') ||
            pnlResponse.text?.includes('loss') ||
            pnlResponse.text?.includes('performance'),
          `Expected P&L information, but got: "${pnlResponse.text}"`
        );
      },
    },

    {
      name: 'should configure trading parameters',
      fn: async (runtime: IAgentRuntime) => {
        const { user, room } = await setupScenario(runtime);

        // Start with specific parameters
        const configResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          'Start trading mean reversion on top 3 meme coins with $500, stop loss at 3%'
        );

        console.log('Config response:', configResponse.text);
        assert(
          configResponse.text?.includes('mean reversion') ||
            configResponse.text?.includes('trading'),
          `Expected configuration confirmation, but got: "${configResponse.text}"`
        );

        // Verify parameters were set
        assert(
          configResponse.text?.includes('500') || configResponse.text?.includes('$500'),
          `Expected $500 position size, but got: "${configResponse.text}"`
        );

        assert(
          configResponse.text?.includes('3%') || configResponse.text?.includes('stop loss'),
          `Expected 3% stop loss, but got: "${configResponse.text}"`
        );
      },
    },

    {
      name: 'should handle invalid trading requests',
      fn: async (runtime: IAgentRuntime) => {
        const { user, room } = await setupScenario(runtime);

        // Try to start with invalid strategy
        const invalidResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          'Start trading with nonexistent-strategy'
        );

        console.log('Invalid strategy response:', invalidResponse.text);
        // Should either use default strategy or indicate an error
        assert(
          invalidResponse.text?.includes('momentum') || // default strategy
            invalidResponse.text?.includes('error') ||
            invalidResponse.text?.includes('failed'),
          `Expected error or default strategy, but got: "${invalidResponse.text}"`
        );
      },
    },

    {
      name: 'should provide trading status when not trading',
      fn: async (runtime: IAgentRuntime) => {
        const { user, room } = await setupScenario(runtime);

        // Make sure trading is stopped
        await sendMessageAndWaitForResponse(runtime, room, user, 'Stop trading');

        await sleep(1000);

        // Check status
        const statusResponse = await sendMessageAndWaitForResponse(
          runtime,
          room,
          user,
          'Am I currently trading?'
        );

        console.log('Not trading status:', statusResponse.text);
        assert(
          statusResponse.text?.includes('STOPPED') ||
            statusResponse.text?.includes('not') ||
            statusResponse.text?.includes('inactive'),
          `Expected stopped status, but got: "${statusResponse.text}"`
        );
      },
    },
  ],
};

export default autoTradingScenarios;
