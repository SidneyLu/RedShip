# Full RedShip deploy export for Windows (Docker Desktop + PowerShell).
# Mirrors scripts/export-deploy.sh.
param(
  [string]$OutputDir = "",
  [string]$ComposeFile = "",
  [switch]$WithData,
  [switch]$SkipBuild,
  [switch]$SkipImages,
  [switch]$NoGzip,
  [switch]$NoFinalTar
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $ComposeFile) { $ComposeFile = Join-Path $RepoRoot "docker-compose.yml" }
if (-not (Test-Path $ComposeFile)) { throw "compose not found: $ComposeFile" }

if (-not $OutputDir) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutputDir = Join-Path $RepoRoot "export\redship-deploy-$stamp"
}

$DeployDir = Join-Path $OutputDir "deploy"
$ImagesDir = Join-Path $DeployDir "images"
New-Item -ItemType Directory -Force -Path @(
  $DeployDir, $ImagesDir,
  (Join-Path $DeployDir "scripts\lib"),
  (Join-Path $DeployDir "backend"),
  (Join-Path $DeployDir "frontend")
) | Out-Null

Write-Host "info: deploy export → $OutputDir"

$projectName = "redship"
$composeText = Get-Content -Raw -Path $ComposeFile
if ($composeText -match '(?m)^\s*name:\s*(\S+)') {
  $projectName = $Matches[1].Trim()
}

# Build production images without override
if (-not $SkipImages -and -not $SkipBuild) {
  Write-Host "info: building production images"
  $env:NEXT_PUBLIC_API_BASE_URL = ""
  Push-Location $RepoRoot
  try {
    docker compose -f $ComposeFile --project-directory $RepoRoot build backend frontend
    if ($LASTEXITCODE -ne 0) { throw "docker compose build failed" }
  } finally {
    Pop-Location
  }
}

$backendImg = "${projectName}-backend:latest"
$frontendImg = "${projectName}-frontend:latest"
docker image inspect $backendImg 1>$null 2>$null
if ($LASTEXITCODE -ne 0) { $backendImg = "redship-backend:latest" }
docker image inspect $frontendImg 1>$null 2>$null
if ($LASTEXITCODE -ne 0) { $frontendImg = "redship-frontend:latest" }

$third = @(
  "postgres:17-alpine",
  "redis:7-alpine",
  "milvusdb/milvus:v2.5.4",
  "bitnami/etcd:3.5",
  "minio/minio:RELEASE.2024-08-03T04-33-23Z"
)
$images = @($backendImg, $frontendImg) + $third

