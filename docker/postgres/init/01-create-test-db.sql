-- ---------------------------------------------------------------------------
-- Content Platform — local PostgreSQL initialization.
--
-- This script runs only when the postgres_data volume is empty (i.e. on
-- the very first `docker compose up`).
--
-- It creates the test database used by the integration test suite
-- (TEST_DATABASE_URL). The main database (content_platform) is created by
-- the official image's POSTGRES_DB environment variable.
--
-- Both databases share the same user (`content`) and password, so the
-- DATABASE_URL and TEST_DATABASE_URL differ only in the database name.
-- ---------------------------------------------------------------------------

CREATE DATABASE content_platform_test
    OWNER content
    ENCODING 'UTF8'
    LC_COLLATE 'C'
    LC_CTYPE 'C'
    TEMPLATE template0;
