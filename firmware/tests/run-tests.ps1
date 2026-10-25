$ErrorActionPreference = 'Stop'
$testRoot = $PSScriptRoot
$buildRoot = Join-Path $testRoot 'build'
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'MSVC Build Tools are needed for host tests.' }
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'No MSVC toolchain found.' }
$devCmd = Join-Path $installation 'Common7\Tools\VsDevCmd.bat'
foreach ($profile in @(3, 42, 43, 48)) {
    $testSource = Join-Path $testRoot 'gps_test.cpp'
    $executable = Join-Path $buildRoot "gps-$profile.exe"
    $objectFile = Join-Path $buildRoot "gps-$profile.obj"
    & cmd.exe /d /c "call `"$devCmd`" -arch=x64 -no_logo >nul && cl /nologo /EHsc /std:c++17 /W4 /DMESH_BOARD_PROFILE=$profile `"$testSource`" /Fe:`"$executable`" /Fo:`"$objectFile`""
    if ($LASTEXITCODE -ne 0) { throw "Host tests failed for profile $profile." }
}
foreach ($profile in @(3, 42, 43, 48)) {
    & (Join-Path $buildRoot "gps-$profile.exe")
    if ($LASTEXITCODE -ne 0) { throw "Host tests failed for profile $profile." }
}
