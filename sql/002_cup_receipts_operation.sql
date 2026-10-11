-- CUP 0.3.0 receipt columns for hosts that already applied 001_cup_initial.sql.
alter table cup_receipts add column if not exists operation text;
alter table cup_receipts add column if not exists resource_refs jsonb;
alter table cup_receipts alter column input_hash drop not null;