$imagesArchive = $null
$imagesSha = $null
if (-not $SkipImages) {
  foreach ($img in $images) {
    docker image inspect $img 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "warn: pulling $img"
      docker pull $img
      if ($LASTEXITCODE -ne 0) { throw "docker pull failed: $img" }
    }
  }
  if ($NoGzip) {
    $imagesArchive = "images/redship-images.tar"
    $outPath = Join-Path $DeployDir ($imagesArchive -replace "/", "\")
    Write-Host "info: docker save → $imagesArchive"
    docker save @images -o $outPath
    if ($LASTEXITCODE -ne 0) { throw "docker save failed" }
  } else {
    $imagesArchive = "images/redship-images.tar.gz"
    $outPath = Join-Path $DeployDir ($imagesArchive -replace "/", "\")
    $tarPath = Join-Path $ImagesDir "redship-images.tar"
    Write-Host "info: docker save → temp tar then gzip (large; wait)"
    docker save @images -o $tarPath
    if ($LASTEXITCODE -ne 0) { throw "docker save failed" }
    $in = [System.IO.File]::OpenRead($tarPath)
    $out = [System.IO.File]::Create($outPath)
    $gzip = New-Object System.IO.Compression.GZipStream($out, [System.IO.Compression.CompressionMode]::Compress)
    try {
      $in.CopyTo($gzip)
    } finally {
      $gzip.Dispose()
      $out.Dispose()
      $in.Dispose()
    }
    Remove-Item $tarPath -Force
  }
  $sha = Get-FileHash -Algorithm SHA256 -Path (Join-Path $DeployDir ($imagesArchive -replace "/", "\"))
  $imagesSha = $sha.Hash.ToLower()
  Write-Host "info: images sha256: $imagesSha"
}

# Runtime compose: pin app services to saved image tags
$runtimeCompose = $composeText
foreach ($pair in @(
  @{ Name = "backend"; Image = $backendImg },
  @{ Name = "frontend"; Image = $frontendImg }
)) {
  $name = $pair.Name
  $image = $pair.Image
  $pattern = "(?ms)(  ${name}:\r?\n)(.*?)(?=\r?\n  \w[\w-]*:\r?\n|\r?\nvolumes:\r?\n)"
  $runtimeCompose = [regex]::Replace($runtimeCompose, $pattern, {
    param($m)
    $header = $m.Groups[1].Value
    $body = $m.Groups[2].Value
    $body = [regex]::Replace($body, "(?m)^([ \t]+)build:\s*\r?\n(?:\1[ \t]+.*\r?\n)*", "")
    if ($body -match "(?m)^[ \t]+image:\s*") {
      $body = [regex]::Replace($body, "(?m)^([ \t]+)image:\s*.*$", "`${1}image: $image", 1)
    } else {
      $body = "    image: $image`n" + $body
    }
    return $header + $body
  })
}
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText(
  (Join-Path $DeployDir "docker-compose.yml"),
  $runtimeCompose,
  $utf8NoBom
)

$envExample = Join-Path $RepoRoot ".env.example"
if (Test-Path $envExample) {
  Copy-Item -Force $envExample (Join-Path $DeployDir ".env.example")
}

$backendDockerfile = Join-Path $RepoRoot "backend\Dockerfile"
$frontendDockerfile = Join-Path $RepoRoot "frontend\Dockerfile"
if (Test-Path $backendDockerfile) {
  Copy-Item -Force $backendDockerfile (Join-Path $DeployDir "backend\Dockerfile")
}
if (Test-Path $frontendDockerfile) {
  Copy-Item -Force $frontendDockerfile (Join-Path $DeployDir "frontend\Dockerfile")
}

Copy-Item -Force (Join-Path $PSScriptRoot "import-data.sh") (Join-Path $DeployDir "scripts\import-data.sh")
Copy-Item -Force (Join-Path $PSScriptRoot "lib\data-transfer.sh") (Join-Path $DeployDir "scripts\lib\data-transfer.sh")
Copy-Item -Force (Join-Path $PSScriptRoot "import-deploy.sh") (Join-Path $DeployDir "scripts\import-deploy.sh")

New-Item -ItemType Directory -Force -Path (Join-Path $DeployDir "bibliography") | Out-Null
Set-Content -Path (Join-Path $DeployDir "bibliography\.gitkeep") -Value "" -Encoding ascii

$dataRel = $null
if ($WithData) {
  $dataRel = "data"
  $dataOut = Join-Path $DeployDir "data"
  Write-Host "info: exporting volumes via export-data.sh (requires bash)"
  $bash = Get-Command bash -ErrorAction SilentlyContinue
  if (-not $bash) { throw "bash required for -WithData (Git Bash / WSL). Or run export-data.sh separately." }
  & bash (Join-Path $PSScriptRoot "export-data.sh") -f $ComposeFile -o $dataOut
  if ($LASTEXITCODE -ne 0) { throw "export-data.sh failed" }
}

$readme = @"
# RedShip 服务器部署包

## 步骤

``````bash
cd deploy
./scripts/import-deploy.sh .
``````

或手动: load images → cp .env.example .env → 可选 import-data → docker compose up -d
"@
Set-Content -Path (Join-Path $DeployDir "README-DEPLOY.md") -Value $readme -Encoding UTF8

$manifest = [ordered]@{
  version = 1
  kind = "redship-deploy"
  created_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  compose_file = "docker-compose.yml"
  project_name = $projectName
  images = @{
    archive = $imagesArchive
    sha256 = $imagesSha
    list = $images
    backend = $backendImg
    frontend = $frontendImg
  }
  data = if ($dataRel) { @{ path = $dataRel } } else { $null }
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $OutputDir "deploy-manifest.json") -Encoding UTF8

if (-not $NoFinalTar) {
  $parent = Split-Path $OutputDir -Parent
  $base = Split-Path $OutputDir -Leaf
  $archivePath = Join-Path $parent "$base.tar.gz"
  Write-Host "info: packing $archivePath"
  $bash = Get-Command bash -ErrorAction SilentlyContinue
  if ($bash) {
    $parentUnix = ($parent -replace '\\', '/')
    $archiveUnix = ($archivePath -replace '\\', '/')
    & bash -lc "tar -C '$parentUnix' -czf '$archiveUnix' '$base'"
    if ($LASTEXITCODE -ne 0) { throw "tar failed" }
  } else {
    $zipPath = Join-Path $parent "$base.zip"
    Compress-Archive -Path $OutputDir -DestinationPath $zipPath -Force
    Write-Host "warn: no bash/tar; wrote zip instead: $zipPath"
  }
}

Write-Host "Done: $OutputDir"
Write-Host "Server: tar xzf <archive> && cd <dir>/deploy && ./scripts/import-deploy.sh ."
