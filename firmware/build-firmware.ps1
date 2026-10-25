param(
    [string]$Port,
    [ValidateSet('V3', 'V4_2', 'V4_3', 'V4_R8')]
    [string]$Board = 'V3',
    [Nullable[int]]$RadioDriveDbm,
    [ValidateSet(9600, 38400, 115200)]
    [int]$GpsBaud = 9600,
    [ValidateRange(0, 32)]
    [int]$Jobs = 0,
    [string]$ConfigFile,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'

$firmwareRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputRoot = Join-Path $firmwareRoot "build\$Board"
$cacheRoot = Join-Path $outputRoot 'cache'
if ($OutputDirectory) {
    $projectPrefix = [System.IO.Path]::GetFullPath((Split-Path -Parent $firmwareRoot) + '\')
    $selectedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
    if (-not $selectedOutput.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Firmware output must be a subdirectory of this project.'
    }
    $outputRoot = $selectedOutput
}
$fqbn = 'Heltec-esp32:esp32:heltec_wifi_lora_32_V3'
$profile = 3
if ($Board -eq 'V4_2') { $profile = 42 }
if ($Board -eq 'V4_3') { $profile = 43 }
if ($Board -eq 'V4_R8') { $profile = 48 }
if ($Board -eq 'V4_2' -or $Board -eq 'V4_3') {
    $fem = if ($Board -eq 'V4_2') { '2' } else { '1' }
    $fqbn = "Heltec-esp32:esp32:heltec_wifi_lora_32_V4:PSRAM=enabled,FlashSize=16M,CDCOnBoot=cdc,LORA_FEM_TYPE=$fem,LORA_RX_LNA=1"
}
if ($Board -eq 'V4_R8') {
    $fqbn = 'Heltec-esp32:esp32:heltec_wifi_lora_32_V4_R8:PSRAM=opi,CDCOnBoot=cdc,LORA_RX_LNA=1'
}
$extraFlags = "-DMESH_BOARD_PROFILE=$profile -DMESH_GPS_BAUD=$GpsBaud"
if ($null -ne $RadioDriveDbm) {
    if ($RadioDriveDbm -lt -9 -or $RadioDriveDbm -gt 22) { throw 'SX1262 drive must be -9..22 dBm, NOT V4 antenna output.' }
    $extraFlags += " -DMESH_RADIO_DRIVE_DBM=$RadioDriveDbm"
}

$cliCandidates = @(
    (Get-Command arduino-cli -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
    'C:\Program Files\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe',
    "$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$arduinoCli = $cliCandidates | Select-Object -First 1
if (-not $arduinoCli) {
    throw 'arduino-cli was not found. Install Arduino IDE 2.x or add arduino-cli to PATH.'
}

$requiredLibraries = @('ArduinoJson', 'RadioLib', 'U8g2')
if ($Board -eq 'V4_3') {
    $requiredLibraries += 'SparkFun MAX3010x Pulse and Proximity Sensor Library'
}
$cliOptions = @()
if ($ConfigFile) {
    if (-not (Test-Path -LiteralPath $ConfigFile -PathType Leaf)) { throw "Arduino CLI config not found: $ConfigFile" }
    $cliOptions = @('--config-file', (Resolve-Path -LiteralPath $ConfigFile).Path)
}
$installedLibraries = & $arduinoCli @cliOptions lib list 2>&1 | Out-String
foreach ($library in $requiredLibraries) {
    if ($installedLibraries -notmatch [regex]::Escape($library)) {
        throw "Required Arduino library is not installed: $library"
    }
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

Write-Host "Compiling MeshLink firmware for $Board (profile $profile)..." -ForegroundColor Cyan
Write-Host 'V4: SX1262 drive setting is not calibrated RF output; external FEM adds gain.'
& $arduinoCli @cliOptions compile --fqbn $fqbn --jobs $Jobs --build-path $cacheRoot --build-property "compiler.cpp.extra_flags=$extraFlags" --output-dir $outputRoot $firmwareRoot
if ($LASTEXITCODE -ne 0) {
    throw 'Firmware compilation failed.'
}

Write-Host "FIRMWARE BUILD SUCCESSFUL" -ForegroundColor Green
Write-Host "Output: $outputRoot"

if ($Port) {
    Write-Host "Uploading firmware through $Port..." -ForegroundColor Cyan
    & $arduinoCli @cliOptions upload --port $Port --fqbn $fqbn --input-dir $outputRoot $firmwareRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Firmware upload failed on $Port."
    }
    Write-Host "FIRMWARE UPLOAD SUCCESSFUL" -ForegroundColor Green
}
else {
    Write-Host 'No serial port was supplied; compilation only.'
    Write-Host "To compile and upload: .\build-firmware.ps1 -Board $Board -Port COM5"
}
