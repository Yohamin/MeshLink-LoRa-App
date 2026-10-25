$ErrorActionPreference = 'Stop'
$buildRoot = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'MSVC Build Tools are needed for host tests.' }
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'No MSVC toolchain found.' }
$devCmd = Join-Path $installation 'Common7\Tools\VsDevCmd.bat'
$source = Join-Path $PSScriptRoot 'health_window_test.cpp'
$executable = Join-Path $buildRoot 'health-window.exe'
$objectFile = Join-Path $buildRoot 'health-window.obj'
& cmd.exe /d /c "call `"$devCmd`" -arch=x64 -no_logo >nul && cl /nologo /EHsc /std:c++17 /W4 `"$source`" /Fe:`"$executable`" /Fo:`"$objectFile`""
if ($LASTEXITCODE -ne 0) { throw 'Health window test compilation failed.' }
& $executable
if ($LASTEXITCODE -ne 0) { throw 'Health window tests failed.' }
$diagnosticSource = Join-Path $PSScriptRoot 'health_diagnostic_test.cpp'
$diagnosticExe = Join-Path $buildRoot 'health-diagnostic.exe'
$diagnosticObject = Join-Path $buildRoot 'health-diagnostic.obj'
$mockIncludes = Join-Path $PSScriptRoot 'health-mocks'
& cmd.exe /d /c "call `"$devCmd`" -arch=x64 -no_logo >nul && cl /nologo /EHsc /std:c++17 /W4 /I`"$mockIncludes`" `"$diagnosticSource`" /Fe:`"$diagnosticExe`" /Fo:`"$diagnosticObject`""
if ($LASTEXITCODE -ne 0) { throw 'Health diagnostic test compilation failed.' }
& $diagnosticExe
if ($LASTEXITCODE -ne 0) { throw 'Health diagnostic tests failed.' }
foreach ($profile in @(3, 42, 48)) {
    $disabledSource = Join-Path $PSScriptRoot 'health_disabled_test.cpp'
    $disabledExe = Join-Path $buildRoot "health-disabled-$profile.exe"
    $disabledObject = Join-Path $buildRoot "health-disabled-$profile.obj"
    & cmd.exe /d /c "call `"$devCmd`" -arch=x64 -no_logo >nul && cl /nologo /EHsc /std:c++17 /W4 /DMESH_BOARD_PROFILE=$profile `"$disabledSource`" /Fe:`"$disabledExe`" /Fo:`"$disabledObject`""
    if ($LASTEXITCODE -ne 0) { throw "Disabled health test compilation failed for profile $profile." }
    & $disabledExe
    if ($LASTEXITCODE -ne 0) { throw "Disabled health tests failed for profile $profile." }
}
