param(
    [string]$Port
)

$ErrorActionPreference = 'Stop'

$firmwareRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputRoot = Join-Path $firmwareRoot 'build'
$fqbn = 'Heltec-esp32:esp32:heltec_wifi_lora_32_V3'

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
$installedLibraries = & $arduinoCli lib list 2>&1 | Out-String
foreach ($library in $requiredLibraries) {
    if ($installedLibraries -notmatch [regex]::Escape($library)) {
        throw "Required Arduino library is not installed: $library"
    }
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

Write-Host "Compiling MeshLink firmware for Heltec WiFi LoRa 32 V3..." -ForegroundColor Cyan
& $arduinoCli compile --fqbn $fqbn --output-dir $outputRoot $firmwareRoot
if ($LASTEXITCODE -ne 0) {
    throw 'Firmware compilation failed.'
}

Write-Host "FIRMWARE BUILD SUCCESSFUL" -ForegroundColor Green
Write-Host "Output: $outputRoot"

if ($Port) {
    Write-Host "Uploading firmware through $Port..." -ForegroundColor Cyan
    & $arduinoCli upload --port $Port --fqbn $fqbn --input-dir $outputRoot $firmwareRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Firmware upload failed on $Port."
    }
    Write-Host "FIRMWARE UPLOAD SUCCESSFUL" -ForegroundColor Green
}
else {
    Write-Host 'No serial port was supplied; compilation only.'
    Write-Host 'To compile and upload: .\build-firmware.ps1 -Port COM5'
}
