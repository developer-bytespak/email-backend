import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private isConnected = false;
  private scrapingClient: PrismaClient | null = null;

  constructor() {
    // Modify DATABASE_URL to disable prepared statements
    const databaseUrl = process.env.DATABASE_URL;
    const directUrl = process.env.DIRECT_URL;
    
    // Supabase-specific configuration with proper pooling
    const modifiedUrl = databaseUrl?.includes('?') 
      ? `${databaseUrl}&pgbouncer=true&connection_limit=5&pool_timeout=20`
      : `${databaseUrl}?pgbouncer=true&connection_limit=5&pool_timeout=20`;
    
    const modifiedDirectUrl = directUrl?.includes('?') 
      ? `${directUrl}&connection_limit=5&pool_timeout=20`
      : `${directUrl}?connection_limit=5&pool_timeout=20`;

    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
      ],
      errorFormat: 'pretty',
      datasources: {
        db: {
          url: modifiedUrl,
        },
      },
      transactionOptions: {
        maxWait: 10000, // 10 seconds
        timeout: 30000, // 30 seconds
      },
    });

    // Log queries in development
    if (process.env.NODE_ENV === 'development') {
      this.$on('query' as never, (e: any) => {
        this.logger.debug(`Query: ${e.query}`);
        this.logger.debug(`Duration: ${e.duration}ms`);
      });
    }

    // Log errors
    this.$on('error' as never, (e: any) => {
      this.logger.error(`Prisma Error: ${e.message}`);
    });
  }

  async onModuleInit() {
    try {
      if (!this.isConnected) {
        await this.$connect();
        this.isConnected = true;
        this.logger.log('✅ Database connected successfully');
      }
    } catch (error) {
      this.logger.error('❌ Failed to connect to database', error);
      this.isConnected = false;
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      if (this.isConnected) {
        await this.$disconnect();
        this.isConnected = false;
        this.logger.log('🔌 Database disconnected successfully');
      }
      
      // Disconnect scraping client if it exists
      if (this.scrapingClient) {
        await this.scrapingClient.$disconnect();
        this.scrapingClient = null;
        this.logger.log('🔌 Scraping client disconnected successfully');
      }
    } catch (error) {
      this.logger.error('❌ Failed to disconnect from database', error);
      throw error;
    }
  }

  /**
   * Get scraping client that uses session pool (port 5432)
   * This avoids prepared statement conflicts during scraping operations
   */
  async getScrapingClient(): Promise<PrismaClient> {
    if (!this.scrapingClient) {
      // Use pooled connection to avoid environments blocking port 5432
      const databaseUrl = process.env.DATABASE_URL || '';
      if (!databaseUrl) {
        throw new Error('DATABASE_URL not configured');
      }

      // Ensure pooler flags and disable prepared statements for compatibility
      const pooledUrl = databaseUrl.includes('?')
        ? `${databaseUrl}&pgbouncer=true&prepared_statements=false&connection_limit=5&pool_timeout=20`
        : `${databaseUrl}?pgbouncer=true&prepared_statements=false&connection_limit=5&pool_timeout=20`;

      this.scrapingClient = new PrismaClient({
        log: [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'info' },
          { emit: 'event', level: 'warn' },
        ],
        errorFormat: 'pretty',
        datasources: {
          db: { url: pooledUrl },
        },
      });

      // Robust connect with brief retry for transient P1001
      let connected = false;
      let lastErr: any;
      for (let i = 1; i <= 3; i++) {
        try {
          await this.scrapingClient.$connect();
          connected = true;
          break;
        } catch (err: any) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 500 * i));
        }
      }
      if (!connected) {
        this.scrapingClient = null;
        throw lastErr || new Error('Failed to connect scraping client');
      }
      this.logger.log('🔗 Scraping client connected via pooler (6543) with prepared_statements=false');
    }
    
    return this.scrapingClient;
  }

  /**
   * Normalize a connection string to a true direct Postgres session (no pooler, port 5432, ssl required)
   */
  private normalizeDirectSessionUrl(url: string): string {
    try {
      // Handle both postgres:// and postgresql://
      const u = new URL(url);
      // If pointing to pooler host, convert to direct host
      if (u.hostname.includes('.pooler.')) {
        u.hostname = u.hostname.replace('.pooler.', '.');
      }
      // Supabase direct host uses supabase.co (not .com)
      if (u.hostname.endsWith('supabase.com')) {
        u.hostname = u.hostname.replace('supabase.com', 'supabase.co');
      }
      // Supabase direct hosts typically end with supabase.co
      // Ensure port 5432 for direct session
      u.port = '5432';

      // Ensure sslmode=require in query
      const params = u.searchParams;
      if (!params.has('sslmode')) params.set('sslmode', 'require');
      u.search = params.toString();

      return u.toString();
    } catch {
      // Fallback: simple string replacements
      let out = url.replace('.pooler.supabase.com', '.supabase.co');
      out = out.replace(':6543', ':5432').replace(':6432', ':5432');
      if (!out.includes('sslmode=')) {
        out += (out.includes('?') ? '&' : '?') + 'sslmode=require';
      }
      return out;
    }
  }

  /**
   * Ensure connection is active with retry logic
   */
  async ensureConnection(): Promise<void> {
    if (!this.isConnected) {
      try {
        await this.$connect();
        this.isConnected = true;
        this.logger.debug('🔄 Database connection restored');
      } catch (error) {
        this.logger.error('❌ Failed to restore database connection', error);
        throw error;
      }
    }
  }

  /**
   * Execute query with connection retry and aggressive conflict resolution
   */
  async executeWithRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.ensureConnection();
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a prepared statement conflict
        if (error.message?.includes('prepared statement') || 
            error.message?.includes('already exists') ||
            error.message?.includes('42P05')) {
          this.logger.warn(`🔄 Prepared statement conflict (attempt ${attempt}/${maxRetries}), forcing complete reconnection...`);
          
          // Force complete disconnect and recreate connection
          try {
            await this.$disconnect();
            this.isConnected = false;
            
            // Wait longer and force garbage collection
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Force recreate the Prisma client with fresh connection
            await this.recreateClient();
            
            this.logger.debug('🔄 Prisma client recreated successfully');
          } catch (disconnectError) {
            this.logger.warn('Failed to recreate client during retry:', disconnectError);
          }
          
          continue;
        }
        
        // For other errors, don't retry
        throw error;
      }
    }
    
    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Recreate Prisma client to avoid prepared statement conflicts
   */
  private async recreateClient(): Promise<void> {
    try {
      // Disconnect current client
      await this.$disconnect();
      
      // Create new client instance with fresh connection using proper Supabase pooling
      const databaseUrl = process.env.DATABASE_URL;
      const modifiedUrl = databaseUrl?.includes('?') 
        ? `${databaseUrl}&pgbouncer=true&connection_limit=5&pool_timeout=20`
        : `${databaseUrl}?pgbouncer=true&connection_limit=5&pool_timeout=20`;
      
      // Recreate the client with minimal connection pool
      Object.assign(this, new PrismaClient({
        log: [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'info' },
          { emit: 'event', level: 'warn' },
        ],
        errorFormat: 'pretty',
        datasources: {
          db: {
            url: modifiedUrl,
          },
        },
        transactionOptions: {
          maxWait: 10000,
          timeout: 30000,
        },
      }));

      // Reconnect
      await this.$connect();
      this.isConnected = true;
      
      // Re-setup event listeners
      if (process.env.NODE_ENV === 'development') {
        this.$on('query' as never, (e: any) => {
          this.logger.debug(`Query: ${e.query}`);
          this.logger.debug(`Duration: ${e.duration}ms`);
        });
      }

      this.$on('error' as never, (e: any) => {
        this.logger.error(`Prisma Error: ${e.message}`);
      });
      
    } catch (error) {
      this.logger.error('Failed to recreate Prisma client:', error);
      throw error;
    }
  }

  /**
   * Safe database operations with automatic retry and Supabase-specific handling
   */
  async safeFindUnique<T>(model: any, args: any): Promise<T | null> {
    return this.executeWithRetry(async () => {
      try {
        return await model.findUnique(args);
      } catch (error: any) {
        // If it's a prepared statement error, try raw SQL as fallback
        if (error.message?.includes('prepared statement') || 
            error.message?.includes('already exists') ||
            error.message?.includes('42P05')) {
          this.logger.warn('🔄 Prepared statement conflict, trying raw SQL fallback');
          return await this.executeRawQuery(args);
        }
        throw error;
      }
    });
  }

  /**
   * Execute operation with Supabase-optimized connection strategy
   */
  async executeWithSupabaseStrategy<T>(operation: () => Promise<T>): Promise<T> {
    try {
      // First try with pooled connection (faster for most operations)
      return await operation();
    } catch (error: any) {
      // If pooled connection fails due to prepared statements, switch to direct connection
      if (error.message?.includes('prepared statement') || 
          error.message?.includes('already exists') ||
          error.message?.includes('42P05')) {
        this.logger.warn('🔄 Switching to direct connection for this operation');
        return await this.executeWithDirectConnection(operation);
      }
      throw error;
    }
  }

  /**
   * Execute operation using direct connection (bypasses pooler)
   */
  private async executeWithDirectConnection<T>(operation: () => Promise<T>): Promise<T> {
    const directUrl = process.env.DIRECT_URL;
    if (!directUrl) {
      throw new Error('DIRECT_URL not configured');
    }

    // Create a temporary direct connection client
    const directClient = new PrismaClient({
      datasources: {
        db: {
          url: directUrl,
        },
      },
    });

    try {
      await directClient.$connect();
      // Replace the model's client temporarily
      const originalClient = this;
      Object.assign(this, directClient);
      
      const result = await operation();
      
      // Restore original client
      Object.assign(this, originalClient);
      
      return result;
    } finally {
      await directClient.$disconnect();
    }
  }

  /**
   * Execute raw SQL query as fallback for prepared statement conflicts
   */
  private async executeRawQuery(args: any): Promise<any> {
    const { where } = args;
    if (!where || !where.email) {
      throw new Error('Raw query fallback only supports email lookup');
    }

    const result = await this.$queryRaw`
      SELECT id, name, email, phone, city, country, address, "hashPassword", "createdAt", "updatedAt"
      FROM "Client" 
      WHERE email = ${where.email}
      LIMIT 1
    `;
    
    return Array.isArray(result) ? result[0] : result;
  }

  async safeUpdate<T>(model: any, args: any): Promise<T> {
    return this.executeWithRetry(async () => {
      return await model.update(args);
    });
  }

  async safeCreate<T>(model: any, args: any): Promise<T> {
    return this.executeWithRetry(async () => {
      return await model.create(args);
    });
  }

  async safeFindMany<T>(model: any, args?: any): Promise<T[]> {
    return this.executeWithRetry(async () => {
      return await model.findMany(args);
    });
  }

  async safeDelete<T>(model: any, args: any): Promise<T> {
    return this.executeWithRetry(async () => {
      return await model.delete(args);
    });
  }

  /**
   * Enable shutdown hooks for graceful shutdown
   * This ensures connections are properly closed when the app terminates
   */
  async enableShutdownHooks(app: any) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }

  /**
   * Clean connection helper - useful for testing or manual cleanup
   */
  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot clean database in production!');
    }

    const models = Object.keys(this).filter(
      (key) => !key.startsWith('_') && !key.startsWith('$'),
    );

    return Promise.all(
      models.map((model) => {
        const modelKey = model as keyof typeof this;
        if (typeof this[modelKey] === 'object' && this[modelKey] !== null) {
          return (this[modelKey] as any).deleteMany?.();
        }
      }),
    );
  }
}
