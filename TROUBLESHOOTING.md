# Database Migration Troubleshooting Guide

## Issue: DNS Resolution Error for Supabase Database

**Error Message:**
```
getaddrinfo ENOTFOUND db.zcqwthebilqrcvkqywav.supabase.co
```

### Root Causes & Solutions

#### 1. Network/Connectivity Issues (Most Common)

**Symptoms:**
- Cannot resolve Supabase hostname
- Network timeouts
- Connection refused

**Solutions:**

a) **Check Internet Connection**
```bash
# Windows - Test connectivity
ping 8.8.8.8
ping db.zcqwthebilqrcvkqywav.supabase.co
```

b) **Check DNS Resolution**
```bash
# Windows - Check DNS
nslookup db.zcqwthebilqrcvkqywav.supabase.co
```

c) **Check Firewall/VPN**
- Ensure firewall allows outbound connections on port 5432
- If using VPN, try disconnecting and retrying
- Check if your company blocks Supabase IPs

#### 2. Incorrect Supabase Connection Details

**Verify Your Supabase Details:**

1. Go to Supabase Dashboard: https://app.supabase.com
2. Select your project
3. Click "Connect" button (top right)
4. Select "PostgreSQL" tab
5. Use the connection string provided (not hardcoded)

The connection string should look like:
```
postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-ID].supabase.co:5432/postgres
```

**If different, update these files:**

a) Update `.env` file:
```env
SUPABASE_DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[CORRECT-HOST].supabase.co:5432/postgres
```

b) Update `migrate-to-supabase.ts` (line 7):
```typescript
const host = "db.[YOUR-ACTUAL-HOST].supabase.co"; // Update this
```

c) Update `verify-migration.ts` (line 8):
```typescript
const host = "db.[YOUR-ACTUAL-HOST].supabase.co"; // Update this
```

#### 3. Database User/Password Issues

**Check Credentials:**

1. Go to Supabase Dashboard > Project Settings > Database
2. Verify the PASSWORD for postgres user (if using default)
3. Check if password was auto-generated (different from original)
4. Look for special characters in password that need escaping

**If password contains special characters:**
- Characters like `@`, `!`, `#` need URL encoding
- The script automatically encodes them, but verify in Supabase

#### 4. Supabase Database Not Accessible

**Check Supabase Status:**

1. Is your Supabase project active? (not paused)
2. Is the database running? Check Supabase dashboard
3. Are there any active incidents? Check status.supabase.io

**Reset Database Connection (if needed):**

1. Go to Supabase Dashboard
2. Project Settings > Database
3. Look for "Reset database password" option
4. Update password in migration script
5. Retry

#### 5. Firewall/Corporate Network Blocking

**Solutions:**

a) **Test from different network:**
- Try using mobile hotspot instead of office network
- Try from home/public WiFi

b) **Allow Supabase IP in firewall:**
- Supabase uses IP range: varies by region
- Contact your IT dept to whitelist Supabase IPs
- Whitelist port 5432

c) **Use SSH tunnel (if available):**
- Contact Supabase support for SSH tunnel setup

## Quick Fix Checklist

- [ ] Internet connection is working
- [ ] Supabase hostname in script matches dashboard
- [ ] Password is correct and properly encoded
- [ ] Supabase database is not paused
- [ ] Firewall allows port 5432 outbound
- [ ] Your .env DATABASE_URL is correct
- [ ] Try from different network if corporate

## Verification Steps

Once you've fixed the issue:

```bash
# 1. Verify connection
npm run verify:migration

# 2. If successful, run migration
npm run migrate:supabase

# 3. Monitor progress
# Watch for the ✓ symbols and success messages
```

## Getting Help

**If still stuck, gather this info:**

1. Error message (full text)
2. Your Supabase project region (check dashboard)
3. Network type (home, office, VPN, etc.)
4. Operating system version
5. Node.js version: `node --version`

**Contact:**
- Supabase Support: https://supabase.com/support
- Project maintainer or DevOps team

## Alternative: Manual Connection Test

Test Supabase connection directly:

```bash
# Windows Cmd - Using psql if installed
psql -h db.zcqwthebilqrcvkqywav.supabase.co -U postgres -d postgres

# Enter password when prompted: Durgadevi@67

# If successful, you'll see:
# postgres=>

# Then exit:
# \q
```

If `psql` is not installed, install PostgreSQL tools from:
https://www.postgresql.org/download/

---

## Prevention Tips

1. **Backup your current database first** (pg_dump)
2. **Test connections before running migration**
3. **Have Supabase dashboard open during migration**
4. **Don't use migration during peak hours**
5. **Keep .env file with working Neon credentials**

## Still Not Working?

Check these resources:

- [Supabase Documentation](https://supabase.com/docs)
- [Connection Troubleshooting](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Firewall & Network Issues](https://supabase.com/docs/guides/database/firewall-rules)
- [PostgreSQL Connection Strings](https://www.postgresql.org/docs/current/libpq-connect.html)
