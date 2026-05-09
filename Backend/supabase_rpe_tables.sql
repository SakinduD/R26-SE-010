-- ============================================================
-- RPE Supabase Tables
-- Run this once in your Supabase SQL Editor (Database → SQL Editor)
-- ============================================================

-- Sessions table
CREATE TABLE IF NOT EXISTS rpe_sessions (
    session_id        TEXT        PRIMARY KEY,
    scenario_id       TEXT        NOT NULL,
    user_id           TEXT        NOT NULL,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at          TIMESTAMPTZ,
    outcome           TEXT,                          -- 'success' | 'failure' | NULL
    final_trust       INTEGER,
    final_escalation  INTEGER,
    end_reason        TEXT,                          -- 'trust_sustained' | 'npc_exit' | 'max_turns_reached'
    recommended_turns INTEGER,
    max_turns         INTEGER,
    opening_npc_line  TEXT,
    emotion_history   JSONB       NOT NULL DEFAULT '["calm"]'::jsonb,
    trust_history     JSONB       NOT NULL DEFAULT '[50]'::jsonb
);

-- Turns table
CREATE TABLE IF NOT EXISTS rpe_turns (
    id                BIGSERIAL   PRIMARY KEY,
    session_id        TEXT        NOT NULL REFERENCES rpe_sessions(session_id) ON DELETE CASCADE,
    turn              INTEGER     NOT NULL,
    user_input        TEXT        NOT NULL DEFAULT '',
    npc_response      TEXT        NOT NULL DEFAULT '',
    emotion           TEXT        NOT NULL DEFAULT 'calm',
    trust_score       INTEGER     NOT NULL DEFAULT 50,
    escalation_level  INTEGER     NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast per-session turn lookups
CREATE INDEX IF NOT EXISTS idx_rpe_turns_session_id ON rpe_turns(session_id);
CREATE INDEX IF NOT EXISTS idx_rpe_turns_session_turn ON rpe_turns(session_id, turn);
