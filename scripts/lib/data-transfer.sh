#!/usr/bin/env bash
# Shared helpers for RedShip data export/import scripts.
set -euo pipefail

DT_VERSION=1

dt_die() {
  echo "error: $*" >&2
  exit 1
}

dt_info() {
  echo "info: $*"
}

dt_warn() {
  echo "warn: $*" >&2
}

dt_require_cmd() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || dt_die "required command not found: ${cmd}"
  done
}

dt_compose_project_name() {
  if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then
    echo "$COMPOSE_PROJECT_NAME"
    return 0
  fi

  local name=""
  if [[ -f "${COMPOSE_FILE:-}" ]]; then
    name="$(grep -E '^[[:space:]]*name:[[:space:]]*' "$COMPOSE_FILE" | head -1 \
      | sed -E 's/^[[:space:]]*name:[[:space:]]*//' | tr -d '\r' | xargs || true)"
  fi

  if [[ -n "$name" ]]; then
    echo "$name"
    return 0
  fi

  basename "$DT_REPO_ROOT"
}

dt_compose() {
  docker compose -f "$COMPOSE_FILE" --project-directory "$DT_REPO_ROOT" "$@"
}

dt_volume_full_name() {
  local logical_name="$1"
  echo "$(dt_compose_project_name)_${logical_name}"
}

dt_volume_exists() {
  local full_name="$1"
  docker volume inspect "$full_name" >/dev/null 2>&1
}

dt_list_compose_volumes() {
  dt_compose config --volumes 2>/dev/null | sort -u
}

dt_volume_role() {
  local logical_name="$1"
  case "$logical_name" in
    postgres_data) echo "postgres" ;;
    redis_data) echo "cache_and_checkpoint" ;;
    milvus_data|etcd_data|minio_data) echo "milvus" ;;
    backend_uploads) echo "uploads" ;;
    *) echo "data" ;;
  esac
}

dt_should_export_volume() {
  local logical_name="$1"
  local skip_redis="${2:-false}"
  local skip_uploads="${3:-false}"

  case "$logical_name" in
    redis_data)
      [[ "$skip_redis" == "true" ]] && return 1
      ;;
    backend_uploads)
      [[ "$skip_uploads" == "true" ]] && return 1
      ;;
  esac
  return 0
}

dt_sha256_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  else
    dt_die "sha256sum or shasum required"
  fi
}

dt_tar_volume() {
  local full_name="$1"
  local archive_path="$2"

  dt_volume_exists "$full_name" || dt_die "volume not found: ${full_name}"

  local out_dir
  out_dir="$(dirname "$archive_path")"
  local archive_name
  archive_name="$(basename "$archive_path")"

  docker run --rm \
    -v "${full_name}:/from:ro" \
    -v "${out_dir}:/to" \
    alpine tar czf "/to/${archive_name}" -C /from .
}

dt_untar_volume() {
  local full_name="$1"
  local archive_path="$2"
  local force="${3:-false}"

  [[ -f "$archive_path" ]] || dt_die "archive not found: ${archive_path}"

  if [[ "$force" != "true" ]]; then
    local count
    count="$(dt_volume_entry_count "$full_name")"
    if [[ "$count" -gt 0 ]]; then
      dt_die "volume ${full_name} is not empty (${count} entries); use --force to overwrite"
    fi
  fi

  local bundle_dir archive_name
  bundle_dir="$(dirname "$archive_path")"
  archive_name="$(basename "$archive_path")"

  docker run --rm \
    -v "${full_name}:/to" \
    -v "${bundle_dir}:/from:ro" \
    alpine sh -c 'rm -rf /to/* /to/.[!.]* /to/..?* 2>/dev/null || true; tar xzf "/from/'"${archive_name}"'" -C /to'
}

dt_volume_entry_count() {
  local full_name="$1"
  docker run --rm -v "${full_name}:/vol:ro" alpine \
    sh -c 'find /vol -mindepth 1 -maxdepth 1 2>/dev/null | wc -l' | tr -d '[:space:]'
}

dt_ensure_volumes_exist() {
  local logical_name
  local services=()
  local svc

  for logical_name in "$@"; do
    case "$logical_name" in
      postgres_data) services+=("postgres") ;;
      redis_data) services+=("redis") ;;
      milvus_data) services+=("milvus") ;;
      etcd_data) services+=("etcd") ;;
      minio_data) services+=("minio") ;;
      backend_uploads) services+=("backend") ;;
    esac
  done

  if ((${#services[@]} == 0)); then
    return 0
  fi

  local unique_services=()
  local seen=""
  for svc in "${services[@]}"; do
    if [[ " ${seen} " != *" ${svc} "* ]]; then
      unique_services+=("$svc")
      seen="${seen} ${svc}"
    fi
  done

  dt_info "creating target volumes via compose (services: ${unique_services[*]})"
  dt_compose up -d --no-recreate "${unique_services[@]}" >/dev/null
  dt_compose stop "${unique_services[@]}" >/dev/null || true
}

dt_read_alembic_revision() {
  local user="${POSTGRES_USER:-redship}"
  local db="${POSTGRES_DB:-redship}"
  local revision=""

  if ! dt_compose config --services 2>/dev/null | grep -qx 'postgres'; then
    return 0
  fi

  dt_compose up -d --no-recreate postgres >/dev/null

  local i
  for i in $(seq 1 30); do
    if dt_compose exec -T postgres pg_isready -U "$user" -d "$db" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  revision="$(dt_compose exec -T postgres psql -U "$user" -d "$db" -At \
    -c "SELECT version_num FROM alembic_version LIMIT 1;" 2>/dev/null | tr -d '\r' || true)"

  if [[ -n "$revision" ]]; then
    echo "$revision"
  fi
}

dt_pg_dump_extra() {
  local out_dir="$1"
  local user="${POSTGRES_USER:-redship}"
  local db="${POSTGRES_DB:-redship}"
  local dump_path="${out_dir}/postgres.pg.dump"

  if ! dt_compose config --services 2>/dev/null | grep -qx 'postgres'; then
    return 1
  fi

  dt_compose up -d --no-recreate postgres >/dev/null

  local i
  for i in $(seq 1 30); do
    if dt_compose exec -T postgres pg_isready -U "$user" -d "$db" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  dt_compose exec -T postgres pg_dump -U "$user" -d "$db" -Fc >"$dump_path"
  echo "$dump_path"
}

dt_write_manifest() {
  local out_file="$1"
  python3 - "$out_file" <<'PY'
import json
import sys

out_path = sys.argv[1]
data = json.load(sys.stdin)
with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY
}

dt_stop_all_services() {
  dt_compose stop
}

dt_tar_bibliography() {
  local out_dir="$1"
  local bib_dir="${DT_REPO_ROOT}/bibliography"

  [[ -d "$bib_dir" ]] || return 1

  tar czf "${out_dir}/bibliography.tgz" -C "$DT_REPO_ROOT" bibliography
}

dt_untar_bibliography() {
  local bundle_dir="$1"
  local force="${2:-false}"
  local archive="${bundle_dir}/bibliography.tgz"

  [[ -f "$archive" ]] || return 1

  if [[ "$force" != "true" ]] && [[ -d "${DT_REPO_ROOT}/bibliography" ]]; then
    local count
    count="$(find "${DT_REPO_ROOT}/bibliography" -mindepth 1 2>/dev/null | wc -l | tr -d '[:space:]')"
    if [[ "$count" -gt 0 ]]; then
      dt_die "bibliography/ is not empty (${count} entries); use --force to overwrite"
    fi
  fi

  tar xzf "$archive" -C "$DT_REPO_ROOT"
}
