-- =============================================
-- Dev-Timr RLS Verification Script
-- Migration: 003_verify_rls.sql
-- Description: Verifies RLS is properly configured
-- =============================================
-- Run this to audit your RLS configuration
-- Execute in: Supabase Dashboard > SQL Editor
-- =============================================

-- =============================================
-- CHECK 1: RLS ENABLED ON ALL TABLES
-- =============================================
SELECT 
    '1. RLS STATUS' as check_name,
    '' as details
UNION ALL
SELECT 
    '   ' || tablename as check_name,
    CASE 
        WHEN rowsecurity THEN '✅ RLS Enabled'
        ELSE '❌ RLS DISABLED - SECURITY RISK!'
    END as details
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('users', 'repos', 'tasks', 'sessions')
ORDER BY check_name;

-- =============================================
-- CHECK 2: LIST ALL POLICIES
-- =============================================
SELECT 
    tablename as table_name,
    policyname as policy_name,
    permissive as is_permissive,
    roles as applies_to,
    cmd as operation,
    CASE 
        WHEN qual IS NOT NULL THEN 'Has USING clause'
        ELSE 'No USING clause'
    END as using_clause,
    CASE 
        WHEN with_check IS NOT NULL THEN 'Has WITH CHECK'
        ELSE 'No WITH CHECK'
    END as with_check_clause
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('users', 'repos', 'tasks', 'sessions')
ORDER BY tablename, policyname;

-- =============================================
-- CHECK 3: EXPECTED POLICIES CHECKLIST
-- =============================================
WITH expected_policies AS (
    SELECT 'users' as tbl, 'Users can read own data' as policy UNION ALL
    SELECT 'users', 'Users can read teammates' UNION ALL
    SELECT 'users', 'Users can update own data' UNION ALL
    SELECT 'users', 'Service can insert users' UNION ALL
    SELECT 'repos', 'Anyone can read repos' UNION ALL
    SELECT 'repos', 'Authenticated users can create repos' UNION ALL
    SELECT 'tasks', 'Anyone can read tasks' UNION ALL
    SELECT 'tasks', 'Authenticated users can create tasks' UNION ALL
    SELECT 'sessions', 'Users can read own sessions' UNION ALL
    SELECT 'sessions', 'Users can read team sessions' UNION ALL
    SELECT 'sessions', 'Users can insert own sessions'
),
actual_policies AS (
    SELECT tablename as tbl, policyname as policy
    FROM pg_policies
    WHERE schemaname = 'public'
)
SELECT 
    e.tbl as table_name,
    e.policy as expected_policy,
    CASE 
        WHEN a.policy IS NOT NULL THEN '✅ Found'
        ELSE '❌ MISSING!'
    END as status
FROM expected_policies e
LEFT JOIN actual_policies a ON e.tbl = a.tbl AND e.policy = a.policy
ORDER BY e.tbl, e.policy;

-- =============================================
-- CHECK 4: SUMMARY
-- =============================================
SELECT 
    'SUMMARY' as category,
    '' as detail
UNION ALL
SELECT 
    'Tables with RLS' as category,
    COUNT(*)::text || ' of 4' as detail
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('users', 'repos', 'tasks', 'sessions')
AND rowsecurity = true
UNION ALL
SELECT 
    'Total Policies' as category,
    COUNT(*)::text as detail
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('users', 'repos', 'tasks', 'sessions')
UNION ALL
SELECT 
    'Expected Policies' as category,
    '11' as detail;

-- =============================================
-- CHECK 5: SECURITY WARNINGS
-- =============================================
SELECT 
    '⚠️ SECURITY WARNINGS' as warning_type,
    '' as message
WHERE EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename IN ('users', 'repos', 'tasks', 'sessions')
    AND rowsecurity = false
)
UNION ALL
SELECT 
    'Table without RLS' as warning_type,
    tablename as message
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('users', 'repos', 'tasks', 'sessions')
AND rowsecurity = false;
