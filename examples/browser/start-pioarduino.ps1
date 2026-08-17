$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$coreDirectory = Join-Path $repositoryRoot '.pioarduino-core'
$platformio = Join-Path $coreDirectory 'penv\Scripts\platformio.exe'

if (-not (Test-Path -LiteralPath $platformio -PathType Leaf)) {
    throw "PioArduino Core is not installed at $coreDirectory."
}

# Keep the setting scoped to this Theia instance. It avoids the non-ASCII Windows
# user-profile fallback while leaving any system-wide PlatformIO installation alone.
$env:PLATFORMIO_CORE_DIR = $coreDirectory

& yarn.cmd --cwd $PSScriptRoot start
exit $LASTEXITCODE
