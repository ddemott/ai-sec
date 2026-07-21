#!/usr/bin/env bash
# AI COST REPORT — what the voice pipeline is actually costing, from ai_cost_events.
#
# Usage:
#   ./scripts/cost-report.sh                 # local dev DB (postgres@:5433)
#   ./scripts/cost-report.sh --env prod      # prod DB (decrypts the stashed URL)
#   ./scripts/cost-report.sh --days 7        # window (default 30)
#
# The numbers are only as good as src/services/aiCost.ts PRICING — a model with
# no rate records $0 (the 2026-07-21 gpt-4.1-mini blind spot). If a model shows
# up here at $0 with nonzero tokens, add its rate to that map first.
set -euo pipefail

ENV="local"; DAYS=30
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV="$2"; shift 2 ;;
    --days) DAYS="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ "$ENV" == "prod" ]]; then
  MEM="$HOME/.claude/projects/-home-dale-projects-secretary-hq/memory/db_url.enc"
  URL=$(openssl enc -d -aes-256-cbc -pbkdf2 -base64 -pass pass:password -in "$MEM")
  PSQL=(psql "$URL")
else
  PSQL=(env PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres)
fi

echo "=== AI cost — last ${DAYS} days (${ENV}) ==="
WIN="created_at > now() - interval '${DAYS} days'"
"${PSQL[@]}" <<SQL
\echo '\n-- by model --'
SELECT model,
       count(*)                                   AS events,
       sum(input_tokens)                          AS in_tok,
       sum(output_tokens)                         AS out_tok,
       round(sum(estimated_cost_usd)::numeric, 4) AS cost_usd
FROM ai_cost_events WHERE ${WIN}
GROUP BY model ORDER BY cost_usd DESC;

\echo '\n-- per completed call (grouped by call_id) --'
WITH per_call AS (
  SELECT call_id, sum(estimated_cost_usd) AS c
  FROM ai_cost_events WHERE ${WIN} AND call_id LIKE 'room:%'
  GROUP BY call_id
)
SELECT count(*)                     AS calls,
       round(avg(c)::numeric, 4)    AS avg_per_call,
       round(max(c)::numeric, 4)    AS most_expensive,
       round(sum(c)::numeric, 4)    AS total
FROM per_call;

\echo '\n-- by day --'
SELECT date_trunc('day', created_at)::date  AS day,
       round(sum(estimated_cost_usd)::numeric, 4) AS cost_usd
FROM ai_cost_events WHERE ${WIN}
GROUP BY 1 ORDER BY 1 DESC LIMIT 14;

\echo '\n-- monthly projection at sample call volumes (using avg_per_call above) --'
WITH per_call AS (
  SELECT avg(c) AS avg FROM (
    SELECT sum(estimated_cost_usd) AS c FROM ai_cost_events
    WHERE ${WIN} AND call_id LIKE 'room:%' GROUP BY call_id
  ) x
)
SELECT v.calls_per_day,
       round((avg * v.calls_per_day * 30)::numeric, 2) AS projected_monthly_usd
FROM per_call, (VALUES (10),(25),(50),(100)) AS v(calls_per_day);
SQL
