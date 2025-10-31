# 🚀 Render Deployment Guide

## Prerequisites

✅ Your backend is now ready for Render deployment! All necessary changes have been made.

## Required Environment Variables

Set these in your Render dashboard (under Environment Variables):

### **Required:**
- `DATABASE_URL` - PostgreSQL connection string (pooler URL)
- `DIRECT_URL` - Direct PostgreSQL connection for migrations
- `JWT_SECRET` - Secret key for JWT token signing (use a strong random string)
- `FRONTEND_URL` - Your frontend URL for CORS (e.g., `https://yourfrontend.com`)

### **Optional:**
- `NODE_ENV` - Set to `production` (already configured in render.yaml)
- `PORT` - Automatically set by Render, no need to configure

## Deployment Steps

### Option 1: Using render.yaml (Recommended)

1. **Push your code to GitHub/GitLab**
2. **Connect your repository to Render**
3. **Select "Web Service"**
4. **Render will automatically detect `render.yaml`** and use those settings

### Option 2: Manual Setup via Dashboard

If you prefer manual setup or render.yaml isn't detected:

1. **Build Command:**
   ```bash
   npm install && npm run build && npm run migrate:deploy
   ```

2. **Start Command:**
   ```bash
   npm run start:prod
   ```

3. **Environment Variables:** Add all required variables listed above

## Key Changes Made for Deployment

✅ **Added `dotenv` dependency** - Required for loading environment variables
✅ **Added `prisma` to dependencies** - Available in production for migrations
✅ **Added `postinstall` script** - Automatically generates Prisma Client after `npm install`
✅ **Added `migrate:deploy` script** - Runs database migrations safely in production
✅ **Created `render.yaml`** - Automated deployment configuration

## Important Notes

### Database Migrations
- Migrations run automatically during the build step
- Uses `prisma migrate deploy` (safe for production - only applies pending migrations)
- Requires `DIRECT_URL` environment variable for migrations

### Prisma Client
- Prisma Client is automatically generated after `npm install` via `postinstall` script
- No manual steps needed

### Port Configuration
- Render automatically sets the `PORT` environment variable
- Your app already uses `process.env.PORT || 3000` in `main.ts` ✅

### CORS Configuration
- Make sure `FRONTEND_URL` is set to your actual frontend URL
- Update this when deploying your frontend

## Troubleshooting

### Build Fails
- Check that all environment variables are set correctly
- Verify `DATABASE_URL` and `DIRECT_URL` are accessible
- Check build logs for specific errors

### Database Connection Errors
- Verify `DATABASE_URL` uses the pooler port (usually 6543 for Supabase)
- Verify `DIRECT_URL` uses direct connection port (usually 5432 for Supabase)
- Ensure database allows connections from Render's IPs

### Migration Errors
- Ensure `DIRECT_URL` is set correctly (migrations require direct connection)
- Check that your database user has migration permissions
- Review migration files in `prisma/migrations/`

### Runtime Errors
- Check application logs in Render dashboard
- Verify all required environment variables are set
- Ensure Prisma Client was generated (check build logs)

## Health Check

Your app will be available at: `https://your-service-name.onrender.com`

The root path `/` can be used as a health check endpoint (you may want to add a specific health check route later).

## Next Steps

1. **Set up your database** on Render or use existing Supabase database
2. **Configure environment variables** in Render dashboard
3. **Deploy!** Render will build and start your app
4. **Test your API** endpoints
5. **Update your frontend** to use the new backend URL

## Free Tier Limitations

Keep in mind Render's free tier:
- Services spin down after 15 minutes of inactivity
- First request after spin-down may take 30-60 seconds (cold start)
- Consider upgrading for production use

---

**Your backend is deployment-ready! 🎉**

