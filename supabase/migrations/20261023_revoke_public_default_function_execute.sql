-- Remove PostgreSQL's default PUBLIC EXECUTE grant from future functions
-- created by postgres. The schema-scoped revokes are in the companion migration.
-- Existing functions and their explicit grants are unchanged.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
