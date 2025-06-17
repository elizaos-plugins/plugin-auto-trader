import { Service, AgentRuntime } from '@elizaos/core';
import { OHLCV, HistoricalDataService as IHistoricalDataService } from '../types.ts';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { RateLimiter } from '../utils/rateLimiter.ts';

// --- Birdeye API Specifics (Conceptual) ---
// Removed: const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const BIRDEYE_OHLCV_ENDPOINT = 'https://public-api.birdeye.so/defi/ohlcv';
const BIRDEYE_MULTI_PRICE_ENDPOINT = 'https://public-api.birdeye.so/defi/multi_price';
interface BirdeyeOHLCVItem {
  unixTime: number;
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
  value?: number;
  address?: string;
  type?: string;
  currency?: string;
}
interface BirdeyeOHLCVResponse {
  data: { items: BirdeyeOHLCVItem[] };
  success: boolean;
}
// --- End Birdeye API Specifics ---

// --- Jupiter API Specifics (Conceptual) ---
// Removed: const JUPITER_API_KEY = process.env.JUPITER_API_KEY; // Assuming Jupiter might also need this pattern if used
const JUPITER_OHLCV_ENDPOINT = 'https://history.jup.ag/v1/candles';
interface JupiterOHLCVItem {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
interface JupiterOHLCVResponse {
  items: JupiterOHLCVItem[];
}
// --- End Jupiter API Specifics ---

// --- Filesystem Cache Specifics ---
const baseCacheDir = process.env.ELIZA_DATA_DIR || path.join(os.homedir(), '.eliza');
export const CACHE_DIR = path.join(baseCacheDir, 'cache/auto_trader_historical_data');
const CACHE_KEY_PREFIX = 'historicalData';
// --- End Filesystem Cache Specifics ---

// Remove the in-memory cache Map as we are moving to filesystem
// const दिनMemoryCache = new Map<string, OHLCV[]>();

// Export for testing purposes
export function generateCacheKey(
  symbol: string,
  timeframe: string,
  startDate: Date,
  endDate: Date,
  apiSource: string
): string {
  // Sanitize parts of the key to be filename-safe
  const safeSymbol = symbol.replace(/[^a-z0-9_.-]/gi, '_');
  const key = `${CACHE_KEY_PREFIX}_${apiSource}_${safeSymbol}_${timeframe}_${startDate.toISOString()}_${endDate.toISOString()}.json`;
  return key.replace(/:/g, '-'); // Replace colons from ISO string for safety with some filesystems
}

/**
 * Service responsible for fetching and caching historical OHLCV data.
 */
export class DefaultHistoricalDataService extends Service implements IHistoricalDataService {
  public static readonly serviceType = 'HistoricalDataService';
  public readonly capabilityDescription =
    'Fetches and caches historical OHLCV data for trading strategies.';

  // Rate limiter for API requests (1 request per 500ms, max 3 retries)
  private rateLimiter = new RateLimiter(500, 3, 2);

  constructor(runtime: AgentRuntime) {
    super(runtime); // Call base constructor with runtime
  }

  // Static start method (factory pattern)
  public static async start(runtime: AgentRuntime): Promise<DefaultHistoricalDataService> {
    // console.log(`[${DefaultHistoricalDataService.serviceType}] static start called - creating instance.`);
    const instance = new DefaultHistoricalDataService(runtime);
    await instance.start(); // Call instance start for any internal setup
    return instance;
  }

  // Instance start method
  public async start(): Promise<void> {
    // console.log(`[${DefaultHistoricalDataService.serviceType}] instance start called. Cache dir: ${CACHE_DIR}`);
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
    } catch (error) {
      console.error(
        `[${DefaultHistoricalDataService.serviceType}] Failed to create cache directory: ${CACHE_DIR}`,
        error
      );
    }
  }

  // Instance stop method
  public async stop(): Promise<void> {
    // console.log(`[${DefaultHistoricalDataService.serviceType}] instance stop called.`);
  }

  /**
   * Fetches historical OHLCV data for a given symbol and timeframe from a specific API source.
   * Attempts to retrieve from cache first. If not found or not fully covering, fetches from the API.
   */
  async fetchData(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date,
    apiSource: string
  ): Promise<OHLCV[]> {
    if (endDate <= startDate) {
      throw new Error('End date must be after start date.');
    }
    const cachedData = await this.getCachedData(symbol, timeframe, startDate, endDate, apiSource);
    if (cachedData) {
      console.log(
        `[${DefaultHistoricalDataService.serviceType}] Cache hit for ${symbol} from ${apiSource}`
      );
      return cachedData;
    }

    console.log(
      `[${DefaultHistoricalDataService.serviceType}] Cache miss for ${symbol}. Fetching from API: ${apiSource}`
    );
    let fetchedData: OHLCV[] = [];

    try {
      switch (apiSource.toLowerCase()) {
        case 'birdeye':
          fetchedData = await this.fetchFromBirdeye(symbol, timeframe, startDate, endDate);
          break;
        case 'jupiter':
          fetchedData = await this.fetchFromJupiter(symbol, timeframe, startDate, endDate);
          break;
        case 'mocksource':
          console.warn(
            `[${DefaultHistoricalDataService.serviceType}] Using mockSource for testing. This should not be used in production.`
          );
          fetchedData = this.generateMockData(startDate, endDate, timeframe);
          break;
        default:
          console.warn(
            `[${DefaultHistoricalDataService.serviceType}] API source "${apiSource}" not implemented. Returning empty data.`
          );
          return [];
      }
    } catch (error: any) {
      console.error(
        `[${DefaultHistoricalDataService.serviceType}] Exception fetching from ${apiSource} for ${symbol}:`,
        error.message
      );
      return []; // Return empty array on fetch error
    }

    const cleanedData = this.cleanAndStandardize(fetchedData);

    if (cleanedData.length > 0) {
      await this.cacheData(symbol, timeframe, apiSource, startDate, endDate, cleanedData);
    }
    return cleanedData;
  }

