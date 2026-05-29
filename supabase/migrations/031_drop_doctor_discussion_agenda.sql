-- Migration 031: drop doctor_discussion_agenda table (discussion feature retired)
-- Run in Supabase SQL Editor.

drop table if exists public.doctor_discussion_agenda;
