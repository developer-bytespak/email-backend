import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private isConnected = false;
  private scrapingClient: PrismaClient | null = null;

  constructor() {
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
          url: process.env.DATABASE_URL,
        },
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
      // Create a new Prisma client specifically for scraping using session pool
      const sessionPoolUrl = process.env.DATABASE_URL?.replace(/:\d+/, ':5432') || process.env.DATABASE_URL;
      
      this.scrapingClient = new PrismaClient({
        log: [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'info' },
          { emit: 'event', level: 'warn' },
        ],
        errorFormat: 'pretty',
        datasources: {
          db: {
            url: sessionPoolUrl,
          },
        },
      });

      // Connect the scraping client
      await this.scrapingClient.$connect();
      this.logger.log('🔗 Scraping client connected to session pool (port 5432)');
    }
    
    return this.scrapingClient;
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
   * Execute query with connection retry
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
            error.message?.includes('already exists')) {
          this.logger.warn(`🔄 Prepared statement conflict (attempt ${attempt}/${maxRetries}), retrying...`);
          
          // Force disconnect and reconnect
          try {
            await this.$disconnect();
            this.isConnected = false;
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          } catch (disconnectError) {
            this.logger.warn('Failed to disconnect during retry:', disconnectError);
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
   * Safe database operations with automatic retry
   */
  async safeFindUnique<T>(model: any, args: any): Promise<T | null> {
    return this.executeWithRetry(async () => {
      return await model.findUnique(args);
    });
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

