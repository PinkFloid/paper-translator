# Builds a clean distribution zip in dist\.
# Excludes test fixtures (downloaded papers must not be redistributed) and dist itself.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$manifest = Get-Content (Join-Path $root "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version
$staging = Join-Path $root "dist\paper-translator-$version"
$zip = Join-Path $root "dist\paper-translator-$version.zip"

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Force $staging | Out-Null

Copy-Item (Join-Path $root "manifest.json") $staging
Copy-Item (Join-Path $root "README.md") $staging
foreach ($dir in "src", "vendor", "assets") {
    Copy-Item (Join-Path $root $dir) $staging -Recurse
}

if (Test-Path $zip) { Remove-Item $zip -Force }
# Compress-Archive and ZipFile.CreateFromDirectory on Windows PowerShell write
# backslash entry names, which violates the zip spec and can break store
# uploads — write entries one by one with explicit forward slashes.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, "Create")
try {
    Get-ChildItem $staging -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($staging.Length + 1) -replace "\\", "/"
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $rel)
    }
} finally {
    $archive.Dispose()
}
Remove-Item $staging -Recurse -Force

Write-Host "Created $zip"
