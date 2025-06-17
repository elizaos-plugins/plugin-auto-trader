import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DefaultHistoricalDataService,
  generateCacheKey,
  CACHE_DIR,
} from '../HistoricalDataService.ts';
import { IAgentRuntime, UUID } from '@elizaos/core';
import { OHLCV } from '../../types.ts';
import fs from 'fs/promises';
import path from 'path';

// Mock the global fetch
(globalThis as any).fetch = vi.fn();

describe('DefaultHistoricalDataService', () => {
  let service: DefaultHistoricalDataService;
  let runtime: IAgentRuntime;

  beforeEach(() => {
    vi.clearAllMocks();

    runtime = {
      agentId: 'test-agent-id' as UUID,
      getSetting: vi.fn((key: string) => {
        if (key === 'BIRDEYE_API_KEY') return 'test-birdeye-key';
        if (key === 'JUPITER_API_KEY') return 'test-jupiter-key';
        return null;
      }),
      getService: vi.fn(),
    } as any;

    service = new DefaultHistoricalDataService(runtime as any);
  });

  afterEach(async () => {
    // Clean up cache directory after each test
    try {
      await service.clearCache();
    } catch (error) {
      // Ignore errors during cleanup
    }
  });

  describe('generateCacheKey (exported for test)', () => {
    it('should create a filename-safe cache key', () => {
      const key = generateCacheKey(
        'SOL/USDC',
        '1h',
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-02T00:00:00Z'),
        'birdeye'
      );

      expect(key).toContain('historicalData_birdeye_SOL_USDC_1h');
      expect(key).not.toContain(':'); // colons should be replaced
      expect(key).toContain('.json');
    });
  });

  describe('static start', () => {
    it('should create and return a new instance', async () => {
      const instance = await DefaultHistoricalDataService.start(runtime as any);

      expect(instance).toBeInstanceOf(DefaultHistoricalDataService);
    });
  });

  describe('instance start', () => {
    it('should create cache directory', async () => {
      vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);

      await service.start();

      expect(fs.mkdir).toHaveBeenCalledWith(CACHE_DIR, { recursive: true });
    });

    it('should handle error creating cache directory', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(fs, 'mkdir').mockRejectedValue(new Error('Permission denied'));

      await service.start();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create cache directory'),
        expect.any(Error)
      );
    });
  });

  describe('fetchData', () => {
    it('should throw an error if end date is not after start date', async () => {
      await expect(
        service.fetchData('SOL', '1h', new Date('2024-01-02'), new Date('2024-01-01'), 'birdeye')
      ).rejects.toThrow('End date must be after start date.');
    });

    it('should return mock data and cache it when using mockSource', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-02');

      const data = await service.fetchData('SOL', '1h', startDate, endDate, 'mockSource');

      expect(data).toBeDefined();
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('timestamp');
      expect(data[0]).toHaveProperty('open');
      expect(data[0]).toHaveProperty('close');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Using mockSource for testing')
      );

      // Verify data was cached
      const cachedData = await service.getCachedData('SOL', '1h', startDate, endDate, 'mockSource');
      expect(cachedData).toEqual(data);
    });

    it('should return empty array for "birdeye" if API key is missing', async () => {
      runtime.getSetting = vi.fn(() => null);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const data = await service.fetchData(
        'SOL',
        '1h',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        'birdeye'
      );

      expect(data).toEqual([]);
    });

    it('should fetch from Birdeye API when API key is available', async () => {
      const mockBirdeyeResponse = {
        success: true,
        data: {
          items: [
            {
              unixTime: 1704067200,
              o: 100, // open
              h: 105, // high
              l: 99, // low
              c: 103, // close
              v: 1000, // volume
            },
          ],
        },
      };

      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockBirdeyeResponse,
      } as Response);

      const data = await service.fetchData(
        'SOL',
        '1h',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        'birdeye'
      );

      expect((globalThis as any).fetch).toHaveBeenCalledWith(
        expect.stringContaining('birdeye.so'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-KEY': 'test-birdeye-key',
            accept: 'application/json',
            'x-chain': 'solana',
          }),
        })
      );
      expect(data).toHaveLength(1);
      expect(data[0].open).toBe(100);
    });

    it('should handle Birdeye API errors', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as Response);

      const data = await service.fetchData(
        'SOL',
        '1h',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        'birdeye'
      );

      expect(data).toEqual([]);
    });

    it('should fetch from Jupiter API', async () => {
      const mockJupiterResponse = {
        items: [
          {
            time: 1704067200,
            open: 100,
            high: 105,
            low: 99,
            close: 103,
            volume: 1000,
          },
        ],
      };

      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockJupiterResponse,
      } as Response);

      const data = await service.fetchData(
        'SOL',
        '1h',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        'jupiter'
      );

      expect((globalThis as any).fetch).toHaveBeenCalledWith(expect.stringContaining('jup.ag'));
      expect(data).toHaveLength(1);
      expect(data[0].open).toBe(100);
    });

    it('should handle Jupiter API errors', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      ((globalThis as any).fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

      const data = await service.fetchData(
        'SOL',
        '1h',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        'jupiter'
      );

      expect(data).toEqual([]);
    });

    it('should return empty array for an unsupported API source', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const data = await service.fetchData(
        'SOL',
        '1h',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        'unsupported'
      );

      expect(data).toEqual([]);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not implemented'));
    });

    it('should use cache on second call', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      // First call - fetch from API
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-02');

      const data1 = await service.fetchData('SOL', '1h', startDate, endDate, 'mockSource');

      // Reset fetch mock
      ((globalThis as any).fetch as any).mockClear();

      // Second call - should use cache
      const data2 = await service.fetchData('SOL', '1h', startDate, endDate, 'mockSource');

      expect(data2).toEqual(data1);
      expect((globalThis as any).fetch).not.toHaveBeenCalled(); // Should not fetch again
    });
  });

  describe('Filesystem Cache Logic', () => {
    const testData: OHLCV[] = [
      { timestamp: 1704067200000, open: 100, high: 105, low: 99, close: 103, volume: 1000 },
    ];

    it('should save data to cache', async () => {
      await service.cacheData(
        'TEST',
        '1h',
        'mockSource',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        testData
      );

      const cacheKey = generateCacheKey(
        'TEST',
        '1h',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        'mockSource'
      );
      const filePath = path.join(CACHE_DIR, cacheKey);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const cachedData = JSON.parse(fileContent);

      expect(cachedData).toEqual(testData);
    });

    it('should retrieve data from cache', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-02');

      await service.cacheData('TEST', '1h', 'mockSource', startDate, endDate, testData);
      const cachedData = await service.getCachedData(
        'TEST',
        '1h',
        startDate,
        endDate,
        'mockSource'
      );

      expect(cachedData).toEqual(testData);
    });

    it('should return null if cache file does not exist', async () => {
      const cachedData = await service.getCachedData(
        'NONEXISTENT',
        '1h',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        'mockSource'
      );

      expect(cachedData).toBeNull();
    });

    it('should not attempt to cache empty data', async () => {
      vi.spyOn(fs, 'writeFile').mockResolvedValue();

      await service.cacheData(
        'TEST',
        '1h',
        'mockSource',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        []
      );

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle corrupted cache files', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const cacheKey = generateCacheKey(
        'TEST',
        '1h',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        'mockSource'
      );
      const filePath = path.join(CACHE_DIR, cacheKey);

      // Mock fs operations to simulate corrupted file
      vi.spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('Invalid JSON'));
      vi.spyOn(fs, 'stat').mockResolvedValueOnce({} as any);
      vi.spyOn(fs, 'unlink').mockResolvedValueOnce();

      const cachedData = await service.getCachedData(
        'TEST',
        '1h',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        'mockSource'
      );

      expect(cachedData).toBeNull();
      expect(console.error).toHaveBeenCalled();
    });

    it('should handle cache directory creation failure', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock that a file doesn't exist when we check access
      const accessSpy = vi.spyOn(fs, 'access').mockRejectedValueOnce(new Error('Not found'));

      // Mock that mkdir fails when we try to create directory
      const mkdirSpy = vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(new Error('Permission denied'));

      // Don't mock writeFile to fail - let it work normally or not be called at all

      await service.cacheData(
        'TEST',
        '1h',
        'mockSource',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        testData
      );

      expect(console.error).toHaveBeenCalled();

      // Clean up
      accessSpy.mockRestore();
      mkdirSpy.mockRestore();
    });

    it('should clear the cache directory', async () => {
      await service.cacheData(
        'TEST1',
        '1h',
        'mockSource',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        testData
      );
      await service.cacheData(
        'TEST2',
        '1h',
        'mockSource',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        testData
      );

      await service.clearCache();

      const files = await fs.readdir(CACHE_DIR).catch(() => []);
      expect(files).toHaveLength(0);
    });

    it('should handle clearCache when directory does not exist', async () => {
      vi.spyOn(fs, 'readdir').mockRejectedValueOnce({ code: 'ENOENT' } as any);

      await service.clearCache();

      // Test passes if no error is thrown
      expect(true).toBe(true);
    });
  });

  describe('timeframe mapping', () => {
    it('should handle various timeframes correctly', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];

      for (const tf of timeframes) {
        const data = await service.fetchData(
          'SOL',
          tf,
          new Date('2024-01-01'),
          new Date('2024-01-02'),
          'mockSource'
        );
        expect(data).toBeDefined();
        expect(data.length).toBeGreaterThan(0);
      }
    });

    it('should handle unsupported timeframe', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const data = await service.fetchData(
        'SOL',
        'invalid',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        'mockSource'
      );

      expect(data).toBeDefined();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unsupported timeframe'));
    });
  });
});
