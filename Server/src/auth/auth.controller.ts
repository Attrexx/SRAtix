import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Param,
  Get,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService, TokenPair } from './auth.service';
import { IsNumber, IsArray, IsString, IsOptional, IsEmail, MinLength, IsNotEmpty } from 'class-validator';
import { RateLimit } from '../common/guards/rate-limit.guard';
import { FastifyRequest, FastifyReply } from 'fastify';

// ── Response shape returned to the SPA ─────────────────────────────────────
// The refresh token is NOT included here; it is set as an httpOnly cookie.
// Only the short-lived access token and user identity are returned to the client.
export interface ClientAuthResponse {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    displayName: string;
    roles: string[];
  };
}

class ExchangeTokenDto {
  @IsNumber()
  wpUserId!: number;

  @IsArray()
  @IsString({ each: true })
  wpRoles!: string[];

  @IsString()
  signature!: string;

  @IsString()
  sourceSite!: string;

  @IsOptional()
  @IsString()
  timestamp?: string;

  @IsOptional()
  @IsString()
  nonce?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

class InitSessionDto {
  @IsString()
  refreshToken!: string;
}

class RefreshTokenDto {
  // Refresh token may come from the request body (API clients / backward compat)
  // OR from the httpOnly 'sratix_rt' cookie (dashboard SPA).
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

class SraVerifyDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @IsNotEmpty()
  eventId!: string;
}

class RobotxVerifyDto {
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}

@Controller('auth')
export class AuthController {
  private readonly isProduction: boolean;

  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {
    this.isProduction = config.get<string>('NODE_ENV', 'development') === 'production';
  }

  // ── Cookie helpers ──────────────────────────────────────────────────────

  /**
   * Set the httpOnly refresh token cookie on the response.
   * The cookie is scoped to /api/auth to minimise its exposure window.
   */
  private setRefreshCookie(reply: FastifyReply, refreshToken: string): void {
    reply.setCookie('sratix_rt', refreshToken, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      path: '/api/auth',          // only sent to the auth refresh endpoint
      maxAge: 7 * 24 * 3600,      // 7 days, matches JWT expiry
    });
  }

  /**
   * Clear the refresh token cookie (on logout).
   */
  private clearRefreshCookie(reply: FastifyReply): void {
    reply.clearCookie('sratix_rt', { path: '/api/auth' });
  }

  /**
   * Build the client-facing auth response (no refresh token — it's in the cookie).
   * User identity is decoded directly from the token payload without an extra DB round-trip.
   */
  private buildClientResponse(tokens: TokenPair & { user?: ClientAuthResponse['user'] }): ClientAuthResponse {
    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      user: tokens.user ?? { id: '', email: '', displayName: '', roles: [] },
    };
  }

  // ── Endpoints ────────────────────────────────────────────────────────────

  /**
   * POST /api/auth/token
   * WP plugin ↔ Server token exchange (OAuth2-lite).
   * The WP Control plugin POSTs HMAC-signed credentials and receives back a
   * token pair.  The refresh token is set as a cookie; only the access token
   * is returned in the response body so the WP plugin can redirect the admin
   * to the dashboard without any tokens appearing in the URL.
   */
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, windowSec: 60 })
  async exchangeToken(
    @Body() dto: ExchangeTokenDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ClientAuthResponse> {
    const tokens = await this.authService.exchangeToken(
      dto.wpUserId,
      dto.wpRoles,
      dto.signature,
      dto.sourceSite,
      dto.email,
      dto.displayName,
      dto.timestamp,
      dto.nonce,
    );
    this.setRefreshCookie(reply, tokens.refreshToken);
    return this.buildClientResponse(tokens);
  }

  /**
   * POST /api/auth/refresh
   * Exchange a valid refresh token for a new access + refresh token pair.
   * The refresh token is read from (in priority order):
   *   1. The httpOnly `sratix_rt` cookie  (dashboard SPA)
   *   2. The `refreshToken` field in the request body  (API clients / WP plugins)
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowSec: 60 })
  async refreshToken(
    @Body() dto: RefreshTokenDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ClientAuthResponse> {
    // Cookie takes precedence; body is the fallback for non-browser clients
    const rt = (req.cookies as Record<string, string>)?.sratix_rt ?? dto.refreshToken;
    const tokens = await this.authService.refreshAccessToken(rt ?? '');
    this.setRefreshCookie(reply, tokens.refreshToken);
    return this.buildClientResponse(tokens);
  }

  /**
   * POST /api/auth/login
   * Email + password authentication (app-native accounts).
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSec: 60 })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ClientAuthResponse> {
    const tokens = await this.authService.loginWithPassword(dto.email, dto.password);
    this.setRefreshCookie(reply, tokens.refreshToken);
    return this.buildClientResponse(tokens);
  }

  /**
   * POST /api/auth/logout
   * Clears the httpOnly refresh token cookie and revokes all outstanding
   * refresh tokens for the user by incrementing tokenVersion in the DB.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    // Best-effort revocation — extract user ID from cookie
    const rt = (req.cookies as Record<string, string>)?.sratix_rt;
    if (rt) {
      try {
        const decoded = this.authService.validateTokenSync(rt);
        if (decoded?.sub) {
          await this.authService.revokeUserTokens(decoded.sub);
        }
      } catch {
        // Token may already be expired / invalid — still clear the cookie
      }
    }
    this.clearRefreshCookie(reply);
  }

  /**
   * POST /api/auth/init-session
   * Converts a bare refresh token (from the WP redirect URL) into a proper
   * httpOnly cookie session.  Called by the dashboard login page immediately
   * after receiving a ?refresh= URL param so the token is persisted securely
   * and removed from the URL.
   *
   * This endpoint lets the WP Control plugin flow continue to work while still
   * hardening token storage — the refresh token spends only milliseconds in the
   * URL before being promoted to a cookie.
   */
  @Post('init-session')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, windowSec: 60 })
  async initSession(
    @Body() dto: InitSessionDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ClientAuthResponse> {
    const tokens = await this.authService.refreshAccessToken(dto.refreshToken);
    this.setRefreshCookie(reply, tokens.refreshToken);
    return this.buildClientResponse(tokens);
  }

  /**
   * GET /api/auth/confirm/:token
   * Email confirmation via token link.
   */
  @Get('confirm/:token')
  async confirmEmail(@Param('token') token: string) {
    return this.authService.confirmEmail(token);
  }

  /**
   * POST /api/auth/sra-verify
   * Proxy SRA credential verification through to swiss-robotics.org.
   * Returns a short-lived session token encoding the member's tier.
   */
  @Post('sra-verify')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSec: 60 })
  async sraVerify(@Body() dto: SraVerifyDto) {
    return this.authService.verifySraMember(dto.email, dto.password, dto.eventId);
  }

  /**
   * POST /api/auth/robotx-verify
   * Verify a RobotX shared access code for a given event.
   */
  @Post('robotx-verify')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, windowSec: 60 })
  async robotxVerify(@Body() dto: RobotxVerifyDto) {
    return this.authService.verifyRobotxCode(dto.eventId, dto.code);
  }
}
