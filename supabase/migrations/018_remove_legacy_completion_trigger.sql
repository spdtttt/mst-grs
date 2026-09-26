begin;

-- The history-table workflow superseded the completion-term workflow.
-- Some existing installations retain this trigger after schedule term columns
-- were removed, causing every approval to completed to fail.
-- Retain legacy columns and their data to preserve history table compatibility.
drop trigger if exists stamp_completion_term on public.grade_records;
drop function if exists public.stamp_completion_term();

commit;