  private async fetchFromBirdeye(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date
  ): Promise<OHLCV[]> {
    const birdeyeApiKey = this.runtime.getSetting('BIRDEYE_API_KEY');
    if (!birdeyeApiKey) {
      console.warn(
        `[${DefaultHistoricalDataService.serviceType}] BIRDEYE_API_KEY not found. Cannot fetch from Birdeye.`
      );
      return [];
    }

    const birdeyeTimeframe = this.mapToApiTimeframe(timeframe, 'birdeye');
    const params = new URLSearchParams({
      address: symbol,
      type: birdeyeTimeframe,
      time_from: Math.floor(startDate.getTime() / 1000).toString(),
      time_to: Math.floor(endDate.getTime() / 1000).toString(),
    });

    const headers = {
      accept: 'application/json',
      'x-chain': 'solana',
      'X-API-KEY': birdeyeApiKey,
    };

    try {
      const apiResponse = await this.rateLimiter.execute(async () => {
        const response = await fetch(`${BIRDEYE_OHLCV_ENDPOINT}?${params.toString()}`, { headers });

        if (!response.ok) {
          const error = new Error(
            `Birdeye API request failed with status ${response.status}: ${await response.text()}`
          );
          (error as any).status = response.status;
          throw error;
        }

        return (await response.json()) as BirdeyeOHLCVResponse;
      });

      if (apiResponse.success && apiResponse.data?.items) {
        console.log(
          `[${DefaultHistoricalDataService.serviceType}] Fetched ${apiResponse.data.items.length} candles from Birdeye for ${symbol}`
        );
        return apiResponse.data.items.map((item) => this.transformBirdeyeItem(item));
      }
      return [];
    } catch (error) {
      console.error(
        `[${DefaultHistoricalDataService.serviceType}] Error fetching from Birdeye:`,
        error
      );
      throw error;
    }
  }

  private async fetchFromJupiter(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date
  ): Promise<OHLCV[]> {
    const jupiterTimeframe = this.mapToApiTimeframe(timeframe, 'jupiter');
    const params = new URLSearchParams({
      mint: symbol,
      interval: jupiterTimeframe,
      from: Math.floor(startDate.getTime() / 1000).toString(),
      to: Math.floor(endDate.getTime() / 1000).toString(),
    });

    const response = await fetch(`${JUPITER_OHLCV_ENDPOINT}?${params.toString()}`);

    if (!response.ok) {
      throw new Error(
        `Jupiter API request failed with status ${response.status}: ${await response.text()}`
      );
    }

    const apiResponse: JupiterOHLCVResponse = await response.json();

    if (apiResponse.items) {
      return apiResponse.items.map((item) => this.transformJupiterItem(item));
    }
    return [];
  }

