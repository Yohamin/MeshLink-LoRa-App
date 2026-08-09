$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectParent = Split-Path -Parent $projectRoot
$projectName = Split-Path -Leaf $projectRoot
$mappedDrive = 'M:'
$mappedRoot = 'M:\'
$mappedProjectRoot = "$mappedRoot$projectName"
$androidRoot = "$mappedProjectRoot\android"
$logRoot = Join-Path $projectRoot 'android\build-logs'
$cleanLog = Join-Path $logRoot 'worklets-clean-release.log'
$buildLog = Join-Path $logRoot 'assemble-release.log'
$mappingCreated = $false

if (Get-PSDrive -Name $mappedDrive.TrimEnd(':') -ErrorAction SilentlyContinue) {
    throw "Drive M: is already in use. Remove or change that mapping before running this script."
}

try {
    New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

    # Keep native build paths short enough for the Android SDK's bundled Ninja.
    & subst.exe $mappedDrive $projectParent
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $androidRoot)) {
        throw "Could not map the MeshLink project to M:."
    }
    $mappingCreated = $true

    Set-Location -LiteralPath $androidRoot

    $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
    $env:NODE_ENV = 'production'
    $env:ORG_GRADLE_PROJECT_reactNativeArchitectures = 'arm64-v8a'
    $env:MESHLINK_SHORT_PROJECT_ROOT = $mappedProjectRoot

    # Remove generated native caches so release CMake files contain only the
    # short M: paths. Gradle recreates these directories during the build.
    $cxxCachePaths = @(
        "$mappedProjectRoot\android\app\.cxx",
        "$mappedProjectRoot\node_modules\expo-modules-core\android\.cxx",
        "$mappedProjectRoot\node_modules\react-native-worklets\android\.cxx",
        "$mappedProjectRoot\node_modules\react-native-reanimated\android\.cxx"
    )
    $mappedProjectPrefix = [System.IO.Path]::GetFullPath("$mappedProjectRoot\")
    foreach ($cxxCachePath in $cxxCachePaths) {
        $resolvedCachePath = [System.IO.Path]::GetFullPath($cxxCachePath)
        if (-not $resolvedCachePath.StartsWith($mappedProjectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove a CMake cache outside the mapped project: $resolvedCachePath"
        }
        if (Test-Path -LiteralPath $resolvedCachePath) {
            Write-Host "Removing generated CMake cache: $resolvedCachePath"
            Remove-Item -LiteralPath $resolvedCachePath -Recurse -Force
        }
    }

    $savedErrorActionPreference = $ErrorActionPreference
    try {
        # Windows PowerShell wraps native stderr as error records. Preserve the
        # complete Gradle output and use its process exit code for success.
        $ErrorActionPreference = 'Continue'
        & .\gradlew.bat :react-native-worklets:cleanCMakeCache --no-daemon --no-parallel --max-workers=1 --no-problems-report 2>&1 |
            Tee-Object -FilePath $cleanLog
        $cleanExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
    if ($cleanExitCode -ne 0) {
        throw "Worklets CMake cache cleanup failed. See $cleanLog"
    }

    Write-Host "Building standalone ARM64 release APK..." -ForegroundColor Cyan
    Write-Host "Signing with the local debug keystore (testing/demo use only)." -ForegroundColor Yellow
    try {
        $ErrorActionPreference = 'Continue'
        & .\gradlew.bat :app:assembleRelease --no-daemon --no-parallel --max-workers=1 --no-problems-report 2>&1 |
            Tee-Object -FilePath $buildLog
        $buildExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
    if ($buildExitCode -ne 0) {
        throw "Android release build failed. See $buildLog"
    }

    $apkPath = Join-Path $projectRoot 'android\app\build\outputs\apk\release\app-release.apk'
    if (-not (Test-Path -LiteralPath $apkPath)) {
        throw "Gradle completed but the expected release APK was not found."
    }

    $apk = Get-Item -LiteralPath $apkPath
    $sizeMb = [Math]::Round($apk.Length / 1MB, 1)
    Write-Host "RELEASE BUILD SUCCESSFUL" -ForegroundColor Green
    Write-Host "APK: $apkPath"
    Write-Host "Size: $sizeMb MB"
    Write-Host "Build log: $buildLog"
}
finally {
    Set-Location -LiteralPath $projectRoot
    if ($mappingCreated) {
        & subst.exe $mappedDrive /D
    }
}
