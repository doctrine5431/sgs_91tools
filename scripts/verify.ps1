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

    & $node '.\tests\juxi-slash-runtime.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Juxi Slash runtime tests failed.' }

    & $node '.\tests\juxi-invalid-tracking.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Juxi state tests failed.' }

    & $node '.\tests\linglie-shouhu.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Linglie Shouhu tests failed.' }

    & $node '.\tests\zhang-yu-xiangchen.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Zhang Yu Xiangchen tests failed.' }

    & $node '.\tests\hu-ban-chongyi.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Hu Ban Chongyi tests failed.' }

    & $node '.\tests\huan-jie-jianli.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Huan Jie Jianli tests failed.' }

    & $node '.\tests\suit-sorter-toggle.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Suit sorter toggle tests failed.' }

    & $node '.\tests\core-registry.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Core registry tests failed.' }

    & $node '.\tests\notice-overlay.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Notice overlay tests failed.' }

    & $node '.\tests\seat-overlay.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Seat overlay tests failed.' }

    & $node '.\tests\standalone-runtime.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Standalone runtime tests failed.' }

    & $node '.\tests\userscript-sandbox.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Userscript sandbox compatibility tests failed.' }

    & $node '.\tests\release-workflow.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Release workflow tests failed.' }

    & $node '.\tests\release.test.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Release tests failed.' }

    Write-Host 'SGS91 Assistant: all checks passed.' -ForegroundColor Green
} finally {
    Pop-Location
}