  /**
   * Retrieves cached historical data if available and fully covers the requested range.
   */
  async getCachedData(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date,
    apiSource: string
  ): Promise<OHLCV[] | null> {
    const cacheFileName = generateCacheKey(symbol, timeframe, startDate, endDate, apiSource);
    const filePath = path.join(CACHE_DIR, cacheFileName);
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const data: OHLCV[] = JSON.parse(fileContent);
      // Basic validation: ensure it's an array and timestamps are roughly correct
      if (Array.isArray(data) && data.length > 0 && data[0].timestamp) {
        console.log(
          `[${DefaultHistoricalDataService.serviceType}] Filesystem cache hit for: ${cacheFileName}`
        );
        return data;
      }
      throw new Error('Invalid cache file format.');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        // Don't log for file not found, that's expected
        console.error(
          `[${DefaultHistoricalDataService.serviceType}] Error reading from cache file ${filePath}:`,
          error
        );
        if (await fs.stat(filePath).catch(() => false)) {
          await fs.unlink(filePath); // Corrupted cache file, delete it
        }
      }
    }
    // console.log(
    //   `[${DefaultHistoricalDataService.serviceType}] Filesystem cache miss for: ${cacheFileName}`,
    // );
    return null;
  }

  /**
   * Caches historical data.
   */
  async cacheData(
    symbol: string,
    timeframe: string,
    apiSource: string,
    startDate: Date,
    endDate: Date,
    data: OHLCV[]
  ): Promise<void> {
    if (!data || data.length === 0) return;
    const cacheFileName = generateCacheKey(symbol, timeframe, startDate, endDate, apiSource);
    const filePath = path.join(CACHE_DIR, cacheFileName);
    try {
      // Ensure cache directory exists (might be better in constructor or start())
      if (
        !(await fs
          .access(CACHE_DIR)
          .then(() => true)
          .catch(() => false))
      ) {
        await fs.mkdir(CACHE_DIR, { recursive: true });
      }
      const jsonData = JSON.stringify(data, null, 2); // Pretty print for readability
      await fs.writeFile(filePath, jsonData, 'utf-8');
      console.log(
        `[${DefaultHistoricalDataService.serviceType}] Data cached to filesystem: ${filePath}`
      );
    } catch (error) {
      console.error(
        `[${DefaultHistoricalDataService.serviceType}] Error writing to cache file ${filePath}:`,
        error
      );
    }
  }

  /**
   * Clears the entire in-memory cache. Useful for testing.
   */
  public async clearCache(): Promise<void> {
    try {
      const files = await fs.readdir(CACHE_DIR);
      for (const file of files) {
        await fs.unlink(path.join(CACHE_DIR, file));
      }
      console.info(
        `[${DefaultHistoricalDataService.serviceType}] Filesystem cache cleared: ${CACHE_DIR}`
      );
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        // Ignore if directory doesn't exist
        console.error(
          `[${DefaultHistoricalDataService.serviceType}] Error clearing filesystem cache:`,
          error
        );
      }
    }
  }

  // Placeholder for data cleaning and standardization
  private cleanAndStandardize(rawData: any[]): OHLCV[] {
    if (!Array.isArray(rawData)) {
      return [];
    }

    return rawData.filter(
      (item) =>
        typeof item.timestamp === 'number' &&
        typeof item.open === 'number' &&
        typeof item.high === 'number' &&
        typeof item.low === 'number' &&
        typeof item.close === 'number' &&
        typeof item.volume === 'number'
    ) as OHLCV[];
  }

  private mapToApiTimeframe(internalTimeframe: string, apiSource: 'birdeye' | 'jupiter'): string {
    const mapping: { [key: string]: string } = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '1h': '1H',
      '4h': '4H',
      '1d': '1D',
    };
    const jupiterMapping: { [key: string]: string } = {
      ...mapping,
      '1h': '1H',
      '4h': '4H',
      '1d': '1D',
    };
    const effectiveMapping = apiSource === 'jupiter' ? jupiterMapping : mapping;

    const mapped = effectiveMapping[internalTimeframe.toLowerCase()];
    if (!mapped) {
      console.warn(
        `[${DefaultHistoricalDataService.serviceType}] Unmapped timeframe for ${apiSource}: ${internalTimeframe}. Defaulting to 1H.`
      );
      return '1H';
    }
    return mapped;
  }

  private transformBirdeyeItem(item: BirdeyeOHLCVItem): OHLCV {
    return {
      timestamp: (item.unixTime || item.value || 0) * 1000,
      open: item.o,
      high: item.h,
      low: item.l,
      close: item.c,
      volume: item.v,
    };
  }

  private transformJupiterItem(item: JupiterOHLCVItem): OHLCV {
    return {
      timestamp: item.time * 1000,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume,
    };
  }

  private generateMockData(startDate: Date, endDate: Date, timeframe: string): OHLCV[] {
    const data: OHLCV[] = [];
    let currentTime = startDate.getTime();
    const endTime = endDate.getTime();
    const increment = this.getIncrementForTimeframe(timeframe);
    let lastClose = 100 + Math.random() * 10;
    while (currentTime < endTime) {
      const open = lastClose + (Math.random() - 0.5) * 2;
      const high = open + Math.random() * 2;
      const low = open - Math.random() * 2;
      const close = low + Math.random() * (high - low);
      const volume = 1000 + Math.random() * 5000;
      data.push({
        timestamp: currentTime,
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume: parseFloat(volume.toFixed(2)),
      });
      lastClose = close;
      currentTime += increment;
      if (data.length > 500) break;
    }
    return data;
  }

  private getIncrementForTimeframe(timeframe: string): number {
    switch (timeframe.toLowerCase()) {
      case '1m':
        return 60 * 1000;
      case '5m':
        return 5 * 60 * 1000;
      case '15m':
        return 15 * 60 * 1000;
      case '1h':
        return 60 * 60 * 1000;
      case '4h':
        return 4 * 60 * 60 * 1000;
      case '1d':
        return 24 * 60 * 60 * 1000;
      default:
        console.warn(
          `Unsupported timeframe for mock data generation: ${timeframe}. Defaulting to 1 hour.`
        );
        return 60 * 60 * 1000;
    }
  }
}
