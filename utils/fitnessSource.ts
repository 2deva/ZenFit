import type { FitnessStats } from '../types';
export function describeFitnessSource(stats: Pick<FitnessStats, 'dataSource' | 'connectionStatus'>): string {
  if (stats.connectionStatus === 'disconnected') return 'Disconnected — reconnect to see real data';
  if (stats.dataSource === 'simulated') return 'Simulated sample data (not measurements)';
  if (stats.dataSource === 'google_fit') return 'Connected';
  return 'Unavailable (source not verified)';
}
