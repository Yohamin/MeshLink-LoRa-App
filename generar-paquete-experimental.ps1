param(
    [string]$ArduinoConfig = (Join-Path $env:USERPROFILE '.arduinoIDE\arduino-cli.yaml'),
    [ValidateRange(1, 16)][int]$Jobs = 4,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$previousLocation = Get-Location
$app = Get-Content -LiteralPath (Join-Path $projectRoot 'app.json') -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$firmwareText = Get-Content -LiteralPath (Join-Path $projectRoot 'firmware\firmware.ino') -Raw
$versionMatch = [regex]::Match($firmwareText, 'doc\["firmwareVersion"\]\s*=\s*"([0-9.]+)"')
if (-not $versionMatch.Success) { throw 'Firmware version could not be determined.' }
$firmwareVersion = $versionMatch.Groups[1].Value
if ($package.version -ne $app.expo.version) { throw 'package.json and app.json versions differ.' }
$expectedSigner = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$outputRoot = Join-Path $projectRoot "experimental\MeshLink-App$($app.expo.version)-FW$firmwareVersion-$stamp"
$logRoot = Join-Path $outputRoot 'logs'
$payloadRoot = Join-Path $outputRoot 'paquete'
if (Test-Path -LiteralPath $outputRoot) { throw 'Output already exists; no package was overwritten.' }
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments, [string]$LogName)
    Get-Command -Name $Executable -ErrorAction Stop | Out-Null
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Executable @Arguments 2>&1 | ForEach-Object { $_.ToString() } |
            Tee-Object -FilePath (Join-Path $logRoot $LogName)
        $code = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $savedPreference }
    if ($code -ne 0) { throw "$Executable failed (exit $code). See $LogName in $logRoot" }
}

function Get-SourceFingerprints {
    $selected = @()
    foreach ($directory in @('src', 'assets', 'docs')) {
        $selected += Get-ChildItem -LiteralPath (Join-Path $projectRoot $directory) -File -Recurse
    }
    $selected += Get-ChildItem -LiteralPath (Join-Path $projectRoot 'firmware') -File |
        Where-Object { $_.Extension -in @('.ino', '.h', '.ps1') }
    $selected += Get-ChildItem -LiteralPath (Join-Path $projectRoot 'tests') -File
    $selected += Get-ChildItem -LiteralPath (Join-Path $projectRoot 'firmware\tests') -File |
        Where-Object { $_.Extension -in @('.cpp', '.ps1') }
    foreach ($name in @('package.json', 'package-lock.json', 'app.json', 'tsconfig.json',
        'android\app\build.gradle', 'android\gradle.properties', 'build-android-release.ps1',
        'generar-paquete-experimental.ps1')) {
        $selected += Get-Item -LiteralPath (Join-Path $projectRoot $name)
    }
    foreach ($file in ($selected | Sort-Object FullName -Unique)) {
        [pscustomobject]@{
            path = $file.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        }
    }
}

