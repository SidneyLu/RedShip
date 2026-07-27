#!/usr/bin/env bash
# Load a RedShip deploy bundle (images + optional data) and start compose.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/lib/data-transfer.sh" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/lib/data-transfer.sh"
elif [[ -f "${SCRIPT_DIR}/../lib/data-transfer.sh" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/../lib/data-transfer.sh"
else
  echo "error: data-transfer.sh not found" >&2
  exit 1
fi

DEPLOY_ROOT=""
FORCE_DATA=false
SKIP_UP=false
VERIFY=false

usage() {
  cat <<'EOF'
Usage: import-deploy.sh [DEPLOY_DIR] [options]

Load images, optionally import data/, ensure .env exists, then compose up.

Arguments:
  DEPLOY_DIR     Path to deploy/ (default: parent of this script)

Options:
  --force-data   Pass --force to import-data.sh
  --verify       Verify data archive checksums
  --skip-up      Do not run compose up
  -h             Help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force-data) FORCE_DATA=true; shift ;;
    --verify) VERIFY=true; shift ;;
    --skip-up) SKIP_UP=true; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) dt_die "unknown option: $1" ;;
    *)
      DEPLOY_ROOT="$1"
      shift
      ;;
  esac
done

dt_require_cmd docker

if [[ -z "$DEPLOY_ROOT" ]]; then
  DEPLOY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
else
  DEPLOY_ROOT="$(cd "$DEPLOY_ROOT" && pwd)"
fi

COMPOSE_FILE="${DEPLOY_ROOT}/docker-compose.yml"
[[ -f "$COMPOSE_FILE" ]] || dt_die "docker-compose.yml not found in ${DEPLOY_ROOT}"

# Make data-transfer helpers resolve bibliography/ relative to deploy root
DT_REPO_ROOT="$DEPLOY_ROOT"
export DT_REPO_ROOT COMPOSE_FILE

dt_info "deploy root: ${DEPLOY_ROOT}"

IMG_GZ="${DEPLOY_ROOT}/images/redship-images.tar.gz"
IMG_TAR="${DEPLOY_ROOT}/images/redship-images.tar"
if [[ -f "$IMG_GZ" ]]; then
  dt_info "docker load ← images/redship-images.tar.gz"
  gunzip -c "$IMG_GZ" | docker load
elif [[ -f "$IMG_TAR" ]]; then
  dt_info "docker load ← images/redship-images.tar"
  docker load -i "$IMG_TAR"
else
  dt_warn "no images archive found; assuming images already loaded"
fi

if [[ ! -f "${DEPLOY_ROOT}/.env" ]]; then
  if [[ -f "${DEPLOY_ROOT}/.env.example" ]]; then
    cp -f "${DEPLOY_ROOT}/.env.example" "${DEPLOY_ROOT}/.env"
    dt_warn "created .env from .env.example — edit secrets before production use"
  else
    dt_die ".env missing and no .env.example"
  fi
fi

if [[ -f "${DEPLOY_ROOT}/data/manifest.json" ]]; then
  dt_info "importing data/ volumes"
  import_args=( "${DEPLOY_ROOT}/data" -f "$COMPOSE_FILE" )
  [[ "$FORCE_DATA" == "true" ]] && import_args+=(--force)
  [[ "$VERIFY" == "true" ]] && import_args+=(--verify)
  bash "${DEPLOY_ROOT}/scripts/import-data.sh" "${import_args[@]}"
else
  dt_info "no data/manifest.json — empty volumes"
  mkdir -p "${DEPLOY_ROOT}/bibliography"
fi

if [[ "$SKIP_UP" == "true" ]]; then
  dt_info "skipping compose up (--skip-up)"
  exit 0
fi

dt_info "starting stack"
(
  cd "$DEPLOY_ROOT"
  docker compose -f docker-compose.yml --project-directory "$DEPLOY_ROOT" up -d
)

echo
echo "Stack started."
echo "  Frontend: http://localhost:8006"
echo "  Backend:  http://localhost:8005/docs"
