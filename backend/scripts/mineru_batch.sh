#!/usr/bin/env bash
# Batch-convert PDF/DOCX under /input → Markdown under /output (bibliography layout).
set -euo pipefail

INPUT_DIR="${INPUT_DIR:-/input}"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
BACKEND="${MINERU_BACKEND:-pipeline}"
TIMEOUT="${MINERU_TIMEOUT_SECONDS:-600}"

shopt -s nullglob globstar

if ! command -v mineru >/dev/null 2>&1; then
  echo "error: mineru CLI not found" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
shopt -s globstar
mapfile -t SOURCES < <(find "$INPUT_DIR" -type f \( -iname '*.pdf' -o -iname '*.docx' \) | sort)

if ((${#SOURCES[@]} == 0)); then
  echo "no PDF/DOCX files under ${INPUT_DIR}"
  exit 0
fi

echo "MinerU batch: backend=${BACKEND} files=${#SOURCES[@]}"

for src in "${SOURCES[@]}"; do
  rel="${src#"${INPUT_DIR}/"}"
  base="${rel%.*}"
  tmp_out="$(mktemp -d "/tmp/mineru_${base//\//_}.XXXXXX")"
  echo "→ ${rel}"

  if ! timeout "${TIMEOUT}" mineru -p "$src" -o "$tmp_out" -b "$BACKEND"; then
    echo "  failed: ${rel}" >&2
    rm -rf "$tmp_out"
    exit 1
  fi

  md_file="$(find "$tmp_out" -type f -name '*.md' -printf '%s %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
  if [[ -z "${md_file}" ]]; then
    md_file="$(find "$tmp_out" -type f -name '*.md' | head -1)"
  fi
  if [[ -z "${md_file}" || ! -f "${md_file}" ]]; then
    echo "  no markdown output for ${rel}" >&2
    rm -rf "$tmp_out"
    exit 1
  fi

  dest="${OUTPUT_DIR}/${base}.md"
  mkdir -p "$(dirname "$dest")"
  cp "$md_file" "$dest"
  echo "  wrote ${dest}"
  rm -rf "$tmp_out"
done

echo "done: ${#SOURCES[@]} file(s) → ${OUTPUT_DIR}"
