$ErrorActionPreference = 'Stop'

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$node = if ($nodeCommand) {
    $nodeCommand.Source
} else {
    'C:\Users\FAWEI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}

if (-not (Test-Path -LiteralPath $node)) {
    throw 'Node.js was not found.'
}

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    & $node '.\scripts\build.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }

    $distFile = Get-ChildItem -LiteralPath '.\dist' -Filter '*.user.js' | Select-Object -First 1
    if (-not $distFile) { throw 'Built userscript was not found.' }
    & $node --check $distFile.FullName
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed.' }

    & $node '.\tests\juxi-rules.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Juxi rule tests failed.' }

    & $node '.\tests\juxi-invalid-tracking.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Juxi state tests failed.' }

    & $node '.\tests\core-registry.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Core registry tests failed.' }

    & $node '.\tests\release.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Release tests failed.' }

    Write-Host 'SGS91 Assistant: all checks passed.' -ForegroundColor Green
} finally {
    Pop-Location
}
