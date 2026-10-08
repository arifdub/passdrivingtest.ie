#!/usr/bin/env bash
#
# Apply every migration to a throwaway Postgres and check the rules actually
# hold. Run it before handing anyone a paste.
#
#   sql/test/run.sh
#
# WHY THIS EXISTS
#
# Three migrations in a row were handed over with a defect in them — a
# function whose return type could not be replaced, a `create table if not
# exists` that silently adopted somebody else's table, and an exclusion
# constraint over an expression Postgres will not index. Every one of them
# would have been caught by applying the file once. None of them were,
# because there was nowhere to apply it: there are no database credentials
# in this environment and production is the only Postgres anyone had.
#
# There is a Postgres in this container. There was all along.
#
# WHAT IT IS NOT
#
# It is not Supabase. baseline.sql stubs auth.users, auth.uid() and
# auth.role(), which is enough to exercise the schema, the triggers and the
# functions, but RLS here is enforced against a superuser who bypasses it.
# A policy that is wrong will not necessarily fail here. The triggers, the
# constraints and the security definer functions — which is where this
# project's rules actually live — are tested properly.
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=${PGDIR:-/var/tmp/pdt-sqltest}
PORT=${PGPORT:-5433}
HERE="$(cd "$(dirname "$0")" && pwd)"
SQL="$(dirname "$HERE")"

if [ ! -d "$DIR/data" ]; then
  echo "→ starting a throwaway Postgres in $DIR"
  rm -rf "$DIR"; mkdir -p "$DIR"
  # initdb refuses to run as root, so an unprivileged owner is made for it.
  if [ "$(id -u)" = "0" ]; then
    id pgtest >/dev/null 2>&1 || useradd -M pgtest
    chown -R pgtest "$DIR"
    SU="su pgtest -s /bin/bash -c"
  else
    SU="bash -c"
  fi
  $SU "$PGBIN/initdb -D $DIR/data -U postgres --auth=trust" >/dev/null
  $SU "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c listen_addresses=' -l $DIR/log start" >/dev/null
  sleep 2
fi

q() { psql -h "$DIR" -p "$PORT" -U postgres "$@"; }

apply() { # apply <db> <file...>
  local db=$1; shift
  q -q -c "drop database if exists $db;" -c "create database $db;" >/dev/null 2>&1
  q -d "$db" -q -v ON_ERROR_STOP=1 -f "$HERE/baseline.sql" >/dev/null
  for f in "$@"; do
    if [ "${f:0:5}" = "EXEC:" ]; then q -d "$db" -q -c "${f:5}" >/dev/null; continue; fi
    out=$(q -d "$db" -v ON_ERROR_STOP=1 --single-transaction -f "$f" 2>&1) || true
    if echo "$out" | grep -q "^psql.*ERROR"; then
      echo "  ✗ $(basename "$f")"; echo "$out" | grep -A2 ERROR | head -6; return 1
    fi
  done
  echo "  ✓ $*" | tr '\n' ' ' | cut -c1-110; echo
}

CHAIN=("$SQL"/0[2-9]*.sql "$SQL"/1[0-5]*.sql)

echo "1. every file in order"
apply chain "${CHAIN[@]}"

echo "2. every file again, over itself (idempotent)"
apply twice "${CHAIN[@]}" "${CHAIN[@]}"

echo "3. RUN-PENDING on a fresh database, twice"
apply pending "$SQL"/02*.sql "$SQL"/03*.sql "$SQL"/RUN-PENDING.sql "$SQL"/RUN-PENDING.sql

echo "4. RUN-NEXT over 04-11, with an empty stray bookings table in the way"
apply next "$SQL"/0[2-9]*.sql "$SQL"/1[01]*.sql \
  "EXEC:create table public.bookings (id serial primary key, note text);" \
  "$SQL"/RUN-NEXT.sql

echo "5. a stray bookings table WITH rows — must refuse and keep the data"
q -q -c "drop database if exists guarded;" -c "create database guarded;" >/dev/null 2>&1
q -d guarded -q -f "$HERE/baseline.sql" >/dev/null 2>&1
for f in "$SQL"/0[2-9]*.sql "$SQL"/1[01]*.sql; do
  q -d guarded -q -v ON_ERROR_STOP=1 --single-transaction -f "$f" >/dev/null 2>&1
done
q -d guarded -q -c "create table public.bookings (id serial primary key, note text);
                    insert into public.bookings (note) values ('real data');" >/dev/null
if q -d guarded -v ON_ERROR_STOP=1 --single-transaction -f "$SQL"/RUN-NEXT.sql >/dev/null 2>&1; then
  echo "  ✗ it should have refused"; exit 1
fi
kept=$(q -d guarded -tAc "select note from public.bookings;")
[ "$kept" = "real data" ] && echo "  ✓ refused, and the data is untouched" || { echo "  ✗ DATA LOST"; exit 1; }

echo "6. the documented way out: rename the old table, then migrate"
# The real shape found in production — an older public booking form keyed on
# a slot, with rows in it. The advice given was to rename rather than drop,
# so that advice is tested: the migration must succeed, and not one of those
# rows may go missing. Renaming does not rename a table's indexes, so this
# also proves the old bookings_pkey does not collide with the new one.
q -q -c "drop database if exists renamed;" -c "create database renamed;" >/dev/null 2>&1
q -d renamed -q -f "$HERE/baseline.sql" >/dev/null 2>&1
for f in "$SQL"/0[2-9]*.sql "$SQL"/1[01]*.sql; do
  q -d renamed -q -v ON_ERROR_STOP=1 --single-transaction -f "$f" >/dev/null 2>&1
done
q -d renamed -q >/dev/null 2>&1 <<'EOSQL'
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid, lesson_type text, full_name text, email text, phone text,
  created_at timestamptz default now()
);
insert into public.bookings (full_name, email, lesson_type)
select 'learner ' || n, 'l' || n || '@example.ie', '1hr' from generate_series(1,4) n;
alter table public.bookings rename to bookings_old_form;
EOSQL
if out=$(q -d renamed -v ON_ERROR_STOP=1 --single-transaction -f "$SQL"/RUN-NEXT.sql 2>&1) && ! echo "$out" | grep -q "^psql.*ERROR"; then
  kept=$(q -d renamed -tAc "select count(*) from public.bookings_old_form;")
  cols=$(q -d renamed -tAc "select count(*) from information_schema.columns where table_name='bookings';")
  if [ "$kept" = "4" ] && [ "$cols" -gt 10 ]; then
    echo "  ✓ migrated, and all 4 old rows are still there"
  else
    echo "  ✗ kept=$kept cols=$cols"; exit 1
  fi
else
  echo "  ✗ the rename path does not work"; echo "$out" | grep -A2 ERROR | head -6; exit 1
fi

echo "7. the rules themselves — booking races, hours, notice, reviews, messages"
out=$(q -d chain -f "$HERE/scenario.sql" 2>&1 || true)
pass=$(printf '%s' "$out" | grep -c "PASS " || true)
fail=$(printf '%s' "$out" | grep -c "FAIL " || true)
# A count of passes is checked as well as a count of failures: a scenario
# that silently stopped running halfway would otherwise report zero failures
# and look green.
if [ "$fail" = "0" ] && [ "$pass" -ge 44 ]; then
  echo "  ✓ $pass checks, none failed"
else
  echo "  ✗ $pass passed, $fail failed"
  printf '%s' "$out" | grep -E "FAIL |ERROR" | head -20
  exit 1
fi

echo
echo "all green"
