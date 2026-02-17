import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';

/**
 * Rate limit configuration per route.
 * Uses in-memory store (Phase 1). Phase 2: Redis-backed via ioredis.
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
 * In-memory rate limiter guard.
 *
 * Default: 100 requests / 60 seconds per IP.
 * Override per-route with @RateLimit({ limit: 10, windowSec: 60 }).
 *
 * Phase 2: Replace in-memory Map with Redis (ioredis) for multi-instance support.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly store = new Map<string, RateLimitEntry>();

  /** Default limits */
  private readonly defaultLimit = 100;
  private readonly defaultWindowSec = 60;

  /** Cleanup interval — evict expired entries every 5 minutes */
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private readonly reflector: Reflector) {
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60_000);
  }

  canActivate(context: ExecutionContext): boolean {
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
    const key = `${ip}:${routeKey}`;

    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.resetAt) {
      // First request or window expired — start fresh
      this.store.set(key, {
        count: 1,
        resetAt: now + windowSec * 1000,
      });
      this.setRateLimitHeaders(context, limit, limit - 1, windowSec);
      return true;
    }

    entry.count++;

    if (entry.count > limit) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      this.setRateLimitHeaders(context, limit, 0, retryAfterSec);

      this.logger.warn(
        `Rate limit exceeded: ${ip} on ${routeKey} (${entry.count}/${limit})`,
      );

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

  private cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.resetAt) {
        this.store.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug(`Rate limit cleanup: evicted ${cleaned} expired entries`);
    }
  }
}
