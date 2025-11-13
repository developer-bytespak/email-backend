import { Injectable } from '@nestjs/common';

interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

@Injectable()
export class ProxyManagerService {
  private proxies: ProxyConfig[] = [];
  private currentIndex: number = 0;
  private failedProxies: Set<number> = new Set();

  constructor() {
    this.loadProxies();
  }

  /**
   * Load proxies from environment variables
   * Format: WEBSHARE_PROXIES="http://user:pass@host1:port1,http://user:pass@host2:port2,..."
   * Or individual: WEBSHARE_PROXY_1, WEBSHARE_PROXY_2, etc.
   */
  private loadProxies(): void {
    // Try loading from comma-separated list
    const proxiesEnv = process.env.WEBSHARE_PROXIES;
    if (proxiesEnv) {
      const proxyList = proxiesEnv.split(',').map(p => p.trim()).filter(p => p);
      this.proxies = proxyList.map(proxy => this.parseProxy(proxy));
      console.log(`[PROXY] Loaded ${this.proxies.length} proxies from WEBSHARE_PROXIES`);
    } else {
      // Try loading individual proxy variables (WEBSHARE_PROXY_1, WEBSHARE_PROXY_2, etc.)
      let index = 1;
      const loadedProxies: ProxyConfig[] = [];
      
      while (true) {
        const proxyEnv = process.env[`WEBSHARE_PROXY_${index}`];
        if (!proxyEnv) break;
        
        loadedProxies.push(this.parseProxy(proxyEnv));
        index++;
      }
      
      if (loadedProxies.length > 0) {
        this.proxies = loadedProxies;
        console.log(`[PROXY] Loaded ${this.proxies.length} proxies from individual WEBSHARE_PROXY_* variables`);
      } else {
        console.log(`[PROXY] No proxies configured. Scraping will use direct connection.`);
      }
    }
  }

  /**
   * Parse proxy string into ProxyConfig
   * Supports formats:
   * - http://username:password@host:port
   * - socks5://username:password@host:port
   * - http://host:port (no auth)
   */
  private parseProxy(proxyString: string): ProxyConfig {
    try {
      const url = new URL(proxyString);
      const config: ProxyConfig = {
        server: `${url.protocol}//${url.hostname}:${url.port}`,
      };

      if (url.username || url.password) {
        config.username = url.username || undefined;
        config.password = url.password || undefined;
      }

      return config;
    } catch (error) {
      console.error(`[PROXY] Invalid proxy format: ${proxyString}`, error);
      throw new Error(`Invalid proxy format: ${proxyString}`);
    }
  }

  /**
   * Get next proxy in rotation (round-robin)
   */
  getNextProxy(): ProxyConfig | null {
    if (this.proxies.length === 0) {
      return null;
    }

    // If all proxies failed, reset failed list
    if (this.failedProxies.size >= this.proxies.length) {
      console.log(`[PROXY] All proxies failed, resetting failed list`);
      this.failedProxies.clear();
    }

    // Find next available proxy
    let attempts = 0;
    while (attempts < this.proxies.length) {
      const proxy = this.proxies[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;

      if (!this.failedProxies.has(this.currentIndex - 1 === -1 ? this.proxies.length - 1 : this.currentIndex - 1)) {
        return proxy;
      }

      attempts++;
    }

    // If all are failed, return first one anyway
    return this.proxies[0];
  }

  /**
   * Mark a proxy as failed
   */
  markProxyFailed(proxy: ProxyConfig): void {
    const index = this.proxies.findIndex(p => p.server === proxy.server);
    if (index !== -1) {
      this.failedProxies.add(index);
      console.log(`[PROXY] Marked proxy ${index + 1} as failed: ${proxy.server}`);
    }
  }

  /**
   * Reset failed proxies (call periodically to retry failed proxies)
   */
  resetFailedProxies(): void {
    this.failedProxies.clear();
    console.log(`[PROXY] Reset failed proxies list`);
  }

  /**
   * Get proxy count
   */
  getProxyCount(): number {
    return this.proxies.length;
  }

  /**
   * Check if proxies are configured
   */
  hasProxies(): boolean {
    return this.proxies.length > 0;
  }

  /**
   * Get Playwright proxy format
   */
  getPlaywrightProxy(proxy: ProxyConfig | null): { server: string; username?: string; password?: string } | undefined {
    if (!proxy) return undefined;

    return {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password,
    };
  }

  /**
   * Get Axios/Cheerio proxy format
   */
  getAxiosProxy(proxy: ProxyConfig | null): { host: string; port: number; auth?: { username: string; password: string } } | undefined {
    if (!proxy) return undefined;

    try {
      const url = new URL(proxy.server);
      const config: any = {
        host: url.hostname,
        port: parseInt(url.port, 10),
      };

      if (proxy.username && proxy.password) {
        config.auth = {
          username: proxy.username,
          password: proxy.password,
        };
      }

      return config;
    } catch (error) {
      console.error(`[PROXY] Error converting proxy for axios:`, error);
      return undefined;
    }
  }
}

