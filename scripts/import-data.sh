#!/usr/bin/env bash
# Restore a RedShip export bundle into local Docker Compose volumes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DT_REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=lib/data-transfer.sh
source "${SCRIPT_DIR}/lib/data-transfer.sh"

BUNDLE_DIR=""
COMPOSE_FILE="${DT_REPO_ROOT}/docker-compose.yml"
COMPOSE_PROJECT_NAME=""
FORCE=false
VERIFY=false

usage() {
  cat <<'EOF'
Usage: import-data.sh BUNDLE_DIR [options]

Restore volumes and bibliography from an export bundle.

Arguments:
  BUNDLE_DIR          Directory containing manifest.json and archives

Options:
  -f COMPOSE_FILE     Target compose file (default: docker-compose.yml)
  -p PROJECT_NAME     Compose project name override
  --force             Overwrite non-empty target volumes and bibliography/
  --verify            Verify archive sha256 checksums against manifest.json
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
    -p)
      [[ $# -ge 2 ]] || dt_die "-p requires a project name"
      COMPOSE_PROJECT_NAME="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --verify)
      VERIFY=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      dt_die "unknown option: $1"
      ;;
    *)
      if [[ -z "$BUNDLE_DIR" ]]; then
        BUNDLE_DIR="$1"
        shift
      else
        dt_die "unexpected argument: $1"
      fi
      ;;
  esac
done

[[ -n "$BUNDLE_DIR" ]] || dt_die "BUNDLE_DIR is required"

dt_require_cmd docker python3 tar

if [[ ! -d "$BUNDLE_DIR" ]]; then
  dt_die "bundle directory not found: ${BUNDLE_DIR}"
fi

BUNDLE_DIR="$(cd "$BUNDLE_DIR" && pwd)"
MANIFEST="${BUNDLE_DIR}/manifest.json"
[[ -f "$MANIFEST" ]] || dt_die "manifest not found: ${MANIFEST}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  dt_die "compose file not found: ${COMPOSE_FILE}"
fi

if [[ -f "${DT_REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${DT_REPO_ROOT}/.env"
  set +a
fi

manifest_version="$(python3 - <<PY
import json
with open("${MANIFEST}", encoding="utf-8") as fh:
    data = json.load(fh)
print(data.get("version", ""))
PY
)"

if [[ "$manifest_version" != "$DT_VERSION" ]]; then
  dt_warn "manifest version ${manifest_version} differs from script version ${DT_VERSION}"
fi

milvus_trio=(milvus_data etcd_data minio_data)
present_milvus=()
missing_milvus=()

for name in "${milvus_trio[@]}"; do
  if python3 - <<PY
import json
with open("${MANIFEST}", encoding="utf-8") as fh:
    data = json.load(fh)
names = {item["logical_name"] for item in data.get("volumes", [])}
raise SystemExit(0 if "${name}" in names else 1)
PY
  then
    present_milvus+=("$name")
  else
    missing_milvus+=("$name")
  fi
done

if ((${#present_milvus[@]} > 0 && ${#present_milvus[@]} < 3)); then
  dt_warn "partial Milvus trio in bundle (present: ${present_milvus[*]}; missing: ${missing_milvus[*]})"
fi

target_volumes=()
while IFS= read -r vol; do
  [[ -n "$vol" ]] && target_volumes+=("$vol")
done < <(dt_list_compose_volumes)

if [[ " ${target_volumes[*]} " != *" backend_uploads "* ]]; then
  if python3 - <<PY
import json
with open("${MANIFEST}", encoding="utf-8") as fh:
    data = json.load(fh)
names = {item["logical_name"] for item in data.get("volumes", [])}
raise SystemExit(0 if "backend_uploads" in names else 1)
PY
  then
    dt_warn "bundle includes backend_uploads but target compose has no backend_uploads volume; it will be skipped"
  fi
fi

logical_to_restore=()
while IFS= read -r logical_name; do
  [[ -n "$logical_name" ]] || continue
  logical_to_restore+=("$logical_name")
done < <(python3 - <<PY
import json
with open("${MANIFEST}", encoding="utf-8") as fh:
    data = json.load(fh)
for item in data.get("volumes", []):
    print(item["logical_name"])
PY
)

dt_info "stopping target compose services"
dt_stop_all_services

if ((${#logical_to_restore[@]} > 0)); then
  to_create=()
  for logical_name in "${logical_to_restore[@]}"; do
    skip=false
    for target_vol in "${target_volumes[@]}"; do
      if [[ "$logical_name" == "$target_vol" ]]; then
        skip=true
        break
      fi
    done
    if [[ "$skip" == "true" ]]; then
      to_create+=("$logical_name")
    fi
  done
  if ((${#to_create[@]} > 0)); then
    dt_ensure_volumes_exist "${to_create[@]}"
  fi
fi

restored=0
while IFS=$'\t' read -r logical_name archive expected_sha; do
  [[ -n "$logical_name" ]] || continue

  in_target=false
  for target_vol in "${target_volumes[@]}"; do
    if [[ "$logical_name" == "$target_vol" ]]; then
      in_target=true
      break
    fi
  done

  if [[ "$in_target" != "true" ]]; then
    dt_warn "skipping ${logical_name}: not defined in target compose"
    continue
  fi

  archive_path="${BUNDLE_DIR}/${archive}"
  [[ -f "$archive_path" ]] || dt_die "archive missing: ${archive_path}"

  if [[ "$VERIFY" == "true" ]]; then
    actual_sha="$(dt_sha256_file "$archive_path")"
    if [[ "$actual_sha" != "$expected_sha" ]]; then
      dt_die "sha256 mismatch for ${archive}: expected ${expected_sha}, got ${actual_sha}"
    fi
  fi

  full_name="$(dt_volume_full_name "$logical_name")"
  dt_info "restoring ${logical_name} into ${full_name}"
  dt_untar_volume "$full_name" "$archive_path" "$FORCE"
  restored=$((restored + 1))
done < <(python3 - <<PY
import json
with open("${MANIFEST}", encoding="utf-8") as fh:
    data = json.load(fh)
for item in data.get("volumes", []):
    print("\t".join([
        item["logical_name"],
        item["archive"],
        item.get("sha256", ""),
    ]))
PY
)

if python3 - <<PY
import json
with open("${MANIFEST}", encoding="utf-8") as fh:
    data = json.load(fh)
raise SystemExit(0 if data.get("bibliography") else 1)
PY
then
  if [[ -f "${BUNDLE_DIR}/bibliography.tgz" ]]; then
    if [[ "$VERIFY" == "true" ]]; then
      expected_bib_sha="$(python3 - <<PY
import json
with open("${MANIFEST}", encoding="utf-8") as fh:
    data = json.load(fh)
print(data["bibliography"]["sha256"])
PY
)"
      actual_bib_sha="$(dt_sha256_file "${BUNDLE_DIR}/bibliography.tgz")"
      if [[ "$actual_bib_sha" != "$expected_bib_sha" ]]; then
        dt_die "sha256 mismatch for bibliography.tgz"
      fi
    fi
    dt_info "restoring bibliography/"
    dt_untar_bibliography "$BUNDLE_DIR" "$FORCE"
  else
    dt_warn "manifest lists bibliography but bibliography.tgz is missing"
  fi
fi

dt_info "restore complete: ${restored} volume(s) restored from ${BUNDLE_DIR}"
echo
echo "Next steps:"
echo "  1. Review .env (especially DASHSCOPE_API_KEY and JWT_SECRET)."
echo "  2. Start services: docker compose -f $(basename "$COMPOSE_FILE") up -d"
echo "  3. Do not run alembic upgrade head or full reindex unless you know the volumes are empty."
echo "     Restored volumes already contain schema, data, and Milvus indexes."
