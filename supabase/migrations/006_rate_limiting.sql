-- =============================================
-- Dev-Timr Rate Limiting
-- Migration: 006_rate_limiting.sql
-- Description: Creates table for rate limit tracking
-- =============================================

-- Create rate limit tracking table
CREATE TABLE IF NOT EXISTS rate_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ip_hash TEXT NOT NULL,           -- SHA256 hash of IP (privacy)
    endpoint TEXT NOT NULL,          -- Which endpoint
    request_count INTEGER DEFAULT 1,
    window_start TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ip_hash, endpoint)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup 
ON rate_limits(ip_hash, endpoint, window_start);

-- Enable RLS
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Service role only (Edge Functions use service role)
CREATE POLICY "Service manages rate limits"
    ON rate_limits FOR ALL
    USING (true)
    WITH CHECK (true);

-- Function to check and update rate limit
-- Returns TRUE if request is allowed, FALSE if rate limited
CREATE OR REPLACE FUNCTION check_rate_limit(
    p_ip_hash TEXT,
    p_endpoint TEXT,
    p_limit INTEGER DEFAULT 60,
    p_window_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER;
    v_window_start TIMESTAMPTZ;
BEGIN
    -- Get current rate limit record
    SELECT request_count, window_start 
    INTO v_count, v_window_start
    FROM rate_limits 
    WHERE ip_hash = p_ip_hash AND endpoint = p_endpoint;
    
    -- If no record or window expired, create/reset
    IF NOT FOUND OR v_window_start < NOW() - (p_window_seconds || ' seconds')::INTERVAL THEN
        INSERT INTO rate_limits (ip_hash, endpoint, request_count, window_start)
        VALUES (p_ip_hash, p_endpoint, 1, NOW())
        ON CONFLICT (ip_hash, endpoint) 
        DO UPDATE SET request_count = 1, window_start = NOW();
        RETURN TRUE;
    END IF;
    
    -- Check if over limit
    IF v_count >= p_limit THEN
        RETURN FALSE;
    END IF;
    
    -- Increment counter
    UPDATE rate_limits 
    SET request_count = request_count + 1
    WHERE ip_hash = p_ip_hash AND endpoint = p_endpoint;
    
    RETURN TRUE;
END;
$$;

-- Cleanup old rate limit entries (run periodically)
CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

SELECT 'Rate limiting table created!' as status;
