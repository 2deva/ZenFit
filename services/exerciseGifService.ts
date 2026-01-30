/**
 * Resolves exercise demonstration images via the open-source free-exercise-db.
 * Source: https://github.com/yuhonas/free-exercise-db
 * 
 * Provides start and end position images that can be toggled to create an animation.
 */

const DB_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const IMAGE_BASE_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

interface ExerciseEntry {
    id: string;
    name: string;
    images: string[];
    // Other fields (mechanic, force, etc.) omitted as we only need images
}

let dbCache: ExerciseEntry[] | null = null;
let fetchPromise: Promise<ExerciseEntry[]> | null = null;

/** Cache getExerciseGifUrl results by normalized name so repeat views (e.g. back to previous exercise) are instant. */
const resultCache = new Map<string, string[] | null>();

/** Cache for getSupportedExerciseNames so we don't rebuild the array on every Gemini message. */
let supportedNamesCache: string[] | null = null;

// Normalize string for comparison: lowercase, remove special chars, normalize spaces
function normalize(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Fetches the exercise database (cached in memory).
 */
async function getDatabase(): Promise<ExerciseEntry[]> {
    if (dbCache) return dbCache;
    if (fetchPromise) return fetchPromise;

    fetchPromise = fetch(DB_URL)
        .then(res => {
            if (!res.ok) throw new Error('Failed to fetch exercise DB');
            return res.json();
        })
        .then(data => {
            dbCache = data;
            fetchPromise = null;
            return data;
        })
        .catch(err => {
            console.error('Error loading exercise database:', err);
            fetchPromise = null;
            return [];
        });

    return fetchPromise;
}

const MANUAL_MAPPINGS: Record<string, string> = {
    "cat-cow": "cat stretch", 
    "cat cow": "cat stretch",
    "cat-cow stretch": "cat stretch",
    "squats": "squat",
    "push-ups": "push-up",
    "pushups": "push-up",
    "jumping jacks": "jumping jack", 
    "plank": "forearm plank", // Common default
    "lunges": "lunge",
    "burpees": "burpee",
    "crunches": "crunch",
    "sit-ups": "sit-up",
    "situps": "sit-up",
};

// Generic words that shouldn't contribute to the match score significantly
const STOP_WORDS = new Set([
    'stretch', 'exercise', 'movement', 'position', 
    'dumbbell', 'barbell', 'kettlebell', 'cable', 'machine', 'band',
    'seated', 'standing', 'lying', 'alternating', 'alternative',
    'with', 'and', 'to', 'for', 'of', 'in', 'on', 'at'
]);

/**
 * Calculates Jaccard Similarity between two sets of tokens.
 * Range: 0 (no overlap) to 1 (identical).
 */
function calculateJaccardScore(targetName: string, dbName: string): number {
    // Helper: rudimentary stemmer (singularize)
    const stem = (w: string) => w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w;

    // 1. Tokenize and clean
    const tokenize = (str: string) => str.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2)
        .map(stem); // Apply stemming

    const targetTokens = new Set(tokenize(targetName));
    const dbTokens = new Set(tokenize(dbName));

    // 2. Filter out stop words (unless it's the only word)
    const filterTokens = (tokens: Set<string>) => {
        const filtered = new Set([...tokens].filter(t => !STOP_WORDS.has(t)));
        return filtered.size > 0 ? filtered : tokens; // Fallback to original if all are stop words
    };

    const tFiltered = filterTokens(targetTokens);
    const dFiltered = filterTokens(dbTokens);

    // 3. Calculate Intersection and Union
    let intersection = 0;
    for (const token of tFiltered) {
        if (dFiltered.has(token)) intersection++;
    }

    const union = new Set([...tFiltered, ...dFiltered]).size;
    return union === 0 ? 0 : intersection / union;
}

/**
 * Finds exercise images for a given exercise name.
 * Returns an array of image URLs (start and end frames) or null if not found.
 */
export async function getExerciseGifUrl(exerciseName: string): Promise<string[] | null> {
    if (!exerciseName) return null;

    const key = normalize(exerciseName);
    const cached = resultCache.get(key);
    if (cached !== undefined) return cached;

    const db = await getDatabase();
    if (!db || db.length === 0) return null;

    const normalizedInput = normalize(exerciseName);

    let result: string[] | null = null;

    // 1. Check Manual Mappings
    if (MANUAL_MAPPINGS[normalizedInput]) {
        const mappedName = MANUAL_MAPPINGS[normalizedInput];
        const mappedMatch = db.find(e => normalize(e.name) === normalize(mappedName));
        if (mappedMatch && mappedMatch.images.length > 0) {
            result = mappedMatch.images.map(img => `${IMAGE_BASE_URL}${img}`);
        }
    }

    // 2. Exact Match (Normalized)
    if (!result) {
        const exactMatch = db.find(e => normalize(e.name) === normalizedInput);
        if (exactMatch && exactMatch.images.length > 0) {
            result = exactMatch.images.map(img => `${IMAGE_BASE_URL}${img}`);
        }
    }

    // 3. Fuzzy Match using Jaccard Score
    if (!result) {
        const searchName = MANUAL_MAPPINGS[normalizedInput] || exerciseName;
        let bestMatch: ExerciseEntry | null = null;
        let bestScore = 0;
        for (const ex of db) {
            const score = calculateJaccardScore(searchName, ex.name);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = ex;
            }
        }
        if (bestMatch && bestScore >= 0.4 && bestMatch.images.length > 0) {
            result = bestMatch.images.map(img => `${IMAGE_BASE_URL}${img}`);
        }
    }

    resultCache.set(key, result);
    return result;
}

/**
 * Returns a list of all supported exercise names (DB names + manual mapping keys in display form).
 * Cached after first load. Used for AI context so Gemini can suggest names we can resolve (e.g. "Push-up" or "Push-ups").
 */
export async function getSupportedExerciseNames(): Promise<string[]> {
    if (supportedNamesCache) return supportedNamesCache;

    const db = await getDatabase();
    if (!db) return [];

    const dbNames = db.map(e => e.name);
    const dbNamesNormalized = new Set(dbNames.map(n => normalize(n)));
    const mappingKeysDisplay = Object.keys(MANUAL_MAPPINGS)
        .filter(k => !dbNamesNormalized.has(normalize(k)))
        .map(k => k.charAt(0).toUpperCase() + k.slice(1));
    supportedNamesCache = Array.from(new Set([...dbNames, ...mappingKeysDisplay]));
    return supportedNamesCache;
}
