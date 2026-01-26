
import { FitnessStats } from "../types";
import { STORAGE_KEYS } from "../constants/app";

/**
 * SIMULATED DATA GENERATOR
 * Generates realistic data based on the time of day so the app feels "live"
 * even without a real Google Fit connection in this demo environment.
 */
const getSimulatedStats = (): FitnessStats => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const currentMs = now.getTime();
  const msPassed = currentMs - startOfDay;

  // Simulation logic:
  // Average person walks ~3000-5000 steps by mid-day.
  // We'll map time passed to a step curve with some randomness.

  // 1. Base steps: Time dependent (approx 1000 steps per 2 hours awake)
  // Assume waking up at 7AM (25200000ms from midnight)
  const wakeTime = 7 * 60 * 60 * 1000;
  let activeTime = Math.max(0, msPassed - wakeTime);

  // Steps rate: ~800 steps/hour active
  let baseSteps = Math.floor((activeTime / (1000 * 60 * 60)) * 800);

  // Add variance based on "User Activity" (random seed per hour)
  const variance = Math.floor(Math.random() * 200);

  const steps = Math.max(150, baseSteps + variance); // Minimum 150 morning steps
  const stepsGoal = 10000;

  // Calories: BMR (~1500) + Active Burn
  // BMR prorated for time of day
  const bmrPerMs = 1500 / (24 * 60 * 60 * 1000);
  const bmrBurn = Math.floor(msPassed * bmrPerMs);
  const activeBurn = Math.floor(steps * 0.045);
  const calories = bmrBurn + activeBurn;

  // Active Minutes: Roughly 1 min per 100 steps
  const activeMinutes = Math.floor(steps / 110);

  return {
    steps,
    calories,
    activeMinutes,
    stepsGoal
  };
};

/**
 * Fetches fitness data. 
 * First checks if a Google Fit token exists (real mode).
 * If not, falls back to the simulation (demo mode).
 */
export const getFitnessData = async (): Promise<FitnessStats> => {
  const token = localStorage.getItem(STORAGE_KEYS.FITNESS_TOKEN);

  if (token) {
    try {
      return await fetchGoogleFitData(token);
    } catch (error) {
      console.warn("Google Fit fetch failed, falling back to simulation", error);
      return getSimulatedStats();
    }
  }

  return getSimulatedStats();
};

/**
 * Real Google Fit REST API Implementation
 * This requires a valid OAuth2 Access Token with scope: 
 * https://www.googleapis.com/auth/fitness.activity.read
 */
const fetchGoogleFitData = async (token: string): Promise<FitnessStats> => {
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startTimeMillis = startOfDay.getTime();

  const response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      aggregateBy: [
        { dataTypeName: "com.google.step_count.delta" },
        { dataTypeName: "com.google.calories.expended" },
        { dataTypeName: "com.google.heart_minutes" }
      ],
      bucketByTime: { durationMillis: 86400000 }, // 1 day bucket
      startTimeMillis,
      endTimeMillis: now
    })
  });

  if (!response.ok) {
    throw new Error('Failed to fetch from Google Fit');
  }

  const data = await response.json();
  const bucket = data.bucket?.[0]?.dataset;

  // Safe extraction helper
  const getValue = (index: number) => {
    return bucket?.[index]?.point?.[0]?.value?.[0]?.intVal ||
      bucket?.[index]?.point?.[0]?.value?.[0]?.fpVal || 0;
  };

  return {
    steps: Math.round(getValue(0)),
    calories: Math.round(getValue(1)),
    activeMinutes: Math.round(getValue(2)),
    stepsGoal: 10000 // Could be fetched from a goals endpoint too
  };
};
