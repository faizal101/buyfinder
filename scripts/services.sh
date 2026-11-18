#!/bin/bash
# Manage the local backing services (MongoDB, Redis, Elasticsearch) with Podman or Docker.
#
# Usage: ./scripts/services.sh [up|down|status|logs <name>|nuke]
#   up      start (or create) all containers
#   down    stop all containers (data is kept in named volumes)
#   status  show container status
#   logs    tail logs of one service (mongo | redis | elastic)
#   nuke    remove containers AND their data volumes
#
# Uses podman if available, otherwise docker. Override with CONTAINER_ENGINE=docker (or podman).

set -euo pipefail

# Podman installed from the official pkg lives here and may not be on PATH
if [ -d /opt/podman/bin ]; then export PATH="/opt/podman/bin:$PATH"; fi

if [ -n "${CONTAINER_ENGINE:-}" ]; then
  ENGINE="$CONTAINER_ENGINE"
elif command -v podman >/dev/null 2>&1; then
  ENGINE=podman
elif command -v docker >/dev/null 2>&1; then
  ENGINE=docker
else
  echo "Neither podman nor docker found. Install one of them first."; exit 1
fi

PREFIX=buyfinder

MONGO_IMAGE=docker.io/library/mongo:7
REDIS_IMAGE=docker.io/library/redis:7-alpine
# Keep the major/minor in sync with the @elastic/elasticsearch client version
ELASTIC_IMAGE=docker.elastic.co/elasticsearch/elasticsearch:8.17.4

ensure_engine () {
  if $ENGINE info >/dev/null 2>&1; then return; fi

  if [ "$ENGINE" = podman ] && [ "$(uname)" != "Linux" ]; then
    echo "Starting podman machine..."
    podman machine start
  else
    echo "Can't reach $ENGINE. Is the daemon running (e.g. Docker Desktop)?"; exit 1
  fi
}

run_or_start () {
  local name="$PREFIX-$1"; shift

  # `container inspect` works on both engines (podman also has `container exists`, docker doesn't)
  if $ENGINE container inspect "$name" >/dev/null 2>&1; then
    $ENGINE start "$name" >/dev/null
  else
    $ENGINE run -d --name "$name" "$@" >/dev/null
  fi

  echo "  $name up"
}

case "${1:-up}" in
  up)
    ensure_engine

    run_or_start mongo -p 27017:27017 -v $PREFIX-mongo:/data/db "$MONGO_IMAGE"
    run_or_start redis -p 6379:6379 -v $PREFIX-redis:/data "$REDIS_IMAGE" redis-server --appendonly yes
    run_or_start elastic -p 9200:9200 -v $PREFIX-elastic:/usr/share/elasticsearch/data \
      -e discovery.type=single-node \
      -e xpack.security.enabled=false \
      -e ES_JAVA_OPTS="-Xms1g -Xmx1g" \
      "$ELASTIC_IMAGE"

    echo -n "Waiting for Elasticsearch"
    for _ in $(seq 1 60); do
      if curl -fs http://localhost:9200/_cluster/health >/dev/null 2>&1; then echo " ready"; exit 0; fi
      echo -n "."; sleep 2
    done
    echo " timed out (check: $0 logs elastic)"; exit 1
    ;;
  down)
    $ENGINE stop "$PREFIX-mongo" "$PREFIX-redis" "$PREFIX-elastic" 2>/dev/null || true
    ;;
  status)
    $ENGINE ps -a --filter "name=$PREFIX-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    ;;
  logs)
    $ENGINE logs -f --tail 100 "$PREFIX-${2:?usage: $0 logs mongo|redis|elastic}"
    ;;
  nuke)
    $ENGINE rm -f "$PREFIX-mongo" "$PREFIX-redis" "$PREFIX-elastic" 2>/dev/null || true
    $ENGINE volume rm "$PREFIX-mongo" "$PREFIX-redis" "$PREFIX-elastic" 2>/dev/null || true
    ;;
  *)
    echo "Usage: $0 [up|down|status|logs <name>|nuke]"; exit 1
    ;;
esac
