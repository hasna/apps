CREATE ROLE open_loops_owner NOLOGIN;
CREATE ROLE open_loops_migrator NOLOGIN NOBYPASSRLS;
CREATE ROLE open_loops_runtime NOLOGIN NOBYPASSRLS;
CREATE ROLE open_loops_authenticator NOLOGIN NOBYPASSRLS;

CREATE ROLE loops_migrator LOGIN PASSWORD 'loops-migrator' NOBYPASSRLS;
CREATE ROLE loops_runtime LOGIN PASSWORD 'loops-runtime' NOBYPASSRLS;

GRANT open_loops_owner, open_loops_migrator, open_loops_authenticator
  TO loops_migrator WITH ADMIN OPTION;
GRANT open_loops_runtime TO loops_runtime;

ALTER DATABASE loops OWNER TO loops_migrator;
GRANT CONNECT ON DATABASE loops TO loops_runtime;
