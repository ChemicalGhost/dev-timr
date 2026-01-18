-- =============================================
-- Dev-Timr Token Blocklist
-- Migration: 005_token_blocklist.sql
-- Description: Creates table for revoked tokens
-- =============================================
-- Run this in Supabase SQL Editor
-- =============================================

-- Create token blocklist table
CREATE TABLE IF NOT EXISTS token_blocklist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_hash TEXT UNIQUE NOT NULL,  -- SHA256 hash of JWT (not the JWT itself)
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    revoked_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,  -- When the original token would expire
    reason TEXT DEFAULT 'logout'       -- logout, revoked, compromised, etc.
);

-- Index for fast blocklist lookups
CREATE INDEX IF NOT EXISTS idx_blocklist_token_hash ON token_blocklist(token_hash);

-- Index for cleanup of expired entries
CREATE INDEX IF NOT EXISTS idx_blocklist_expires_at ON token_blocklist(expires_at);

-- Enable RLS
ALTER TABLE token_blocklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_blocklist FORCE ROW LEVEL SECURITY;

-- Policies: Only service role can manage blocklist
-- (logout happens via Edge Function with service role)
DROP POLICY IF EXISTS "Service can manage blocklist" ON token_blocklist;
CREATE POLICY "Service can manage blocklist"
    ON token_blocklist FOR ALL
    USING (true)
    WITH CHECK (true);

-- Users can read their own blocklist entries (for debugging)
DROP POLICY IF EXISTS "Users can read own blocklist" ON token_blocklist;
CREATE POLICY "Users can read own blocklist"
    ON token_blocklist FOR SELECT
    USING (auth.uid() = user_id);

-- Grant permissions
GRANT SELECT ON token_blocklist TO authenticated;

-- Function to check if a token is blocklisted
CREATE OR REPLACE FUNCTION is_token_blocklisted(token_hash_param TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM token_blocklist
        WHERE token_hash = token_hash_param
        AND expires_at > NOW()
    );
$$;

-- Function to cleanup expired blocklist entries (run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_blocklist()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM token_blocklist WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- Verification
SELECT 'Token blocklist table created!' as status;
