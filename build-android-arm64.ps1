$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectParent = Split-Path -Parent $projectRoot
$projectName = Split-Path -Leaf $projectRoot
$mappedDrive = 'M:'
$mappedRoot = 'M:\'
$mappedProjectRoot = "$mappedRoot$projectName"
$androidRoot = "$mappedProjectRoot\android"
$logRoot = Join-Path $projectRoot 'android\build-logs'
$cleanLog = Join-Path $logRoot 'worklets-clean.log'
$buildLog = Join-Path $logRoot 'assemble-debug.log'
$mappingCreated = $false

if (Get-PSDrive -Name $mappedDrive.TrimEnd(':') -ErrorAction SilentlyContinue) {
    throw "Drive M: is already in use. Remove or change that mapping before running this script."
}

try {
    New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

    # Map the parent so package.json is not placed at the drive root. Expo's
    # package finder intentionally stops before checking a drive root.
    & subst.exe $mappedDrive $projectParent
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $androidRoot)) {
        throw "Could not map the MeshLink project to M:."
    }
    $mappingCreated = $true

    Set-Location -LiteralPath $androidRoot

    $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
    $env:ANDROID_HOME = 'C:\Users\Yohamin\AppData\Local\Android\Sdk'
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    $env:NODE_ENV = 'development'
    $env:ORG_GRADLE_PROJECT_reactNativeArchitectures = 'arm64-v8a'
    $env:MESHLINK_SHORT_PROJECT_ROOT = $mappedProjectRoot

    # Discard generated CMake state created before every native module was
    # remapped to the short drive. These directories are recreated by Gradle.
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
        # Windows PowerShell represents native stderr as non-terminating error
        # records. Keep streaming it to the log and decide from the exit code.
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

    try {
        $ErrorActionPreference = 'Continue'
        & .\gradlew.bat :app:assembleDebug --no-daemon --no-parallel --max-workers=1 --no-problems-report 2>&1 |
            Tee-Object -FilePath $buildLog
        $buildExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
    if ($buildExitCode -ne 0) {
        throw "Android debug build failed. See $buildLog"
    }

    $apkPath = Join-Path $projectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path -LiteralPath $apkPath)) {
        throw "Gradle completed but the expected APK was not found."
    }

    Write-Host "BUILD SUCCESSFUL" -ForegroundColor Green
    Write-Host "APK: $apkPath"
    Write-Host "Build log: $buildLog"
}
finally {
    Set-Location -LiteralPath $projectRoot
    if ($mappingCreated) {
        & subst.exe $mappedDrive /D
    }
}
