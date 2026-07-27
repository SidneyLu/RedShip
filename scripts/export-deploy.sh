#!/usr/bin/env bash
# Full RedShip deploy export: production images + compose skeleton (+ optional data).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=lib/data-transfer.sh
source "${SCRIPT_DIR}/lib/data-transfer.sh"

COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
OUTPUT_DIR=""
WITH_DATA=false
SKIP_BUILD=false
SKIP_IMAGES=false
GZIP_IMAGES=true
NO_FINAL_TAR=false

usage() {
  cat <<'EOF'
Usage: export-deploy.sh [options]

Build production images (compose file only, no override), docker-save them,
and pack a server deploy bundle under ./export/.

Options:
  -o OUTPUT_DIR     Output dir (default: ./export/redship-deploy-YYYYMMDD-HHMMSS)
  -f COMPOSE_FILE   Production compose file (default: docker-compose.yml)
  --with-data       Also run export-data.sh into deploy/data/
  --skip-build      Do not rebuild; use existing local images
  --skip-images     Config-only bundle (no docker save)
  --no-gzip         Save images as .tar instead of .tar.gz
  --no-final-tar    Do not create sibling redship-deploy-*.tar.gz
  -h                Help

Example:
  ./scripts/export-deploy.sh --with-data
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      [[ $# -ge 2 ]] || dt_die "-o requires a path"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    -f)
      [[ $# -ge 2 ]] || dt_die "-f requires a compose file path"
      COMPOSE_FILE="$2"
      shift 2
      ;;
    --with-data) WITH_DATA=true; shift ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --skip-images) SKIP_IMAGES=true; shift ;;
    --no-gzip) GZIP_IMAGES=false; shift ;;
    --no-final-tar) NO_FINAL_TAR=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) dt_die "unknown argument: $1" ;;
  esac
done

dt_require_cmd docker python3 tar gzip

[[ -f "$COMPOSE_FILE" ]] || dt_die "compose file not found: ${COMPOSE_FILE}"

if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="${REPO_ROOT}/export/redship-deploy-$(date +%Y%m%d-%H%M%S)"
fi

DEPLOY_DIR="${OUTPUT_DIR}/deploy"
IMAGES_DIR="${DEPLOY_DIR}/images"
mkdir -p "$DEPLOY_DIR" "$IMAGES_DIR" \
  "${DEPLOY_DIR}/scripts/lib" \
  "${DEPLOY_DIR}/backend" \
  "${DEPLOY_DIR}/frontend"

created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMPOSE_PROJECT_NAME=""
export COMPOSE_FILE
DT_REPO_ROOT="$REPO_ROOT"
export DT_REPO_ROOT
project_name="$(dt_compose_project_name)"

dt_info "deploy export → ${OUTPUT_DIR}"
dt_info "compose: ${COMPOSE_FILE} (project: ${project_name})"

# --- Production build (ignore override by using -f only) ---
if [[ "$SKIP_IMAGES" != "true" && "$SKIP_BUILD" != "true" ]]; then
  dt_info "building production images (NEXT_PUBLIC_API_BASE_URL empty)"
  (
    cd "$REPO_ROOT"
    export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-}"
    docker compose -f "$COMPOSE_FILE" --project-directory "$REPO_ROOT" build backend frontend
  )
elif [[ "$SKIP_IMAGES" != "true" ]]; then
  dt_info "skipping image build (--skip-build)"
fi

BACKEND_IMAGE="${project_name}-backend:latest"
FRONTEND_IMAGE="${project_name}-frontend:latest"
if ! docker image inspect "$BACKEND_IMAGE" >/dev/null 2>&1; then
  BACKEND_IMAGE="redship-backend:latest"
fi
if ! docker image inspect "$FRONTEND_IMAGE" >/dev/null 2>&1; then
  FRONTEND_IMAGE="redship-frontend:latest"
fi

THIRD_PARTY_IMAGES=(
  "postgres:17-alpine"
  "redis:7-alpine"
  "milvusdb/milvus:v2.5.4"
  "bitnami/etcd:3.5"
  "minio/minio:RELEASE.2024-08-03T04-33-23Z"
)

IMAGE_LIST=()
images_archive=""
images_sha=""

