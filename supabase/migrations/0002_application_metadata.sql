-- Columns used by application persistence; no customer records are removed.
ALTER TABLE public.workout_sessions ADD COLUMN IF NOT EXISTS goal_ids UUID[];
ALTER TABLE public.user_messages ADD COLUMN IF NOT EXISTS message_context TEXT;
ALTER TABLE public.user_messages ADD COLUMN IF NOT EXISTS related_workout_id TEXT;

-- Fail on invalid existing data instead of silently replacing or deleting it.
ALTER TABLE public.workout_sessions DROP CONSTRAINT IF EXISTS workout_duration_nonnegative;
ALTER TABLE public.workout_sessions ADD CONSTRAINT workout_duration_nonnegative
  CHECK (duration_seconds IS NULL OR duration_seconds >= 0);
ALTER TABLE public.workout_progress DROP CONSTRAINT IF EXISTS workout_active_index_nonnegative;
ALTER TABLE public.workout_progress ADD CONSTRAINT workout_active_index_nonnegative CHECK (active_idx >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_messages_identity ON public.user_messages(user_id, message_id);
