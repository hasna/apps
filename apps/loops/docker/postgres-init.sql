CREATE ROLE open_loops_owner NOLOGIN;
CREATE ROLE open_loops_migrator NOLOGIN NOBYPASSRLS;
CREATE ROLE open_loops_runtime NOLOGIN NOBYPASSRLS;
CREATE ROLE open_loops_authenticator NOLOGIN NOBYPASSRLS;

CREATE ROLE loops_runtime LOGIN PASSWORD 'loops-runtime' NOBYPASSRLS;
CREATE ROLE loops_authenticator LOGIN PASSWORD 'loops-authenticator' NOBYPASSRLS;

GRANT open_loops_runtime TO loops_runtime;
GRANT open_loops_authenticator TO loops_authenticator;

GRANT CONNECT ON DATABASE loops TO loops_runtime, loops_authenticator;