if [[ "$SKIP_IMAGES" != "true" ]]; then
  for img in "$BACKEND_IMAGE" "$FRONTEND_IMAGE" "${THIRD_PARTY_IMAGES[@]}"; do
    if ! docker image inspect "$img" >/dev/null 2>&1; then
      dt_warn "pulling missing image: ${img}"
      docker pull "$img"
    fi
    IMAGE_LIST+=("$img")
  done

  if [[ "$GZIP_IMAGES" == "true" ]]; then
    images_archive="images/redship-images.tar.gz"
    dt_info "docker save → ${images_archive} (${#IMAGE_LIST[@]} images; may take several minutes)"
    docker save "${IMAGE_LIST[@]}" | gzip -c > "${DEPLOY_DIR}/${images_archive}"
  else
    images_archive="images/redship-images.tar"
    dt_info "docker save → ${images_archive} (${#IMAGE_LIST[@]} images; may take several minutes)"
    docker save "${IMAGE_LIST[@]}" -o "${DEPLOY_DIR}/${images_archive}"
  fi
  images_sha="$(dt_sha256_file "${DEPLOY_DIR}/${images_archive}")"
  dt_info "images sha256: ${images_sha}"
else
  dt_info "skipping docker save (--skip-images)"
fi

# --- Runtime compose: pin app services to saved image tags (no build on server) ---
EXPORT_COMPOSE_SRC="$COMPOSE_FILE" \
EXPORT_COMPOSE_DST="${DEPLOY_DIR}/docker-compose.yml" \
EXPORT_BACKEND_IMAGE="$BACKEND_IMAGE" \
EXPORT_FRONTEND_IMAGE="$FRONTEND_IMAGE" \
python3 - <<'PY'
from pathlib import Path
import os
import re

text = Path(os.environ["EXPORT_COMPOSE_SRC"]).read_text(encoding="utf-8")
pins = {
    "backend": os.environ["EXPORT_BACKEND_IMAGE"],
    "frontend": os.environ["EXPORT_FRONTEND_IMAGE"],
}

def pin_body(body: str, image: str) -> str:
    body = re.sub(
        r"(?m)^([ \t]+)build:\s*\n(?:\1[ \t].*\n)*",
        "",
        body,
    )
    if re.search(r"(?m)^[ \t]+image:\s*", body):
        return re.sub(
            r"(?m)^([ \t]+)image:\s*.*$",
            rf"\1image: {image}",
            body,
            count=1,
        )
    return f"    image: {image}\n" + body

for name, image in pins.items():
    pattern = rf"(?ms)^(  {name}:\s*\n)(.*?)(?=^  \w[\w-]*:\s*\n|^volumes:\s*\n|\Z)"

    def _repl(m, _image=image):
        return m.group(1) + pin_body(m.group(2), _image)

    text, n = re.subn(pattern, _repl, text, count=1)
    if n != 1:
        raise SystemExit(f"failed to pin service '{name}' in compose")

Path(os.environ["EXPORT_COMPOSE_DST"]).write_text(text, encoding="utf-8")
print("wrote runtime compose with image pins:", ", ".join(f"{k}={v}" for k, v in pins.items()))
PY

[[ -f "${REPO_ROOT}/.env.example" ]] && cp -f "${REPO_ROOT}/.env.example" "${DEPLOY_DIR}/.env.example"

# Dockerfiles (rebuild reference; not required when images are loaded)
[[ -f "${REPO_ROOT}/backend/Dockerfile" ]] && cp -f "${REPO_ROOT}/backend/Dockerfile" "${DEPLOY_DIR}/backend/Dockerfile"
[[ -f "${REPO_ROOT}/frontend/Dockerfile" ]] && cp -f "${REPO_ROOT}/frontend/Dockerfile" "${DEPLOY_DIR}/frontend/Dockerfile"

cp -f "${SCRIPT_DIR}/import-data.sh" "${DEPLOY_DIR}/scripts/import-data.sh"
cp -f "${SCRIPT_DIR}/lib/data-transfer.sh" "${DEPLOY_DIR}/scripts/lib/data-transfer.sh"
cp -f "${SCRIPT_DIR}/import-deploy.sh" "${DEPLOY_DIR}/scripts/import-deploy.sh"
chmod +x "${DEPLOY_DIR}/scripts/import-data.sh" "${DEPLOY_DIR}/scripts/import-deploy.sh"

# Empty bibliography mount point (data import may fill it)
mkdir -p "${DEPLOY_DIR}/bibliography"
touch "${DEPLOY_DIR}/bibliography/.gitkeep"

