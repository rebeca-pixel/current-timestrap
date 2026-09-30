# Database Migration Guide: Neon to Supabase

## Overview
This guide explains how to migrate your entire PostgreSQL database from Neon to Supabase without affecting the original database.

## What Will Happen
✓ **Safe Operation** - Your existing database remains untouched  
✓ **Complete Copy** - All tables, schemas, and data are duplicated  
✓ **One-Time Process** - Run this migration once to copy everything  
✓ **No Data Loss** - Uses ON CONFLICT DO NOTHING to handle duplicates safely  

## Prerequisites
- Node.js installed (v16 or higher)
- Project dependencies installed: `npm install`
- Both databases accessible
- `.env` file with `DATABASE_URL` pointing to your Neon database

## Migration Script Details

### Source Database (Current)
```
URL from .env: DATABASE_URL
Host: Neon (ep-red-bird-ad6s9717.c-2.us-east-1.aws.neon.tech)
Database: neondb
```

### Target Database (New)
```
URL: postgresql://postgres:Durgadevi@67@db.zcqwthebilqrcvkqywav.supabase.co:5432/postgres
Host: Supabase (db.zcqwthebilqrcvkqywav.supabase.co)
Database: postgres
```

### Tables To Be Migrated
1. organisations
2. departments
3. groups
4. employees
5. projects
6. tasks
7. subtasks
8. time_entries
9. managers

## How to Run the Migration

### Step 1: Verify Your Environment
```bash
# Ensure you're in the project root directory
cd /path/to/TIMESTRAP-FINAL--main

# Check that .env file exists
cat .env | grep DATABASE_URL
```

### Step 2: Run the Migration Script
```bash
# Using npx with tsx (recommended)
npx tsx migrate-to-supabase.ts

# Or if using ts-node
npm run migration

# Or compile and run as JavaScript
npx tsc migrate-to-supabase.ts
node migrate-to-supabase.js
```

### Step 3: Monitor the Output
Watch for these signs of success:
```
✓ Source database connected
✓ Destination database connected
✓ Schema created successfully
✓ Successfully copied [X] rows to "[table_name]"
✓ Migration completed successfully!
```

## Safety Features

### 1. **Non-Destructive**
- Script does NOT modify your source database
- Script does NOT delete any existing data
- Uses `ON CONFLICT DO NOTHING` to safely handle any pre-existing data

### 2. **Non-Blocking**
- Original database remains fully operational during migration
- You can continue using your Neon database without interruption

### 3. **Verification**
- Displays row counts before and after each table copy
- Reports any errors immediately
- Shows successful completion summary

### 4. **Batch Processing**
- Data is copied in batches of 100 rows
- Prevents overwhelming the destination database
- More reliable for large datasets

## Troubleshooting

### Connection Errors
**Error**: `getaddrinfo ENOTFOUND db.zcqwthebilqrcvkqywav.supabase.co`  
**Solution**: Check your internet connection and Supabase database status

### Authentication Errors
**Error**: `FATAL: password authentication failed`  
**Solution**: Verify the password `Durgadevi@67` is correct in the script

### Table Already Exists
**Message**: `ℹ Tables already exist in destination database`  
**Meaning**: Safe to proceed - script detected pre-existing tables and will update them

### Out of Memory
**Error**: `JavaScript heap out of memory`  
**Solution**: Modify batch size in script from 100 to 50, or run in smaller batches

## What to Do After Migration

### 1. Verify Data in Supabase
```sql
-- Connect to your Supabase database and run:
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Check record counts:
SELECT COUNT(*) FROM organisations;
SELECT COUNT(*) FROM employees;
SELECT COUNT(*) FROM time_entries;
```

### 2. Update Your Application (Optional)
If you want to use the Supabase database:
```bash
# Update .env
DATABASE_URL=postgresql://postgres:Durgadevi@67@db.zcqwthebilqrcvkqywav.supabase.co:5432/postgres
```

### 3. Keep Neon as Backup
Your original Neon database is still available and unchanged. You can keep it as a backup.

## Rollback Plan

If anything goes wrong:

1. **Don't panic** - Your original database is untouched
2. **Check error messages** in the console output
3. **Optional**: Delete tables from Supabase and run migration again
4. **Continue using** Neon database until fully confident in Supabase

## Performance Notes

- **Small databases** (< 10MB): 1-5 minutes
- **Medium databases** (10-100MB): 5-30 minutes  
- **Large databases** (>100MB): 30+ minutes

Large migrations may experience:
- Slower batch processing
- Network timeouts (script will retry)
- RAM usage increase

## Support

If migration fails:
1. Check error messages in console output
2. Verify both database URLs and credentials
3. Ensure neither database is under heavy load
4. Try running migration again

## Additional Notes

- Script includes error handling for data type conversions
- Arrays, timestamps, booleans, and NULL values are handled correctly
- Duplicate prevention is automatic via `ON CONFLICT DO NOTHING`
- All original constraints and defaults are preserved

---

**Created**: 2024  
**Status**: Ready for One-Time Migration  
**Risk Level**: Very Low (Non-destructive)
