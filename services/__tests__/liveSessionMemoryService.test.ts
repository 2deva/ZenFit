import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as memory from '../liveSessionMemoryService';
import { storeMemory } from '../supabaseService';
import { generateEmbedding } from '../embeddingService';
const model = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('../opikGemini', () => ({ ai: { models: model } }));
vi.mock('../supabaseService', () => ({ storeMemory: vi.fn() }));
vi.mock('../embeddingService', () => ({ generateEmbedding: vi.fn(), classifyMemoryType: vi.fn() }));
const transcript = (text: string, isUser = true, isFinal = true) => ({ text, isUser, isFinal, timestamp: Date.now() });
beforeEach(() => { vi.clearAllMocks(); memory.clearSessionBuffer(); vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2]); vi.mocked(storeMemory).mockResolvedValue({ id: 'memory' } as never); vi.spyOn(console, 'log').mockImplementation(() => {}); });
function addSession() { memory.bufferTranscript(transcript('I want to restart my workouts')); memory.bufferTranscript(transcript('I completed a five minute reset')); memory.bufferTranscript(transcript('Let us start small today', false)); }

describe('voice memory extraction', () => {
  it('ignores transient controls and extracts only final meaningful user input', async () => {
    expect(memory.isMeaningfulContent('pause')).toBe(false); expect(memory.isMeaningfulContent('I prefer gentle morning workouts')).toBe(true);
    expect(await memory.extractFromTranscription('user', transcript('I prefer morning workouts', false))).toBeNull();
    expect(await memory.extractFromTranscription('user', transcript('I prefer morning workouts', true, false))).toBeNull();
    expect(await memory.extractFromTranscription('user', transcript('I prefer gentle sessions'), 'breathing')).toMatchObject({ type: 'preference' });
    expect(storeMemory).toHaveBeenCalledWith('user', 'preference', expect.stringContaining('[During breathing]'), [0.1, 0.2], 0.7);
  });
  it.each([
    ['I completed my first workout', 'achievement'], ['I prefer quiet guidance', 'preference'],
    ['I usually exercise in the morning', 'pattern'], ['My goal is consistency', 'conversation'],
  ])('classifies %s', (text, type) => expect(memory.classifyContent(text).type).toBe(type));
  it('preserves transcript fields and bounds recent transcript selection', () => {
    addSession(); expect(memory.getSessionTranscripts(2)).toHaveLength(2); expect(memory.getSessionTranscripts(0)).toEqual([]);
    memory.clearSessionBuffer(); expect(memory.getSessionTranscripts()).toEqual([]);
  });
  it('requires enough conversation before requesting a summary', async () => {
    expect(await memory.generateSessionSummary()).toBeNull(); expect(model.generateContent).not.toHaveBeenCalled();
  });
  it('validates model-provided summary fields before storing memories', async () => {
    addSession(); model.generateContent.mockResolvedValue({ candidates: [{ content: { parts: [{ text: JSON.stringify({ userHighlights: ['Returned today', null], activitiesCompleted: 'not-an-array', memorableQuotes: [42], mood: 'invalid', briefSummary: {} }) }] } }] });
    expect(await memory.generateSessionSummary()).toMatchObject({ userHighlights: ['Returned today'], activitiesCompleted: [], memorableQuotes: [], mood: 'unknown', aiResponses: [''] });
  });
  it('stores concrete session achievements and clears the buffer', async () => {
    addSession(); model.generateContent.mockResolvedValue({ candidates: [{ content: { parts: [{ text: JSON.stringify({ userHighlights: ['Restarted'], activitiesCompleted: ['Five-minute reset'], memorableQuotes: ['I feel motivated'], mood: 'positive', briefSummary: 'Returned to exercise' }) }] } }] });
    expect(await memory.extractAndStoreSessionSummary('user')).toBe(true); expect(storeMemory).toHaveBeenCalledTimes(3); expect(memory.getSessionTranscripts()).toEqual([]);
  });
  it('does not fabricate memories after malformed or failed model output', async () => {
    addSession(); model.generateContent.mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'not-json' }] } }] }); vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await memory.generateSessionSummary()).toBeNull(); model.generateContent.mockRejectedValue(new Error('offline')); expect(await memory.generateSessionSummary()).toBeNull();
    expect(storeMemory).not.toHaveBeenCalled();
  });
  it('detects activity and mood transitions only in user utterances', () => {
    expect(memory.detectContextChange([transcript('I finished the workout')]).needsRefresh).toBe(true);
    expect(memory.detectContextChange([transcript('I am feeling tired')]).needsRefresh).toBe(true);
    expect(memory.detectContextChange([transcript('I finished the workout', false)]).needsRefresh).toBe(false);
  });
});
