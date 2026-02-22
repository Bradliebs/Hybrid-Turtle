$ErrorActionPreference = 'Stop'

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipName = 'HybridTurtle-v6.0.zip'
$outDir = Join-Path $source 'dist'
$dest = Join-Path $outDir $zipName

# Folders/files to exclude
$exclude = @(
    '.next', 'node_modules', 'dist', '.git',
    '.env', 'dev.db', 'dev.db-journal',
    'install.log', 'nightly.log', '*.tsbuildinfo',
    'reports', 'AGENT_REVIEW.md', 'AUDIT_CHECKLIST.md', 'AUDIT_PHASE1_INVENTORY.md'
)

Write-Host ''
Write-Host '  ==========================================================='
Write-Host '   HybridTurtle — Creating Distribution Package'
Write-Host '  ==========================================================='
Write-Host ''

# Create dist folder
if (-not (Test-Path $outDir)) {
    New-Item $outDir -ItemType Directory | Out-Null
}

# Remove old zip
if (Test-Path $dest) {
    Remove-Item $dest -Force
}

Write-Host '  Packaging files (excluding node_modules, .next, databases)...'
Write-Host ''

# Create temp staging directory
$tempDir = Join-Path $env:TEMP 'hybridturtle-package'
if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force
}
New-Item $tempDir -ItemType Directory | Out-Null

# Copy items (top-level filtering)
$items = Get-ChildItem $source -Force | Where-Object {
    $name = $_.Name
    $dominated = $false
    foreach ($ex in $exclude) {
        if ($name -like $ex) { $dominated = $true; break }
    }
    -not $dominated
}

foreach ($item in $items) {
    $destPath = Join-Path $tempDir $item.Name
    if ($item.PSIsContainer) {
        # For directories, copy recursively but skip nested exclusions
        Copy-Item $item.FullName $destPath -Recurse -Force
        # Remove any nested node_modules or .next that got copied
        Get-ChildItem $destPath -Recurse -Directory -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -in @('node_modules', '.next', '.git') } |
            ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
        # Remove db files inside prisma folder
        Get-ChildItem $destPath -Recurse -File -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*.db' -or $_.Name -like '*.db-journal' } |
            ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
    } else {
        Copy-Item $item.FullName $destPath -Force
    }
}

# Verify key files are present in the staging directory
$requiredFiles = @('install.bat', 'start.bat', '.env.example', 'package.json')
foreach ($reqFile in $requiredFiles) {
    $reqPath = Join-Path $tempDir $reqFile
    if (-not (Test-Path $reqPath)) {
        Write-Host "  ! Missing expected file: $reqFile" -ForegroundColor Yellow
    }
}

# Verify Planning folder is included
$planningStaged = Join-Path $tempDir 'Planning'
if (Test-Path $planningStaged) {
    $fileCount = (Get-ChildItem $planningStaged -File).Count
    Write-Host "    + Planning folder ($fileCount files)"
} else {
    Write-Host '  ! Planning folder not found in package - ticker seeding will not work' -ForegroundColor Yellow
}

# Create the zip
Compress-Archive -Path (Join-Path $tempDir '*') -DestinationPath $dest -Force

# Clean up temp
Remove-Item $tempDir -Recurse -Force

$size = [math]::Round((Get-Item $dest).Length / 1MB, 1)

Write-Host ''
Write-Host '  ==========================================================='
Write-Host '   PACKAGE CREATED!'
Write-Host '  ==========================================================='
Write-Host ''
Write-Host "   File: dist\$zipName ($size MB)"
Write-Host ''
Write-Host '   Send this zip to the other person. They need to:'
Write-Host '     1. Extract the zip to any folder'
Write-Host '     2. Double-click install.bat'
Write-Host '     3. Done!'
Write-Host ''
Write-Host '   See SETUP-README.md for full instructions.'
Write-Host '  ==========================================================='
Write-Host ''

# Open the dist folder
Start-Process $outDir
