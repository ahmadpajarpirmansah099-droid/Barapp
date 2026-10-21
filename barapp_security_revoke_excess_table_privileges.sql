-- Barapp security hardening
-- Remove DDL-level table privileges that are not required for normal application CRUD.
-- RLS does not protect against TRUNCATE; normal app writes continue to rely on existing RLS policies.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated, anon;

-- Prevent the same unnecessary privileges from being granted automatically to future tables
-- created by the postgres role used for Barapp schema migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated, anon;