try {
    Set-Location -LiteralPath $projectRoot
    $sourceBefore = @(Get-SourceFingerprints)
    Invoke-Checked 'npm.cmd' @('run', 'typecheck') 'typecheck.log'
    Invoke-Checked 'node.exe' @('--experimental-strip-types', '--test',
        'tests/gps-and-ble.test.mjs', 'tests/health.test.mjs', 'tests/health-measurements.test.mjs', 'tests/telemetry.test.mjs', 'tests/trial-pair.test.mjs') 'tests.log'
    if ($ValidateOnly) {
        'SOFTWARE VALIDATION ONLY. Native builds and device tests were not run.' |
            Set-Content -LiteralPath (Join-Path $outputRoot 'VALIDACION_SOFTWARE.txt') -Encoding UTF8
        Write-Host "SOFTWARE VALIDATION PASSED: $outputRoot" -ForegroundColor Green
        return
    }

    if (-not (Test-Path -LiteralPath $ArduinoConfig -PathType Leaf)) { throw "Arduino config not found: $ArduinoConfig" }
    # A fresh staging directory avoids accidentally copying old 5.2 binaries.
    foreach ($board in @('V3', 'V4_3')) {
        $destination = Join-Path $payloadRoot "firmware\$board"
        Invoke-Checked 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
            (Join-Path $projectRoot 'firmware\build-firmware.ps1'), '-Board', $board, '-Jobs', [string]$Jobs,
            '-ConfigFile', $ArduinoConfig, '-OutputDirectory', $destination) "firmware-$board.log"
        foreach ($name in @('firmware.ino.bin', 'firmware.ino.bootloader.bin', 'firmware.ino.partitions.bin', 'firmware.ino.merged.bin')) {
            $file = Join-Path $destination $name
            if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -lt 100) {
                throw "Missing or empty firmware output: $board/$name"
            }
        }
        $binaryText = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes((Join-Path $destination 'firmware.ino.bin')))
        $boardMarker = if ($board -eq 'V3') { 'Heltec V3' } else { 'Heltec V4.3 / KCT8103L' }
        if (-not $binaryText.Contains("MeshLink $firmwareVersion") -or -not $binaryText.Contains($boardMarker)) {
            throw "Firmware version or hardware marker did not match for $board."
        }
    }

    Invoke-Checked 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        (Join-Path $projectRoot 'build-android-release.ps1')) 'android-release.log'
    $apk = Join-Path $projectRoot 'android\app\build\outputs\apk\release\app-release.apk'
    if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw 'Release APK was not produced.' }
    $sdkBuildTools = Join-Path $env:LOCALAPPDATA 'Android\Sdk\build-tools'
    $toolsVersion = Get-ChildItem -LiteralPath $sdkBuildTools -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
    if (-not $toolsVersion) { throw 'Android SDK build-tools not found for APK verification.' }
    $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
    Invoke-Checked (Join-Path $toolsVersion.FullName 'aapt.exe') @('dump', 'badging', $apk) 'apk-badging.log'
    $badging = Get-Content -LiteralPath (Join-Path $logRoot 'apk-badging.log') -Raw
    $packageMatch = [regex]::Match($badging, "package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'")
    if (-not $packageMatch.Success -or $packageMatch.Groups[1].Value -ne $app.expo.android.package -or
        $packageMatch.Groups[2].Value -ne [string]$app.expo.android.versionCode -or
        $packageMatch.Groups[3].Value -ne $app.expo.version -or $badging -match 'application-debuggable') {
        throw 'APK identity/version/release validation failed. An older APK was not packaged.'
    }
    Invoke-Checked (Join-Path $toolsVersion.FullName 'apksigner.bat') @('verify', '--verbose', '--print-certs', $apk) 'apk-signature.log'
    $signature = Get-Content -LiteralPath (Join-Path $logRoot 'apk-signature.log') -Raw
    if ($signature -notmatch [regex]::Escape($expectedSigner)) {
        throw 'APK signer differs from the existing experimental app. Export phone data before considering any uninstall.'
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($apk)
    try {
        $bundle = $archive.GetEntry('assets/index.android.bundle')
        if (-not $bundle -or $bundle.Length -lt 100000) { throw 'APK has no embedded application bundle; it may need Metro.' }
        $abis = @($archive.Entries | Where-Object { $_.FullName -match '^lib/([^/]+)/' } |
            ForEach-Object { ([regex]::Match($_.FullName, '^lib/([^/]+)/')).Groups[1].Value } | Sort-Object -Unique)
        if ($abis.Count -ne 1 -or $abis[0] -ne 'arm64-v8a') { throw 'Expected an ARM64-only APK.' }
    }
    finally { $archive.Dispose() }

    $sourceAfter = @(Get-SourceFingerprints)
    if (($sourceBefore | ConvertTo-Json -Depth 4 -Compress) -ne ($sourceAfter | ConvertTo-Json -Depth 4 -Compress)) {
        throw 'Source changed during the build. Rerun without editing the project to produce a traceable package.'
    }
    $appDirectory = Join-Path $payloadRoot 'app'
    New-Item -ItemType Directory -Path $appDirectory -Force | Out-Null
    Copy-Item -LiteralPath $apk -Destination (Join-Path $appDirectory "MeshLink-$($app.expo.version)-Ensayos-arm64.apk")
    Copy-Item -LiteralPath (Join-Path $projectRoot 'docs') -Destination (Join-Path $payloadRoot 'guias') -Recurse
    $sketchDirectory = Join-Path $payloadRoot 'fuentes\firmware'
    New-Item -ItemType Directory -Path $sketchDirectory -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'firmware') -File |
        Where-Object { $_.Extension -in @('.ino', '.h', '.ps1') } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $sketchDirectory }
    # No private keystore, network key, phone logs, node_modules or user attachments are copied.
    Copy-Item -LiteralPath $logRoot -Destination (Join-Path $payloadRoot 'validacion') -Recurse
    $sourceBefore | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $payloadRoot 'fuentes-sha256.json') -Encoding UTF8
    'NATIVE BUILDS AND SOFTWARE CHECKS PASSED. Physical radio/phone tests remain pending. Test/demo signing only.' |
        Set-Content -LiteralPath (Join-Path $payloadRoot 'COMPILACION_COMPLETA.txt') -Encoding UTF8
    $files = @(Get-ChildItem -LiteralPath $payloadRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
        [pscustomobject]@{ path = $_.FullName.Substring($payloadRoot.Length + 1).Replace('\', '/'); bytes = $_.Length;
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    })
    [ordered]@{ schema = 1; createdUtc = [DateTime]::UtcNow.ToString('o'); appVersion = $app.expo.version;
        versionCode = $app.expo.android.versionCode; firmwareVersion = $firmwareVersion; boards = @('V3', 'V4_3');
        androidAbi = 'arm64-v8a'; apkSignerSha256 = $expectedSigner; signing = 'debug keystore, experimental use only';
        physicallyTested = $false; files = $files } |
        ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $payloadRoot 'manifest.json') -Encoding UTF8
    $zipPath = "$outputRoot.zip"
    Compress-Archive -LiteralPath $payloadRoot -DestinationPath $zipPath -CompressionLevel Optimal
    "SHA256 $((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash)  $([IO.Path]::GetFileName($zipPath))" |
        Set-Content -LiteralPath "$zipPath.sha256.txt" -Encoding UTF8
    Write-Host 'PAQUETE EXPERIMENTAL GENERADO Y VERIFICADO' -ForegroundColor Green
    Write-Host "APK, V3, V4.3.1, guias, fuentes de firmware y manifiesto: $zipPath"
    Write-Host 'No se instalo ni se cargo ningun dispositivo. Realizar primero una prueba de banco.' -ForegroundColor Yellow
}
catch {
    $failure = $_.Exception.Message
    "INCOMPLETE. Do not use partial output as a release.`r`n$failure" |
        Set-Content -LiteralPath (Join-Path $outputRoot 'INCOMPLETO.txt') -Encoding UTF8
    Write-Host "No se genero un paquete completo. Logs: $logRoot" -ForegroundColor Red
    throw
}
finally { Set-Location -LiteralPath $previousLocation.Path }
