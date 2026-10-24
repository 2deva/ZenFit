import { isRecord } from '../../utils/validation.js';

export interface CalendarEventInput {
  title?: string;
  description?: string;
  startIso?: string;
  durationMinutes?: number;
}

/** Validate before converting dates or making calls to Google. */
export function isCalendarEventInput(input: unknown): input is CalendarEventInput {
  if (!isRecord(input)) return false;
  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500)) return false;
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 10000)) return false;
  if (input.startIso !== undefined && (typeof input.startIso !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.startIso) || !Number.isFinite(Date.parse(input.startIso)))) return false;
  if (input.durationMinutes !== undefined && (typeof input.durationMinutes !== 'number' || !Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0 || input.durationMinutes > 1440)) return false;
  return true;
}
