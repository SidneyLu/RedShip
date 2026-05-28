#!/usr/bin/env bash
# Export RedShip Docker volumes and bibliography into a portable bundle.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DT_REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=lib/data-transfer.sh
source "${SCRIPT_DIR}/lib/data-transfer.sh"

COMPOSE_FILE="${DT_REPO_ROOT}/docker-compose.yml"
COMPOSE_PROJECT_NAME=""
OUTPUT_DIR=""
SKIP_REDIS=false
SKIP_BIBLIOGRAPHY=false
SKIP_UPLOADS=false
NO_PG_DUMP=false

usage() {
  cat <<'EOF'
Usage: export-data.sh [options]

Export Docker Compose volumes and bibliography/ into a timestamped bundle.

Options:
  -f COMPOSE_FILE     Compose file (default: docker-compose.yml)
  -o OUTPUT_DIR       Output directory (default: ./export/redship-YYYYMMDD-HHMMSS)
  -p PROJECT_NAME     Compose project name override
  --skip-redis        Exclude redis_data volume
  --skip-bibliography Exclude bibliography/ directory
  --skip-uploads      Exclude backend_uploads volume
  --no-pg-dump        Skip optional postgres.pg.dump sidecar
  -h                  Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f)
      [[ $# -ge 2 ]] || dt_die "-f requires a compose file path"
      COMPOSE_FILE="$2"
      shift 2
      ;;
    -o)
      [[ $# -ge 2 ]] || dt_die "-o requires an output directory path"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    -p)
      [[ $# -ge 2 ]] || dt_die "-p requires a project name"
      COMPOSE_PROJECT_NAME="$2"
      shift 2
      ;;
    --skip-redis)
      SKIP_REDIS=true
      shift
      ;;
    --skip-bibliography)
      SKIP_BIBLIOGRAPHY=true
      shift
      ;;
    --skip-uploads)
      SKIP_UPLOADS=true
      shift
      ;;
    --no-pg-dump)
      NO_PG_DUMP=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      dt_die "unknown argument: $1"
      ;;
  esac
done

dt_require_cmd docker python3 tar

if [[ ! -f "$COMPOSE_FILE" ]]; then
  dt_die "compose file not found: ${COMPOSE_FILE}"
fi

if [[ -f "${DT_REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${DT_REPO_ROOT}/.env"
  set +a
fi

if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="${DT_REPO_ROOT}/export/redship-$(date +%Y%m%d-%H%M%S)"
fi

mkdir -p "$OUTPUT_DIR"

project_name="$(dt_compose_project_name)"
compose_basename="$(basename "$COMPOSE_FILE")"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

dt_info "export bundle: ${OUTPUT_DIR}"
dt_info "compose file: ${compose_basename} (project: ${project_name})"

# Stop writers before reading postgres metadata, but keep postgres available.
for svc in backend frontend; do
  if dt_compose config --services 2>/dev/null | grep -qx "$svc"; then
    dt_compose stop "$svc" >/dev/null 2>&1 || true
  fi
done

alembic_revision=""
if dt_compose config --services 2>/dev/null | grep -qx 'postgres'; then
  alembic_revision="$(dt_read_alembic_revision || true)"
  if [[ -n "$alembic_revision" ]]; then
    dt_info "alembic revision: ${alembic_revision}"
  else
    dt_warn "could not read alembic_version (empty database or postgres unavailable)"
  fi
fi

pg_dump_path=""
if [[ "$NO_PG_DUMP" != "true" ]] && dt_compose config --services 2>/dev/null | grep -qx 'postgres'; then
  dt_info "writing optional postgres.pg.dump sidecar"
  pg_dump_path="$(dt_pg_dump_extra "$OUTPUT_DIR")"
fi

dt_info "stopping all compose services"
dt_stop_all_services

volumes_json="[]"
while IFS= read -r logical_name; do
  [[ -n "$logical_name" ]] || continue

  if ! dt_should_export_volume "$logical_name" "$SKIP_REDIS" "$SKIP_UPLOADS"; then
    dt_info "skipping volume: ${logical_name}"
    continue
  fi

  full_name="$(dt_volume_full_name "$logical_name")"
  archive_name="${logical_name}.tgz"
  archive_path="${OUTPUT_DIR}/${archive_name}"

  if ! dt_volume_exists "$full_name"; then
    dt_warn "volume missing, skipping: ${full_name}"
    continue
  fi

  dt_info "archiving volume ${logical_name} from ${full_name}"
  dt_tar_volume "$full_name" "$archive_path"
  sha256="$(dt_sha256_file "$archive_path")"
  role="$(dt_volume_role "$logical_name")"

  volumes_json="$(python3 - <<PY
import json
items = json.loads('''${volumes_json}''')
items.append({
    "logical_name": "${logical_name}",
    "archive": "${archive_name}",
    "sha256": "${sha256}",
    "role": "${role}",
})
print(json.dumps(items))
PY
)"
done < <(dt_list_compose_volumes)

bibliography_json="null"
if [[ "$SKIP_BIBLIOGRAPHY" != "true" ]]; then
  if dt_tar_bibliography "$OUTPUT_DIR"; then
    bib_sha256="$(dt_sha256_file "${OUTPUT_DIR}/bibliography.tgz")"
    bibliography_json="$(python3 - <<PY
import json
print(json.dumps({"archive": "bibliography.tgz", "sha256": "${bib_sha256}"}))
PY
)"
    dt_info "archived bibliography/"
  else
    dt_warn "bibliography/ not found; skipping"
  fi
else
  dt_info "skipping bibliography/ (--skip-bibliography)"
fi

has_pg_dump="false"
if [[ -n "$pg_dump_path" && -f "$pg_dump_path" ]]; then
  has_pg_dump="true"
fi

python3 - <<PY | dt_write_manifest "${OUTPUT_DIR}/manifest.json"
import json

manifest = {
    "version": ${DT_VERSION},
    "created_at": "${created_at}",
    "compose_file": "${compose_basename}",
    "project_name": "${project_name}",
    "alembic_revision": ${json.dumps(alembic_revision or None)},
    "volumes": json.loads('''${volumes_json}'''),
    "bibliography": json.loads('''${bibliography_json}'''),
    "extras": {
        "postgres_pg_dump": "postgres.pg.dump" if "${has_pg_dump}" == "true" else None,
    },
}
print(json.dumps(manifest))
PY

volume_count="$(python3 - <<PY
import json
print(len(json.loads('''${volumes_json}''')))
PY
)"

dt_info "export complete: ${volume_count} volume archive(s) in ${OUTPUT_DIR}"
echo
echo "Import on the target machine with:"
echo "  ./scripts/import-data.sh \"${OUTPUT_DIR}\" -f docker-compose.yml"
echo
echo "Services were stopped and were not restarted automatically."
