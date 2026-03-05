$ErrorActionPreference = 'Stop'

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipName = 'HybridTurtle-v6.0.zip'
$outDir = Join-Path $source 'dist'
$dest = Join-Path $outDir $zipName

# Folders/files to exclude
$exclude = @(
    '.next', 'node_modules', 'dist', '.git',
    '.env', 'dev.db', 'dev.db-journal', 'dev.db-shm', 'dev.db-wal',
    'install.log', 'nightly.log', '*.tsbuildinfo',
    'reports', 'AGENT_REVIEW.md', 'AUDIT_CHECKLIST.md', 'AUDIT_PHASE1_INVENTORY.md',
    # Dev-only files - not needed by recipients
    'CLAUDE.md', 'HYBRIDTURTLE-IMPROVEMENT-PROMPTS.md',
    'test_output.txt', 'test_output_stop.txt', 'tsc_output.txt',
    # Debug/temp scripts at root
    '_check.js', '_db_check.mjs', '_db_inspect*.js', '_verify*.js'
)

Write-Host ''
Write-Host '  ==========================================================='
Write-Host '   HybridTurtle - Creating Distribution Package'
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
            Where-Object { $_.Name -in @('node_modules', '.next', '.git', 'backups', 'cache') } |
            ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
        # Remove db files inside prisma folder (dev.db, backups, corrupted copies, WAL/SHM files)
        Get-ChildItem $destPath -Recurse -File -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*.db' -or $_.Name -like '*.db-journal' -or $_.Name -like '*.db-shm' -or $_.Name -like '*.db-wal' -or $_.Name -like '*.db.backup-*' -or $_.Name -like '*.db.corrupted*' -or $_.Name -like '*.db.pre-restore-*' } |
            ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
    } else {
        Copy-Item $item.FullName $destPath -Force
    }
}

# Verify key files are present in the staging directory
$requiredFiles = @(
    'install.bat', 'start.bat', '.env.example', 'package.json', 'package-lock.json',
    'tsconfig.json', 'next.config.js', 'restore-backup.bat',
    'nightly.bat', 'nightly-task.bat', 'midday-sync-task.bat',
    'register-nightly-task.bat', 'register-midday-sync.bat',
    'seed-tickers.bat', 'update.bat', 'SETUP-README.md', 'README.md',
    'tailwind.config.ts', 'postcss.config.js', 'vitest.config.ts'
)
$missingCount = 0
foreach ($reqFile in $requiredFiles) {
    $reqPath = Join-Path $tempDir $reqFile
    if (-not (Test-Path $reqPath)) {
        Write-Host "  ! Missing expected file: $reqFile" -ForegroundColor Yellow
        $missingCount++
    }
}

# Verify critical source files (these caused fresh-install failures)
$criticalSources = @(
    'src\app\layout.tsx',
    'src\app\error.tsx',
    'src\app\dashboard\page.tsx',
    'src\app\dashboard\error.tsx',
    'src\app\scan\page.tsx',
    'src\app\scan\error.tsx',
    'src\app\portfolio\positions\page.tsx',
    'src\app\portfolio\positions\error.tsx',
    'src\middleware.ts',
    'src\components\shared\Navbar.tsx',
    'src\components\shared\RegimeBadge.tsx',
    'src\lib\utils.ts',
    'src\lib\prisma.ts',
    'src\lib\auth.ts',
    'src\lib\db-backup.ts',
    'src\store\useStore.ts',
    'src\types\index.ts',
    'src\cron\nightly.ts',
    'src\cron\midday-sync.ts',
    'src\app\api\backup\restore\route.ts',
    'prisma\schema.prisma',
    'prisma\seed.ts'
)
foreach ($src in $criticalSources) {
    $srcPath = Join-Path $tempDir $src
    if (-not (Test-Path $srcPath)) {
        Write-Host "  !! CRITICAL: Missing $src" -ForegroundColor Red
        $missingCount++
    }
}

if ($missingCount -gt 0) {
    Write-Host ''
    Write-Host "  !! $missingCount file(s) missing from package - aborting." -ForegroundColor Red
    Write-Host '  !! Check that all source files are present before packaging.' -ForegroundColor Red
    Remove-Item $tempDir -Recurse -Force
    exit 1
}

# Verify Planning folder is included
$planningStaged = Join-Path $tempDir 'Planning'
if (Test-Path $planningStaged) {
    $fileCount = (Get-ChildItem $planningStaged -File).Count
    Write-Host "    + Planning folder: $fileCount files"
} else {
    Write-Host '  ! Planning folder not found in package - ticker seeding will not work' -ForegroundColor Yellow
}

# Verify prisma/schema.prisma is present and no DB files leaked through
$prismaStaged = Join-Path $tempDir 'prisma'
if (Test-Path $prismaStaged) {
    $dbLeaks = Get-ChildItem $prismaStaged -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like '*.db*' }
    if ($dbLeaks) {
        Write-Host '  ! WARNING: DB files found in staged prisma folder - cleaning:' -ForegroundColor Yellow
        $dbLeaks | ForEach-Object {
            Write-Host "    - $($_.Name)" -ForegroundColor Yellow
            Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
        }
    }
} else {
    Write-Host '  !! CRITICAL: prisma folder missing from package!' -ForegroundColor Red
    $missingCount++
}

# Count total files being packaged
$totalFiles = (Get-ChildItem $tempDir -Recurse -File).Count
Write-Host "    + $totalFiles files total"

# Create the zip using .NET for reliability (Compress-Archive has known issues)
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $dest) { Remove-Item $dest -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $dest)

# Verify zip contents include critical files
Write-Host '  Verifying zip contents...'
$zip = [System.IO.Compression.ZipFile]::OpenRead($dest)
try {
    $zipEntries = $zip.Entries | ForEach-Object { $_.FullName }
    $verified = $true
    foreach ($src in $criticalSources) {
        # Compare using both slash styles — zip format varies by OS/.NET version
        $fwd = $src -replace '\\', '/'
        $bck = $src -replace '/', '\'
        if ($fwd -notin $zipEntries -and $bck -notin $zipEntries) {
            Write-Host "  !! ZIP missing: $src" -ForegroundColor Red
            $verified = $false
        }
    }
    if (-not $verified) {
        Write-Host '  !! Zip verification failed - some files were not included.' -ForegroundColor Red
        Write-Host '  !! The zip file has been kept for inspection.' -ForegroundColor Yellow
        Remove-Item $tempDir -Recurse -Force
        exit 1
    }
    Write-Host '    + All critical files verified in zip' -ForegroundColor Green
} finally {
    $zip.Dispose()
}

# Clean up temp
Remove-Item $tempDir -Recurse -Force

$size = [math]::Round((Get-Item $dest).Length / 1MB, 1)

Write-Host ''
Write-Host '  ==========================================================='
Write-Host '   PACKAGE CREATED!'
Write-Host '  ==========================================================='
Write-Host ''
Write-Host "   File: dist\$zipName - $size MB"
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
