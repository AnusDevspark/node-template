#!/bin/bash
# Runs once, on first initialisation of the Postgres data volume.
#
# Creates the dedicated test database. The integration suite truncates every
# table between runs, so it must never be pointed at the development database —
# giving it its own database from the start removes that footgun entirely.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  SELECT 'CREATE DATABASE app_test'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'app_test')\gexec
EOSQL

echo "test database 'app_test' ensured"
