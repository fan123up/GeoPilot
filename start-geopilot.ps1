param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$bridgePort = 18001
$runtimeDir = Join-Path $projectRoot ".runtime"
$bridgeLog = Join-Path $runtimeDir "qgis-mcp.log"
$bridgeErrorLog = Join-Path $runtimeDir "qgis-mcp-error.log"

$runner = "from qgis_mcp.qgis_mcp_server import mcp; mcp.settings.host='0.0.0.0'; mcp.settings.port=$bridgePort; mcp.settings.streamable_http_path='/'; mcp.run(transport='streamable-http')"
$bridgeArguments = "run --isolated --with `"mcp[cli]==1.8.0`" --with `"qgis-mcp @ https://github.com/jjsantos01/qgis_mcp/archive/refs/heads/main.zip`" python -c `"$runner`""

if ($DryRun) {
    Write-Output "uv $bridgeArguments"
    Write-Output "docker compose up -d --build"
    exit 0
}

$uv = Get-Command uv -ErrorAction SilentlyContinue
if ($null -eq $uv) {
    throw "uv was not found. Install it from https://docs.astral.sh/uv/"
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($null -eq $docker) {
    throw "Docker was not found. Install and start Docker Desktop first."
}

$listener = Get-NetTCPConnection -LocalPort $bridgePort -State Listen -ErrorAction SilentlyContinue
if ($null -eq $listener) {
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    Start-Process `
        -FilePath $uv.Source `
        -ArgumentList $bridgeArguments `
        -WindowStyle Hidden `
        -RedirectStandardOutput $bridgeLog `
        -RedirectStandardError $bridgeErrorLog | Out-Null
    Write-Host "Starting the QGIS MCP bridge in the background on port $bridgePort."
} else {
    Write-Host "Port $bridgePort is already listening; skipping duplicate bridge startup."
}

Push-Location $projectRoot
try {
    & $docker.Source compose up -d --build
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed to start."
    }
} finally {
    Pop-Location
}

Write-Host "GeoPilot is running. Open QGIS and click Start Server in the QGIS MCP panel."
Write-Host "Open http://localhost"
