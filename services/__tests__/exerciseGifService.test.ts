import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = [
  { id: 'Squat', name: 'Squat', images: ['Squat/0.jpg', 'Squat/1.jpg'] },
  { id: 'Curl', name: 'Dumbbell Curl', images: ['Curl/0.jpg'], equipment: 'dumbbell' },
  { id: 'NoImage', name: 'Silent move', images: [] },
];
const key = 'zen_exercise_db_cache_v1';
beforeEach(() => { vi.resetModules(); localStorage.clear(); });
const service = () => import('../exerciseGifService');
const fetchData = (value: unknown = fixture) => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(value)));
describe('exercise database network and cache boundary', () => {
  it('deduplicates concurrent fetches and resolves plural names and exact images', async () => {
    const fetch = fetchData(); const s = await service();
    const [a, b] = await Promise.all([s.getExercisePool(), s.getExerciseGifUrl('squats')]);
    expect(a).toHaveLength(3); expect(b).toEqual(expect.arrayContaining([expect.stringContaining('/Squat/0.jpg')]));
    expect(fetch).toHaveBeenCalledTimes(1); expect(await s.getExerciseGifUrl('Squat')).toHaveLength(2);
    expect(await s.getExerciseGifUrl('squats')).toEqual(b); expect(JSON.parse(localStorage.getItem(key)!).data).toHaveLength(3);
  });
  it('uses fresh cached data without a network request', async () => {
    localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data: fixture })); const fetch = fetchData([]);
    const s = await service(); expect(await s.getExercisePool()).toEqual(fixture); expect(fetch).not.toHaveBeenCalled();
  });
  it('falls back to stale data during a network outage', async () => {
    localStorage.setItem(key, JSON.stringify({ timestamp: 1, data: fixture })); vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await (await service()).getExercisePool()).toEqual(fixture);
  });
  it('fails safely on HTTP errors, malformed storage, and malformed responses then retries', async () => {
    localStorage.setItem(key, '{broken'); const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response('{}')).mockImplementation(async () => new Response(JSON.stringify(fixture)));
    const s = await service(); expect(await s.getExercisePool()).toEqual([]); expect(await s.getExercisePool()).toEqual([]);
    expect(await s.getExercisePool()).toEqual(fixture); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('rejects malformed entries and image paths outside the exercise directory', async () => {
    fetchData([null, { id: 'bad', name: 'Bad', images: ['../secret'] }, { id: 'missing', images: [] }, ...fixture]);
    expect(await (await service()).getExercisePool()).toEqual(fixture);
  });
  it('matches overlapping exercise words while declining unrelated and image-less matches', async () => {
    fetchData(); const s = await service(); expect(await s.getExerciseGifUrl('curl dumbbells')).toEqual([expect.stringContaining('/Curl/0.jpg')]);
    expect(await s.getExerciseGifUrl('quantum flying')).toBeNull(); expect(await s.getExerciseGifUrl('Silent move')).toBeNull(); expect(await s.getExerciseGifUrl('')).toBeNull();
    const names = await s.getSupportedExerciseNames(); expect(names).toContain('Squat'); expect(names).toContain('Push-ups'); expect(await s.getSupportedExerciseNames()).toBe(names);
  });
});
