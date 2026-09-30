# 🚀 Database Migration - Quick Start Guide

## What You're About to Do

Copy all data from your **Neon PostgreSQL database** → **Supabase PostgreSQL database**

✅ **Safe** - Original database stays untouched  
✅ **Complete** - All tables and rows copied  
✅ **One-time** - Run once, migration complete  

---

## Your Databases

**SOURCE (Current):** Neon - from your `.env` file  
**DESTINATION (New):** Supabase - postgresql://postgres:Durgadevi@67@db.zcqwthebilqrcvkqywav.supabase.co:5432/postgres

---

## Step 1: Verify Everything Works (2 minutes)

```bash
cd TIMESTRAP-FINAL--main

npm run verify:migration
```

### Expected Output:
```
✓ Connected to source database
✓ Found 7 tables  
✓ Found approximately 95 total rows

✓ Connected to destination database
✓ Destination is empty (ready for migration)

✅ Both databases are accessible
```

**If you get a connection error for Supabase:**
See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Most common issue is firewall/network

---

## Step 2: Run the Migration (5-30 minutes)

Once verification passes:

```bash
npm run migrate:supabase
```

Or alternatively:
```bash
npx tsx migrate-to-supabase.ts
```

### What Happens:
1. Creates schema in destination database
2. Copies data table by table
3. Shows progress for each table
4. Displays final summary

### Expected Output:
```
✓ Source database connected
✓ Destination database connected
✓ Schema created successfully

⏳ Copying data from table: organisations
   ✓ Inserted 5/5 rows
   ✓ Successfully copied 5 rows

⏳ Copying data from table: employees
   ✓ Inserted 25/25 rows
   ✓ Successfully copied 25 rows

... (continues for all tables)

✅ Migration completed successfully!
```

---

## Step 3: Verify Migration Succeeded

Check your Supabase directly:

1. Go to **Supabase Dashboard** → Your Project
2. Click **SQL Editor**
3. Run this query:

```sql
SELECT 
  tablename, 
  CASE WHEN schemaname = 'public' THEN 'OK' ELSE 'ERROR' END as status
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;
```

Should list all your tables:
- organisations
- departments  
- groups
- employees
- projects
- tasks
- subtasks
- time_entries
- managers

4. Check data was copied:

```sql
SELECT COUNT(*) as total_rows FROM time_entries;
SELECT COUNT(*) as total_employees FROM employees;
```

---

## Step 4 (Optional): Update Your App to Use Supabase

If you want to switch from Neon to Supabase:

Edit `.env` file:
```env
# OLD - Neon
DATABASE_URL=postgresql://neondb_owner:npg_oDTXltUjzC50@ep-red-bird-ad6s9717.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require

# NEW - Supabase
DATABASE_URL=postgresql://postgres:Durgadevi@67@db.zcqwthebilqrcvkqywav.supabase.co:5432/postgres
```

Then restart your app:
```bash
npm run dev
```

---

## Troubleshooting Quick Links

| Problem | Solution |
|---------|----------|
| `ENOTFOUND db.zcqwthebilqrcvkqywav.supabase.co` | Check DNS: See [TROUBLESHOOTING.md](TROUBLESHOOTING.md#1-networkconnectivity-issues-most-common) |
| `password authentication failed` | Wrong password - See [TROUBLESHOOTING.md](TROUBLESHOOTING.md#2-incorrect-supabase-connection-details) |
| `Connection refused` | Supabase down or blocked - Check firewall |
| Destination already has data | Script handles this safely with `ON CONFLICT DO NOTHING` |
| Migration stuck/slow | Large database - let it run, don't interrupt |

---

## Safety Features You're Protected By

✅ **Source DB is never modified**  
✅ **Safe duplicate handling** - Won't crash if data exists  
✅ **Batch processing** - Handles large datasets  
✅ **Full error reporting** - You see exactly what happened  
✅ **No automatic rollback needed** - Can retry safely  

---

## Files Created

1. **migrate-to-supabase.ts** - Main migration script
2. **verify-migration.ts** - Connection checker
3. **MIGRATION_GUIDE.md** - Detailed documentation
4. **TROUBLESHOOTING.md** - Error solutions
5. **package.json** - Updated with npm scripts

New npm scripts available:
```bash
npm run verify:migration      # Check connections first
npm run migrate:supabase      # Run the migration
```

---

## Your Data is Safe - What Can Go Wrong?

### Network Issues
- Check firewall allows port 5432
- Check internet connection
- Try different network if possible

### Credential Issues
- Verify Supabase password is correct
- Check hostname matches Supabase dashboard
- Check username is 'postgres'

### Data Issues
- Size: If > 500MB might be slow
- Solution: Run at off-peak hours

**Remember:** Your original Neon database is NEVER touched and remains as a backup

---

## Timeline Estimate

- Verification: 1-2 minutes
- Migration (depends on data size):
  - Small (<10MB): 5-10 minutes
  - Medium (10-100MB): 15-30 minutes
  - Large (>100MB): 30+ minutes

### Don't:
- ❌ Don't interrupt the migration (let it complete)
- ❌ Don't modify databases during migration
- ❌ Don't close terminal while running

### Do:
- ✅ Keep monitoring progress
- ✅ Keep internet connection stable
- ✅ Have Supabase dashboard open (optional)

---

## Questions?

1. **Review:** [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)
2. **Troubleshoot:** [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
3. **Verify connection:** Run `npm run verify:migration`
4. **Check official docs:**
   - [Supabase Connection Guide](https://supabase.com/docs/guides/database/connecting-to-postgres)
   - [PostgreSQL Connection String](https://www.postgresql.org/docs/current/libpq-connect.html)

---

**Version:** 1.0  
**Created:** 2024  
**Status:** Ready to Use  
**Risk Level:** Very Low (Non-Destructive)  

🎉 **Ready? Run:** `npm run verify:migration`
