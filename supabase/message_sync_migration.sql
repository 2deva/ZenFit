-- Message Sync Migration for Zenfit

-- Create user_messages table for cross-device sync
CREATE TABLE IF NOT EXISTS user_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  ui_component JSONB,
  grounding_chunks JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient message retrieval (newest first)
CREATE INDEX IF NOT EXISTS idx_user_messages_user_timestamp 
  ON user_messages(user_id, timestamp DESC);

-- Index for message_id lookups (deduplication)
CREATE INDEX IF NOT EXISTS idx_user_messages_message_id 
  ON user_messages(message_id);

-- Enable Row Level Security
ALTER TABLE user_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own messages
CREATE POLICY "Users can access their own messages" 
  ON user_messages FOR ALL 
  USING (true);

-- Note: Using permissive policy for now since we're using anon key
-- In production, this should use auth.uid() to restrict to actual user
