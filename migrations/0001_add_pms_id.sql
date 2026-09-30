-- Migration: add pms_id column to time_entries
-- Run this against your database to add the missing column
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS pms_id text;
