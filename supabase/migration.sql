-- ============================================
-- Zenfit Database Migration
-- ============================================

-- Enable the pgvector extension for semantic memory
CREATE EXTENSION IF NOT EXISTS vector;

-- Users table (synced from Firebase Auth)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT UNIQUE NOT NULL,
  name TEXT,
  email TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User goals (Tier 2 memory)
CREATE TABLE IF NOT EXISTS user_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  goal_type TEXT NOT NULL,
  goal_label TEXT NOT NULL,
  motivation TEXT,
  target_value NUMERIC,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workout sessions (Tier 2 memory)
CREATE TABLE IF NOT EXISTS workout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  workout_type TEXT,
  duration_seconds INTEGER,
  completed BOOLEAN DEFAULT false,
  exercises JSONB,
  mood_before TEXT,
  mood_after TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habit streaks (Tier 2 memory)
CREATE TABLE IF NOT EXISTS habit_streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  habit_type TEXT NOT NULL,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_activity_date DATE,
  break_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User memories with embeddings (Tier 3 - semantic memory)
CREATE TABLE IF NOT EXISTS user_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(768),
  importance_score FLOAT DEFAULT 0.5,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scheduled events (Calendar integration)
CREATE TABLE IF NOT EXISTS scheduled_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  google_event_id TEXT,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Google integrations (server-side OAuth tokens for Google APIs)
CREATE TABLE IF NOT EXISTS google_integrations (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  scope TEXT,
  calendar_enabled BOOLEAN DEFAULT true,
  fit_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_user_goals_user_id ON user_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_user_goals_active ON user_goals(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_id ON workout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_habit_streaks_user_id ON habit_streaks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_user_id ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_events_user_id ON scheduled_events(user_id);
CREATE INDEX IF NOT EXISTS idx_google_integrations_user ON google_integrations(user_id);

-- Create HNSW index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_user_memories_embedding ON user_memories 
  USING hnsw (embedding vector_cosine_ops);

-- Function for semantic memory search
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding VECTOR(768),
  match_threshold FLOAT,
  match_count INT,
  p_user_id UUID
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    user_memories.id,
    user_memories.content,
    1 - (user_memories.embedding <=> query_embedding) as similarity
  FROM user_memories
  WHERE user_memories.user_id = p_user_id
    AND user_memories.embedding IS NOT NULL
    AND 1 - (user_memories.embedding <=> query_embedding) > match_threshold
  ORDER BY user_memories.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_integrations ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (using anon key)
-- Note: In production, these should be more restrictive
CREATE POLICY "Allow all operations" ON users FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON user_goals FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON workout_sessions FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON habit_streaks FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON user_memories FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON scheduled_events FOR ALL USING (true);
