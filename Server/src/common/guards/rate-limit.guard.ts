import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SetMetadata } from '@nestjs/common';

/**
 * Rate limit configuration per route.
 */
export interface RateLimitOptions {
  /** Max requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSec: number;
}

/** Decorator to set per-route rate limits */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata('rateLimit', options);

/** Decorator to skip rate limiting (e.g. health check) */
export const SkipRateLimit = () => SetMetadata('skipRateLimit', true);

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Rate limiter guard with Redis-backed store (falls back to in-memory if
 * REDIS_URL is not configured).
 *
 * Default: 100 requests / 60 seconds per IP.
 * Override per-route with @RateLimit({ limit: 10, windowSec: 60 }).
 */
@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitGuard.name);

  /** In-memory fallback store (used when Redis is unavailable) */
  private readonly memStore = new Map<string, RateLimitEntry>();

  /** Redis client — null if not configured or connection failed */
  private redis: import('ioredis').default | null = null;

  /** Default limits */
  private readonly defaultLimit = 100;
  private readonly defaultWindowSec = 60;

  /** Cleanup interval for in-memory fallback — evict expired entries every 5 minutes */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL not set — rate limiter using in-memory store');
      this.startMemoryCleanup();
      return;
    }

    try {
      const { default: Redis } = await import('ioredis');
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      await this.redis.connect();
      this.logger.log('Rate limiter connected to Redis');
    } catch (err) {
      this.logger.warn(`Redis connection failed — falling back to in-memory rate limiter: ${err}`);
      this.redis = null;
      this.startMemoryCleanup();
    }
  }

  onModuleDestroy() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.redis?.disconnect();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check for skip decorator
    const skip = this.reflector.getAllAndOverride<boolean>('skipRateLimit', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    // Get route-specific limits or defaults
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      'rateLimit',
      [context.getHandler(), context.getClass()],
    );
    const limit = options?.limit ?? this.defaultLimit;
    const windowSec = options?.windowSec ?? this.defaultWindowSec;

    // Extract client IP from Fastify request
    const request = context.switchToHttp().getRequest();
    const ip =
      request.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ??
      request.ip ??
      'unknown';

    // Build a key scoped to route + IP
    const routeKey = `${request.method}:${request.routeOptions?.url ?? request.url}`;
    const key = `rl:${ip}:${routeKey}`;

    if (this.redis) {
      return this.checkRedis(context, key, limit, windowSec, ip, routeKey);
    }
    return this.checkMemory(context, key, limit, windowSec, ip, routeKey);
  }

  // ── Redis-backed check ──────────────────────────────────────────

  private async checkRedis(
    context: ExecutionContext,
    key: string,
    limit: number,
    windowSec: number,
    ip: string,
    routeKey: string,
  ): Promise<boolean> {
    try {
      const count = await this.redis!.incr(key);
      if (count === 1) {
        await this.redis!.expire(key, windowSec);
      }

      const ttl = await this.redis!.ttl(key);
      const retryAfterSec = ttl > 0 ? ttl : windowSec;

      if (count > limit) {
        this.setRateLimitHeaders(context, limit, 0, retryAfterSec);
        this.logger.warn(`Rate limit exceeded: ${ip} on ${routeKey} (${count}/${limit})`);
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Too many requests. Please try again later.',
            retryAfterSec,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      this.setRateLimitHeaders(context, limit, limit - count, retryAfterSec);
      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis error — fall through to allow request (fail-open)
      this.logger.warn(`Redis rate-limit check failed, allowing request: ${err}`);
      return true;
    }
  }

  // ── In-memory fallback ──────────────────────────────────────────

  private checkMemory(
    context: ExecutionContext,
    key: string,
    limit: number,
    windowSec: number,
    ip: string,
    routeKey: string,
  ): boolean {
    const now = Date.now();
    const entry = this.memStore.get(key);

    if (!entry || now > entry.resetAt) {
      this.memStore.set(key, { count: 1, resetAt: now + windowSec * 1000 });
      this.setRateLimitHeaders(context, limit, limit - 1, windowSec);
      return true;
    }

    entry.count++;

    if (entry.count > limit) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      this.setRateLimitHeaders(context, limit, 0, retryAfterSec);
      this.logger.warn(`Rate limit exceeded: ${ip} on ${routeKey} (${entry.count}/${limit})`);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests. Please try again later.',
          retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const remaining = limit - entry.count;
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    this.setRateLimitHeaders(context, limit, remaining, retryAfterSec);
    return true;
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private setRateLimitHeaders(
    context: ExecutionContext,
    limit: number,
    remaining: number,
    resetSec: number,
  ) {
    const response = context.switchToHttp().getResponse();
    response.header('X-RateLimit-Limit', String(limit));
    response.header('X-RateLimit-Remaining', String(Math.max(0, remaining)));
    response.header('X-RateLimit-Reset', String(resetSec));
  }

  private startMemoryCleanup() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [key, entry] of this.memStore) {
        if (now > entry.resetAt) {
          this.memStore.delete(key);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        this.logger.debug(`Rate limit cleanup: evicted ${cleaned} expired entries`);
      }
    }, 5 * 60_000);
  }
}