# --- Optional runtime data ---
data_rel=""
if [[ "$WITH_DATA" == "true" ]]; then
  data_rel="data"
  dt_info "exporting volumes + bibliography into deploy/data/"
  "${SCRIPT_DIR}/export-data.sh" -f "$COMPOSE_FILE" -o "${DEPLOY_DIR}/data"
fi

cat > "${DEPLOY_DIR}/README-DEPLOY.md" <<'EOF'
# RedShip 服务器部署包

由 `scripts/export-deploy.sh`（或 `export-deploy.ps1`）生成。

## 要求

- Docker Engine + Compose v2
- CPU 架构 **linux/amd64**（与导出机一致）
- **不要**放 `docker-compose.override.yml`（开发热重载）

## 步骤

```bash
# 1) 解压后进入 deploy/
cd deploy

# 2) 一键导入并启动
./scripts/import-deploy.sh .

# 或手动：
# gunzip -c images/redship-images.tar.gz | docker load
# cp .env.example .env   # 填写 DASHSCOPE_API_KEY、JWT_SECRET 等
# ./scripts/import-data.sh ./data -f docker-compose.yml --force   # 若有 data/
# docker compose -f docker-compose.yml up -d
```

## 端口

| 服务 | 端口 |
|------|------|
| frontend | 8006 |
| backend | 8005 |

## 说明

- 包内 **不含** `.env` 密钥；首次会从 `.env.example` 生成
- 无 `data/` 时启动空库；文献可放在 `./bibliography/`
- 已加载镜像时无需 `node_modules` / 源码构建
- 生产务必更换默认密钥
EOF

# manifest
IMAGE_JSON="$(printf '%s\n' "${IMAGE_LIST[@]+"${IMAGE_LIST[@]}"}" | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')"
EXPORT_MANIFEST_DIR="$OUTPUT_DIR" \
EXPORT_CREATED_AT="$created_at" \
EXPORT_PROJECT_NAME="$project_name" \
EXPORT_IMAGES_ARCHIVE="$images_archive" \
EXPORT_IMAGES_SHA="$images_sha" \
EXPORT_IMAGE_JSON="$IMAGE_JSON" \
EXPORT_BACKEND_IMAGE="$BACKEND_IMAGE" \
EXPORT_FRONTEND_IMAGE="$FRONTEND_IMAGE" \
EXPORT_DATA_REL="$data_rel" \
python3 - <<'PY'
import json
import os
from pathlib import Path

archive = os.environ.get("EXPORT_IMAGES_ARCHIVE") or None
sha = os.environ.get("EXPORT_IMAGES_SHA") or None
data_rel = os.environ.get("EXPORT_DATA_REL") or ""

manifest = {
    "version": 1,
    "kind": "redship-deploy",
    "created_at": os.environ["EXPORT_CREATED_AT"],
    "compose_file": "docker-compose.yml",
    "project_name": os.environ["EXPORT_PROJECT_NAME"],
    "images": {
        "archive": archive,
        "sha256": sha,
        "list": json.loads(os.environ["EXPORT_IMAGE_JSON"]),
        "backend": os.environ["EXPORT_BACKEND_IMAGE"],
        "frontend": os.environ["EXPORT_FRONTEND_IMAGE"],
    },
    "data": {"path": "data"} if data_rel == "data" else None,
}
Path(os.environ["EXPORT_MANIFEST_DIR"]).joinpath("deploy-manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print("wrote deploy-manifest.json")
PY

if [[ "$NO_FINAL_TAR" != "true" ]]; then
  parent="$(dirname "$OUTPUT_DIR")"
  base="$(basename "$OUTPUT_DIR")"
  archive_path="${parent}/${base}.tar.gz"
  dt_info "packing → ${archive_path}"
  tar -C "$parent" -czf "$archive_path" "$base"
  echo
  echo "Done."
  echo "  Dir:     ${OUTPUT_DIR}"
  echo "  Archive: ${archive_path}"
  echo "  SHA256:  $(dt_sha256_file "$archive_path")"
else
  echo
  echo "Done."
  echo "  Dir: ${OUTPUT_DIR}"
fi

echo
echo "Server:"
echo "  tar xzf <archive> && cd <dir>/deploy"
echo "  ./scripts/import-deploy.sh ."
