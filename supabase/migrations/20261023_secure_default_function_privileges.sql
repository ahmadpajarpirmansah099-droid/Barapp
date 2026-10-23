-- Secure future RPCs by default.
-- Existing functions are unchanged; application RPCs must explicitly GRANT EXECUTE
-- to the roles that genuinely need them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
