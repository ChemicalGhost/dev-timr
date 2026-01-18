-- =============================================
-- Dev-Timr Database Schema
-- Migration: 001_create_tables.sql
-- Description: Creates all tables for dev-timr
-- =============================================
-- Run this script on a new Supabase project
-- Execute in: Supabase Dashboard > SQL Editor
-- =============================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- USERS TABLE
-- Stores GitHub user profiles
-- =============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    github_id BIGINT UNIQUE NOT NULL,
    github_username TEXT NOT NULL,
    avatar_url TEXT,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast GitHub ID lookups
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);

-- =============================================
-- REPOS TABLE
-- Stores repository information
-- =============================================
CREATE TABLE IF NOT EXISTS repos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_name TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(owner_name, repo_name)
);

-- Index for fast repo lookups
CREATE INDEX IF NOT EXISTS idx_repos_owner_repo ON repos(owner_name, repo_name);

-- =============================================
-- TASKS TABLE
-- Stores task names for time tracking
-- =============================================
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(repo_id, name)
);

-- Index for fast task lookups by repo
CREATE INDEX IF NOT EXISTS idx_tasks_repo_id ON tasks(repo_id);

-- =============================================
-- SESSIONS TABLE
-- Stores time tracking sessions
-- =============================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    start_time BIGINT NOT NULL,
    end_time BIGINT NOT NULL,
    duration_ms BIGINT GENERATED ALWAYS AS (end_time - start_time) STORED,
    client_id TEXT UNIQUE,  -- For deduplication during sync
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_repo_id ON sessions(repo_id);
CREATE INDEX IF NOT EXISTS idx_sessions_task_id ON sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_sessions_user_repo ON sessions(user_id, repo_id);

-- =============================================
-- UPDATED_AT TRIGGER
-- Automatically updates updated_at on users table
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- VERIFICATION
-- Run this to verify tables were created
-- =============================================
SELECT 
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
AND table_name IN ('users', 'repos', 'tasks', 'sessions')
ORDER BY table_name;
