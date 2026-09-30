#!/bin/bash

# ========================================
# Alternative: Manual PostgreSQL Migration
# ========================================
# 
# This script provides manual migration steps using PostgreSQL tools
# Use this if the Node.js script encounters issues
#
# Prerequisites:
# - PostgreSQL client tools installed (psql, pg_dump, pg_restore)
# - Both databases accessible
# - This script is run from the TIMESTRAP-FINAL--main directory
#

echo "================================================"
echo "Manual PostgreSQL Database Migration"
echo "================================================"
echo ""

# Source database credentials (from .env)
SOURCE_HOST="ep-red-bird-ad6s9717.c-2.us-east-1.aws.neon.tech"
SOURCE_USER="neondb_owner"
SOURCE_DB="neondb"
SOURCE_PASSWORD="npg_oDTXltUjzC50"  # This would come from .env

# Destination database credentials
DEST_HOST="db.zcqwthebilqrcvkqywav.supabase.co"
DEST_USER="postgres"
DEST_DB="postgres"
DEST_PASSWORD="Durgadevi@67"
DEST_PORT="5432"

# Dump filename
DUMP_FILE="database_backup_$(date +%Y%m%d_%H%M%S).sql"

echo "Step 1: Dumping source database..."
echo "=========================================="
echo ""
echo "Command that will be executed:"
echo "pg_dump -h $SOURCE_HOST -U $SOURCE_USER -d $SOURCE_DB -v > $DUMP_FILE"
echo ""
echo "This will create a file: $DUMP_FILE"
echo ""

# Check if pg_dump is installed
if ! command -v pg_dump &> /dev/null; then
    echo "❌ Error: pg_dump is not installed"
    echo ""
    echo "Install PostgreSQL client tools:"
    echo ""
    echo "Windows:"
    echo "  - Download from: https://www.postgresql.org/download/windows/"
    echo "  - Run installer"
    echo "  - Make sure to include 'Command Line Tools'"
    echo ""
    echo "macOS:"
    echo "  brew install postgresql"
    echo ""
    echo "Linux (Ubuntu/Debian):"
    echo "  sudo apt-get install postgresql-client"
    echo ""
    exit 1
fi

# Perform dump
export PGPASSWORD="$SOURCE_PASSWORD"
pg_dump \
    -h "$SOURCE_HOST" \
    -U "$SOURCE_USER" \
    -d "$SOURCE_DB" \
    --ssl-mode=require \
    -v \
    > "$DUMP_FILE"

DUMP_EXIT_CODE=$?

if [ $DUMP_EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ Database dump completed successfully"
    echo "📄 File created: $DUMP_FILE"
    echo "📊 File size: $(du -h "$DUMP_FILE" | cut -f1)"
else
    echo ""
    echo "❌ Dump failed with exit code: $DUMP_EXIT_CODE"
    exit 1
fi

echo ""
echo "Step 2: Restoring to destination database..."
echo "=========================================="
echo ""
echo "Command that will be executed:"
echo "psql -h $DEST_HOST -U $DEST_USER -d $DEST_DB -f $DUMP_FILE"
echo ""

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo "❌ Error: psql is not installed"
    echo "Install it using the instructions above"
    exit 1
fi

# Perform restore
export PGPASSWORD="$DEST_PASSWORD"
psql \
    -h "$DEST_HOST" \
    -U "$DEST_USER" \
    -d "$DEST_DB" \
    -f "$DUMP_FILE" \
    -v

RESTORE_EXIT_CODE=$?

if [ $RESTORE_EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ Database restore completed successfully"
    echo "🎉 Migration complete!"
else
    echo ""
    echo "❌ Restore failed with exit code: $RESTORE_EXIT_CODE"
    exit 1
fi

echo ""
echo "Step 3: Verifying migration..."
echo "=========================================="
echo ""

export PGPASSWORD="$DEST_PASSWORD"
echo "Row counts in destination database:"
psql \
    -h "$DEST_HOST" \
    -U "$DEST_USER" \
    -d "$DEST_DB" \
    -c "SELECT 
        tablename as table_name, 
        n_live_tup as row_count 
    FROM pg_stat_user_tables 
    ORDER BY tablename;"

echo ""
echo "✅ Migration verification complete"
echo ""
echo "================================================"
echo "Next Steps:"
echo "================================================"
echo ""
echo "1. Verify data in Supabase:"
echo "   - Go to: https://app.supabase.com"
echo "   - Select your project"
echo "   - Check table row counts"
echo ""
echo "2. Update .env if switching to Supabase:"
echo "   DATABASE_URL=postgresql://postgres:Durgadevi@67@db.zcqwthebilqrcvkqywav.supabase.co:5432/postgres"
echo ""
echo "3. Restart your application:"
echo "   npm run dev"
echo ""
echo "4. Backup the dump file:"
echo "   - Keep $DUMP_FILE as a backup"
echo "   - Compress: gzip $DUMP_FILE"
echo ""
echo "================================================"
