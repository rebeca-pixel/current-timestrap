@echo off
REM ========================================
REM Manual PostgreSQL Migration (Windows)
REM ========================================
REM
REM This batch file provides manual migration steps using PostgreSQL tools
REM Use this if the Node.js script encounters issues
REM
REM Prerequisites:
REM - PostgreSQL client tools installed (psql, pg_dump)
REM - Both databases accessible
REM
REM Usage: Run this batch file from the project root directory
REM

setlocal enabledelayedexpansion

cls
echo ================================================
echo Manual PostgreSQL Database Migration (Windows)
echo ================================================
echo.

REM Source database credentials (from .env)
set SOURCE_HOST=ep-red-bird-ad6s9717.c-2.us-east-1.aws.neon.tech
set SOURCE_USER=neondb_owner
set SOURCE_DB=neondb
set SOURCE_PASSWORD=npg_oDTXltUjzC50

REM Destination database credentials
set DEST_HOST=db.zcqwthebilqrcvkqywav.supabase.co
set DEST_USER=postgres
set DEST_DB=postgres
set DEST_PASSWORD=Durgadevi@67
set DEST_PORT=5432

REM Create dump filename with timestamp
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c%%a%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a%%b)
set DUMP_FILE=database_backup_%mydate%_%mytime%.sql

echo Step 1: Dumping source database...
echo ==========================================
echo.
echo Command that will be executed:
echo pg_dump -h %SOURCE_HOST% -U %SOURCE_USER% -d %SOURCE_DB% -v -f %DUMP_FILE%
echo.
echo This will create a file: %DUMP_FILE%
echo.

REM Check if pg_dump is installed
where pg_dump >nul 2>nul
if errorlevel 1 (
    echo ❌ Error: pg_dump is not installed
    echo.
    echo Install PostgreSQL client tools:
    echo.
    echo 1. Download from: https://www.postgresql.org/download/windows/
    echo 2. Run the installer
    echo 3. Make sure to include 'Command Line Tools'
    echo 4. Add PostgreSQL bin directory to PATH
    echo.
    echo Default installation paths:
    echo - C:\Program Files\PostgreSQL\15\bin
    echo - C:\Program Files\PostgreSQL\14\bin
    echo.
    pause
    exit /b 1
)

echo ⏳ Starting dump process...
set PGPASSWORD=%SOURCE_PASSWORD%
pg_dump ^
    -h %SOURCE_HOST% ^
    -U %SOURCE_USER% ^
    -d %SOURCE_DB% ^
    --ssl-mode=require ^
    -v ^
    -f %DUMP_FILE%

if errorlevel 1 (
    echo.
    echo ❌ Dump failed
    pause
    exit /b 1
) else (
    echo.
    echo ✅ Database dump completed successfully
    echo 📄 File created: %DUMP_FILE%
    for %%A in (%DUMP_FILE%) do (
        echo 📊 File size: %%~zA bytes
    )
)

echo.
echo Step 2: Restoring to destination database...
echo ==========================================
echo.
echo Command that will be executed:
echo psql -h %DEST_HOST% -U %DEST_USER% -d %DEST_DB% -f %DUMP_FILE%
echo.

REM Check if psql is installed
where psql >nul 2>nul
if errorlevel 1 (
    echo ❌ Error: psql is not installed
    echo Install PostgreSQL client tools using the instructions above
    pause
    exit /b 1
)

echo ⏳ Starting restore process...
echo (This may take a few minutes depending on database size)
echo.
set PGPASSWORD=%DEST_PASSWORD%
psql ^
    -h %DEST_HOST% ^
    -U %DEST_USER% ^
    -d %DEST_DB% ^
    -f %DUMP_FILE%

if errorlevel 1 (
    echo.
    echo ❌ Restore failed
    pause
    exit /b 1
) else (
    echo.
    echo ✅ Database restore completed successfully
    echo 🎉 Migration complete!
)

echo.
echo Step 3: Verifying migration...
echo ==========================================
echo.
echo Row counts in destination database:
echo.
set PGPASSWORD=%DEST_PASSWORD%
psql ^
    -h %DEST_HOST% ^
    -U %DEST_USER% ^
    -d %DEST_DB% ^
    -c "SELECT tablename as table_name, n_live_tup as row_count FROM pg_stat_user_tables ORDER BY tablename;"

if errorlevel 1 (
    echo.
    echo ⚠️  Could not verify (connection issue)
) else (
    echo.
    echo ✅ Migration verification complete
)

echo.
echo ================================================
echo Next Steps:
echo ================================================
echo.
echo 1. Verify data in Supabase:
echo    - Go to: https://app.supabase.com
echo    - Select your project
echo    - Check table row counts
echo.
echo 2. Update .env if switching to Supabase:
echo    DATABASE_URL=postgresql://postgres:Durgadevi@67@db.zcqwthebilqrcvkqywav.supabase.co:5432/postgres
echo.
echo 3. Restart your application:
echo    npm run dev
echo.
echo 4. Backup the dump file:
echo    - Keep %DUMP_FILE% as a backup
echo    - Consider compressing it
echo.
echo ================================================
echo.
pause
