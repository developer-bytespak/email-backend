# 🗄️ Database Setup & Optimization

## ✅ Supabase Configuration

### Connection Strings:
```env
DATABASE_URL=postgresql://postgres.iwmfufmegpyqwbhrysmw:Bytes123!!@aws-1-ap-south-1.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres.iwmfufmegpyqwbhrysmw:Bytes123!!@aws-1-ap-south-1.pooler.supabase.com:5432/postgres
```

### What Each Connection Does:

| Connection | Port | Purpose | Used By |
|------------|------|---------|---------|
| **DATABASE_URL** | 6543 | Transaction Pooler | All queries |
| **DIRECT_URL** | 5432 | Direct Connection | Migrations only |

---

## 🚀 Optimizations Implemented

### 1. **Global Prisma Singleton** ✅
- Single `PrismaService` instance shared across all modules
- Uses `@Global()` decorator for automatic availability
- No multiple connections = No connection limit issues
- Located in: `src/config/prisma.module.ts` + `src/config/prisma.service.ts`

### 2. **Automatic Connection Management** ✅
- Connects on app startup (`onModuleInit`)
- Disconnects on app shutdown (`onModuleDestroy`)
- Graceful shutdown hooks enabled
- No manual connection handling needed

### 3. **Transaction Pooling** ✅
- Uses Supabase Transaction Pooler (port 6543)
- Supports **unlimited concurrent connections**
- Perfect for serverless and microservices
- Automatic connection reuse

### 4. **Query Logging (Development)** ✅
- Logs all queries in development mode
- Shows query execution time
- Helps with debugging and optimization

---

## 📊 Connection Limit Prevention

### Before (Without Optimization):
```
❌ Each module creates own PrismaClient
❌ Multiple connections per request
❌ Connection pool exhaustion
❌ "Too many connections" errors
❌ Manual connect/disconnect required
```

### After (With Optimization):
```
✅ Single global PrismaService
✅ Connection pooling via Supabase
✅ Automatic connection management
✅ No connection limit issues
✅ Graceful shutdown handling
```

---

## 🎯 How It Works

### Architecture:
```
┌─────────────────────────────────────────────┐
│           Your NestJS Application           │
├─────────────────────────────────────────────┤
│            AppModule (imports)               │
│                    ↓                         │
│      @Global() PrismaModule (once)           │
│                    ↓                         │
│  Module 1  │  Module 2  │  Module 3  │ ... │
│     ↓      │     ↓      │     ↓      │     │
│  Service 1 │ Service 2  │ Service 3  │ ... │
│     └──────┴──────┴──────┴────────────┘     │
│                    ↓                         │
│      PrismaService (injected everywhere)     │
│                    ↓                         │
└─────────────────────────────────────────────┘
                     ↓
         Supabase Transaction Pooler (6543)
                     ↓
              PostgreSQL Database
```

### Connection Flow:
1. App starts → `PrismaService` connects to database
2. All modules inject same `PrismaService` instance
3. Queries go through transaction pooler (port 6543)
4. Pooler manages connections efficiently
5. App shuts down → `PrismaService` disconnects gracefully

---

## 📝 Usage in Your Modules

### Quick Example:
```typescript
// 1. In your module - NO import needed! @Global() handles it
@Module({
  controllers: [YourController],
  providers: [YourService],
  // PrismaModule is already global, no need to import!
})
export class YourModule {}

// 2. In your service - just inject it!
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class YourService {
  constructor(private readonly prisma: PrismaService) {}

  async getData() {
    return this.prisma.client.findMany();
  }
}
```

That's it! Thanks to `@Global()` decorator, PrismaService is available everywhere! 🎉

---

## 🔧 Maintenance Commands

```bash
# Generate Prisma Client (after schema changes)
npx prisma generate

# Create migration
npx prisma migrate dev --name your_migration_name

# Apply migrations (production)
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset

# View database in Prisma Studio
npx prisma studio
```

---

## 🛡️ Best Practices

1. ✅ **Always use transactions for multi-step operations**
2. ✅ **Let PrismaService handle connections automatically**
3. ✅ **Use the transaction pooler for all queries**
4. ✅ **Enable query logging in development**
5. ❌ **Never create new PrismaClient() instances**
6. ❌ **Never call $connect() or $disconnect() manually**
7. ❌ **Don't keep transactions open for long periods**

---

## 📚 Resources

- [Prisma Documentation](https://www.prisma.io/docs)
- [Supabase Connection Pooling](https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooler)
- [NestJS Prisma Guide](https://docs.nestjs.com/recipes/prisma)

---

## 🎉 Benefits Summary

| Feature | Impact |
|---------|--------|
| Connection Pooling | 🚀 Handle thousands of connections |
| Global Singleton | 💾 Reduced memory usage |
| Auto Management | 🔧 Less code to maintain |
| Graceful Shutdown | 🛡️ Prevents data corruption |
| Transaction Pooler | ⚡ Faster query execution |
| Query Logging | 🐛 Easier debugging |

---

**Your database is now optimized and production-ready!** 🎊

