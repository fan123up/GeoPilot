$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$startScript = Join-Path $projectRoot "start-geopilot.ps1"
$deploymentConfig = Join-Path $projectRoot "backend\deployment-config.local.json"
$composeFile = Join-Path $projectRoot "docker-compose.yml"

if (-not (Test-Path -LiteralPath $startScript)) {
    throw "Missing public one-click launcher: start-geopilot.ps1"
}

if (-not (Test-Path -LiteralPath $deploymentConfig)) {
    throw "Missing default local deployment configuration"
}

$config = Get-Content -LiteralPath $deploymentConfig -Raw -Encoding UTF8 | ConvertFrom-Json
$qgisServer = $config.mcp_servers | Where-Object { $_.name -eq "QGIS MCP" }
if ($null -eq $qgisServer) {
    throw "QGIS MCP is not preconfigured"
}
if ($qgisServer.url -ne "http://host.docker.internal:18001/mcp" -or -not $qgisServer.enabled) {
    throw "QGIS MCP must be enabled with the Docker host URL"
}

$compose = Get-Content -LiteralPath $composeFile -Raw
if ($compose -notmatch "DEPLOYMENT_CONFIG_PATH=/app/config/deployment.local.json") {
    throw "Docker backend does not load the local deployment configuration"
}
if ($compose -notmatch "deployment-config.local.json:/app/config/deployment.local.json:ro") {
    throw "Docker backend does not mount the local deployment configuration"
}

$dryRun = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript -DryRun 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Launcher dry run failed: $dryRun"
}
$dryRunText = $dryRun -join "`n"
if ($dryRunText -notmatch "qgis_mcp.qgis_mcp_server" -or $dryRunText -notmatch "docker compose up -d --build") {
    throw "Launcher dry run does not include both required services"
}

Write-Host "QGIS MCP automatic startup configuration is valid."
