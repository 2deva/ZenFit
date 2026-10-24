import { describe, expect, it, vi } from 'vitest';
import { getFitnessData, getFitnessDataLast7Days } from '../fitnessService';
import { STORAGE_KEYS } from '../../constants/app';
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
describe('fitness data provenance and API boundaries', () => {
  it('labels sample data and makes no request when there is no token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    expect(await getFitnessData()).toMatchObject({ dataSource: 'simulated' });
    expect(await getFitnessDataLast7Days()).toEqual([]); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('marks expired credentials disconnected and clears the cached token', async () => {
    localStorage.setItem(STORAGE_KEYS.FITNESS_TOKEN, 'expired');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({}, 401)); vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getFitnessData()).toMatchObject({ dataSource: 'simulated', connectionStatus: 'disconnected' });
    expect(localStorage.getItem(STORAGE_KEYS.FITNESS_TOKEN)).toBeNull();
  });
  it('maps a real API response, including integer and float measurements', async () => {
    localStorage.setItem(STORAGE_KEYS.FITNESS_TOKEN, 'token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ bucket: [{ dataset: [
      { point: [{ value: [{ intVal: 1234 }] }] }, { point: [{ value: [{ fpVal: 45.6 }] }] }, { point: [{ value: [{ intVal: 12 }] }] },
    ] }] }));
    expect(await getFitnessData()).toMatchObject({ steps: 1234, calories: 46, activeMinutes: 12, dataSource: 'google_fit', connectionStatus: 'connected' });
  });
  it.each([403, 500])('uses explicit sample provenance after HTTP %i', async status => {
    localStorage.setItem(STORAGE_KEYS.FITNESS_TOKEN, 'token'); vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({}, status));
    expect((await getFitnessData()).dataSource).toBe('simulated'); expect(await getFitnessDataLast7Days()).toEqual([]);
  });
  it('filters invalid historical timestamps and maps valid day buckets', async () => {
    localStorage.setItem(STORAGE_KEYS.FITNESS_TOKEN, 'token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ bucket: [
      { startTimeMillis: 'invalid' }, { startTimeMillis: String(Date.UTC(2026, 9, 24)), dataset: [{ point: [{ value: [{ intVal: 100 }] }] }, { point: [{ value: [{ fpVal: 3.7 }] }] }] },
    ] }));
    expect(await getFitnessDataLast7Days()).toEqual([{ date: '2026-10-24', steps: 100, activeMinutes: 4 }]);
  });
});
