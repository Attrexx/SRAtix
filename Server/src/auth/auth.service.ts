import { Injectable, UnauthorizedException, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcrypt';
import { VALID_ROLES } from '../users/users.service';
import { AuditLogService, AuditAction } from '../audit-log/audit-log.service';

export interface JwtPayload {
  sub: string; // user ID
  email: string;
  displayName?: string;
  roles: string[];
  eventId?: string;
  orgId?: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  /** User identity included so callers can build a client response without decoding the JWT. */
  user: {
    id: string;
    email: string;
    displayName: string;
    roles: string[];
  };
}

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);

  /** In-memory nonce cache for replay protection (key → timestamp). */
  private readonly usedNonces = new Map<string, number>();

  /** Cleanup interval for expired nonces (every 5 minutes). */
  private readonly nonceCleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {
    // Purge nonces older than 10 minutes every 5 minutes
    this.nonceCleanupInterval = setInterval(() => {
      const cutoff = Math.floor(Date.now() / 1000) - 600;
      for (const [key, ts] of this.usedNonces) {
        if (ts < cutoff) this.usedNonces.delete(key);
      }
    }, 300_000);
  }

  onModuleDestroy() {
    clearInterval(this.nonceCleanupInterval);
  }

  /**
   * Exchange WP plugin credentials for a JWT token pair.
   * Called by SRAtix Control plugin via server-to-server auth.
   */
  async exchangeToken(
    wpUserId: number,
    wpRoles: string[],
    signature: string,
    sourceSite: string,
    wpEmail?: string,
    wpDisplayName?: string,
    timestamp?: string,
    nonce?: string,
  ): Promise<TokenPair> {
    // ── Replay protection: validate timestamp & nonce ──────────────────
    if (timestamp && nonce) {
      const now = Math.floor(Date.now() / 1000);
      const ts = parseInt(timestamp, 10);
      if (isNaN(ts) || Math.abs(now - ts) > 300) {
        this.logger.warn(`Token exchange rejected: stale timestamp (${timestamp}) from ${sourceSite}`);
        throw new UnauthorizedException('Request expired');
      }

      // Nonce dedup — store in-memory (or Redis if available) for 10 minutes
      const nonceKey = `exchange:${nonce}`;
      if (this.usedNonces.has(nonceKey)) {
        this.logger.warn(`Token exchange rejected: replayed nonce from ${sourceSite}`);
        throw new UnauthorizedException('Duplicate request');
      }
      this.usedNonces.set(nonceKey, now);
    }

    // Verify the HMAC signature from the WP plugin
    const secret = this.config.getOrThrow<string>('WP_API_SECRET');
    // Include timestamp + nonce in HMAC if present (backward-compatible)
    let payload = `${wpUserId}:${wpRoles.sort().join(',')}:${sourceSite}`;
    if (timestamp && nonce) {
      payload += `:${timestamp}:${nonce}`;
    }
    const expectedSig = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      this.logger.warn(
        `Invalid signature for WP user ${wpUserId} from ${sourceSite}`,
      );
      this.audit.log({
        action: AuditAction.AUTH_FAILED,
        entity: 'auth',
        detail: { reason: 'invalid_signature', wpUserId, sourceSite },
      });
      throw new UnauthorizedException('Invalid signature');
    }

    // Map WP user to SRAtix user via WpMapping table
    const mapping = await this.prisma.wpMapping.findUnique({
      where: {
        wpEntityType_wpEntityId: {
          wpEntityType: 'user',
          wpEntityId: wpUserId,
        },
      },
    });

    let userId: string;
    let email = '';
    let displayName = '';
    let orgId: string | undefined;

    if (mapping) {
      // Existing mapping — resolve user
      userId = mapping.sratixEntityId;
      orgId = mapping.orgId ?? undefined;

      // Fetch display info from User record
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, displayName: true, tokenVersion: true },
      });
      if (user) {
        email = user.email;
        // Update last login + refresh email/displayName from WP if provided
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            lastLoginAt: new Date(),
            ...(wpEmail ? { email: wpEmail } : {}),
            ...(wpDisplayName ? { displayName: wpDisplayName } : {}),
          },
        });
        if (wpEmail) email = wpEmail;
        if (wpDisplayName) displayName = wpDisplayName;
        else if (!displayName) displayName = user.displayName;
      }
    } else {
      // First login — create User + WpMapping
      // Generate a stable user ID from WP site + user ID
      const user = await this.prisma.user.create({
        data: {
          email: wpEmail ?? `wp-${wpUserId}@${sourceSite}`,
          displayName: wpDisplayName ?? `WP User ${wpUserId}`,
          wpUserId,
          lastLoginAt: new Date(),
        },
      });
      userId = user.id;
      email = user.email;

      // Create bidirectional mapping
      await this.prisma.wpMapping.create({
        data: {
          wpEntityType: 'user',
          wpEntityId: wpUserId,
          sratixEntityType: 'user',
          sratixEntityId: userId,
        },
      });

      this.logger.log(
        `Created SRAtix user ${userId} for WP user ${wpUserId}@${sourceSite}`,
      );
    }

    // Map WP roles to SRAtix roles
    const sratixRoles = this.mapWpRoles(wpRoles);

    // Sync roles to UserRole table (replace existing global-scope roles)
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({
        where: { userId, orgId: null },
      }),
      ...sratixRoles.map((role) =>
        this.prisma.userRole.create({
          data: { userId, orgId: orgId ?? null, role },
        }),
      ),
    ]);

    // Resolve tokenVersion — 0 for newly created users
    let tokenVersion = 0;
    if (mapping) {
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { tokenVersion: true },
      });
      tokenVersion = u?.tokenVersion ?? 0;
    }

    this.audit.log({
      userId,
      action: AuditAction.AUTH_TOKEN_EXCHANGE,
      entity: 'auth',
      detail: { wpUserId, sourceSite, roles: sratixRoles },
    });

    return this.generateTokenPair({
      sub: userId,
      email,
      displayName: displayName || email.split('@')[0],
      roles: sratixRoles,
      orgId,
    }, tokenVersion);
  }

  /**
   * Generate a new access + refresh token pair.
   * Also returns the user identity so the controller can build a client response
   * without an extra DB call or client-side JWT decoding.
   */
  async generateTokenPair(
    payload: Omit<JwtPayload, 'iat' | 'exp'> & { displayName?: string },
    tokenVersion = 0,
  ): Promise<TokenPair> {
    const accessToken = this.jwt.sign(payload, { expiresIn: '15m' });
    const refreshToken = this.jwt.sign(
      { sub: payload.sub, type: 'refresh', ver: tokenVersion },
      { expiresIn: '7d' },
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
      user: {
        id: payload.sub,
        email: payload.email,
        displayName: payload.displayName ?? payload.email.split('@')[0],
        roles: payload.roles,
      },
    };
  }

  /**
   * Exchange a valid refresh token for a new token pair.
   * Looks up the user from DB to get current email/roles.
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
    let decoded: { sub: string; type?: string; ver?: number };
    try {
      decoded = this.jwt.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (decoded.type !== 'refresh') {
      throw new UnauthorizedException('Token is not a refresh token');
    }

    // Look up user from DB to get current data
    const user = await this.prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, displayName: true, wpUserId: true, tokenVersion: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Reject refresh tokens issued before the latest revocation
    if ((decoded.ver ?? 0) < user.tokenVersion) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // Look up WP mapping to resolve orgId
    let orgId: string | undefined;
    if (user.wpUserId) {
      const mapping = await this.prisma.wpMapping.findUnique({
        where: {
          wpEntityType_wpEntityId: {
            wpEntityType: 'user',
            wpEntityId: user.wpUserId,
          },
        },
      });
      orgId = mapping?.orgId ?? undefined;
    }

    // Look up user's current roles from UserRole table
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: decoded.sub },
      select: { role: true },
    });

    const roles = userRoles.map((ur) => ur.role);

    // If no roles stored in DB, fallback to attendee
    const effectiveRoles = roles.length > 0 ? roles : ['attendee'];

    // Update last login
    await this.prisma.user.update({
      where: { id: decoded.sub },
      data: { lastLoginAt: new Date() },
    });

    return this.generateTokenPair({
      sub: decoded.sub,
      email: user.email,
      displayName: user.displayName,
      roles: effectiveRoles,
      orgId,
    }, user.tokenVersion);
  }

  /**
   * Verify and decode a JWT token.
   */
  async validateToken(token: string): Promise<JwtPayload> {
    try {
      return this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Decode a JWT without throwing. Returns null on any failure.
   * Used for best-effort operations like logout revocation.
   */
  validateTokenSync(token: string): { sub: string; type?: string } | null {
    try {
      return this.jwt.verify(token) as { sub: string; type?: string };
    } catch {
      return null;
    }
  }

  /**
   * Map WordPress roles to SRAtix RBAC roles.
   */
  private mapWpRoles(wpRoles: string[]): string[] {
    const roleMap: Record<string, string> = {
      administrator: 'super_admin',
      editor: 'event_admin',
      author: 'staff',
      subscriber: 'attendee',
      pm_group_leader: 'event_admin',
      corporate_member: 'organization_admin',
      // SRAtix custom WP roles (created by SRA Ticketing plugin)
      sratix_event_manager: 'event_admin',
      sratix_attendee: 'attendee',
      sratix_exhibitor: 'exhibitor',
      sratix_speaker: 'attendee',
      sratix_sponsor: 'sponsor',
      sratix_volunteer: 'volunteer',
    };

    return wpRoles
      .map((r) => roleMap[r])
      .filter((r): r is string => r !== undefined);
  }

  // ═══════════════════════════════════════════════════════════════
  // Email + Password Authentication (app-native accounts)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Authenticate with email + password.
   * Returns JWT token pair on success.
   */
  async loginWithPassword(
    email: string,
    password: string,
  ): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: true },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const roles = user.roles.map((r) => r.role);
    const effectiveRoles = roles.length > 0 ? roles : ['attendee'];
    const orgId = user.roles.find((r) => r.orgId)?.orgId ?? undefined;

    return this.generateTokenPair({
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: effectiveRoles,
      orgId,
    }, user.tokenVersion);
  }

  /**
   * Revoke all refresh tokens for a user by incrementing tokenVersion.
   * Called on logout to invalidate all existing sessions.
   */
  async revokeUserTokens(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  /**
   * Create an app-native user (Super Admin only).
   * Returns the created user with a confirmation token for email verification.
   */
  async createAppUser(data: {
    email: string;
    displayName: string;
    password: string;
    roles: string[];
    orgId?: string;
  }) {
    // Validate all roles before creating the user
    const invalidRoles = data.roles.filter((r) => !(VALID_ROLES as readonly string[]).includes(r));
    if (invalidRoles.length > 0) {
      throw new UnauthorizedException(`Unknown role(s): ${invalidRoles.join(', ')}`);
    }

    // Check for duplicate email
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existing) {
      throw new UnauthorizedException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const confirmToken = randomBytes(32).toString('hex');

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        displayName: data.displayName,
        passwordHash,
        confirmToken,
        // Auto-confirm for admin-created accounts
        emailConfirmedAt: new Date(),
      },
    });

    // Assign roles
    for (const role of data.roles) {
      await this.prisma.userRole.create({
        data: {
          userId: user.id,
          orgId: data.orgId ?? null,
          role,
        },
      });
    }

    this.logger.log(
      `Created app user ${user.id} (${data.email}) with roles: ${data.roles.join(', ')}`,
    );

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: data.roles,
      active: user.active,
      createdAt: user.createdAt,
    };
  }

  /**
   * Confirm email via token. Clears the token and sets emailConfirmedAt.
   */
  async confirmEmail(token: string): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { confirmToken: token },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid confirmation token');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailConfirmedAt: new Date(),
        confirmToken: null,
      },
    });

    return { success: true };
  }

  /**
   * Hash a password (for seeding / admin resets).
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  // ─── Member verification (SRA + RobotX) ────────────────────────

  /**
   * Proxy SRA credential verification through to sratix-control on swiss-robotics.org.
   * Returns a short-lived session token encoding the member context.
   */
  async verifySraMember(
    email: string,
    password: string,
    eventId: string,
  ): Promise<{
    authenticated: boolean;
    firstName?: string;
    lastName?: string;
    membershipTier?: string;
    sessionToken?: string;
    error?: string;
  }> {
    // Resolve the SRA WP API URL from settings, then env
    const wpApiUrl = await this.resolveWpApiUrl();
    if (!wpApiUrl) {
      this.logger.error('SRA WP API URL not configured');
      throw new UnauthorizedException('Member verification unavailable');
    }

    const body = JSON.stringify({ email, password });
    const secret = this.config.getOrThrow<string>('WEBHOOK_SIGNING_SECRET');
    const signature = createHmac('sha256', body, { encoding: 'utf8' })
      .update('')
      .digest('hex');
    // Re-compute: signature = HMAC-SHA256(body, secret)
    const hmac = createHmac('sha256', secret).update(body).digest('hex');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const url = `${wpApiUrl.replace(/\/+$/, '')}/wp-json/sratix-control/v1/auth/sra-verify`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SRAtix-Signature': hmac,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok && response.status !== 200) {
        this.logger.warn(`SRA verify failed with HTTP ${response.status} for ${email}`);
        return { authenticated: false, error: 'verification_failed' };
      }

      const result = (await response.json()) as {
        valid: boolean;
        wpUserId?: number;
        email?: string;
        firstName?: string;
        lastName?: string;
        membershipTier?: string | null;
        roles?: string[];
        error?: string;
      };

      if (!result.valid) {
        return { authenticated: false, error: result.error ?? 'invalid_credentials' };
      }

      // Issue a short-lived session token (2hr TTL)
      const sessionToken = this.jwt.sign(
        {
          memberGroup: 'sra',
          tier: result.membershipTier ?? null,
          eventId,
          email: result.email,
          wpUserId: result.wpUserId,
        },
        { expiresIn: '2h' },
      );

      return {
        authenticated: true,
        firstName: result.firstName,
        lastName: result.lastName,
        membershipTier: result.membershipTier ?? undefined,
        sessionToken,
      };
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        this.logger.error('SRA verify request timed out');
      } else {
        this.logger.error(`SRA verify request failed: ${err.message}`);
      }
      return { authenticated: false, error: 'verification_failed' };
    }
  }

  /**
   * Verify a RobotX access code against the Event's meta.robotxAccessCode.
   * Returns a short-lived session token on success.
   */
  async verifyRobotxCode(
    eventId: string,
    code: string,
  ): Promise<{ valid: boolean; sessionToken?: string }> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { meta: true },
    });

    if (!event) {
      return { valid: false };
    }

    const meta = (event.meta as Record<string, unknown>) ?? {};
    const storedCode = meta.robotxAccessCode as string | undefined;

    if (!storedCode || !code) {
      return { valid: false };
    }

    // Timing-safe comparison (case-insensitive)
    const a = Buffer.from(storedCode.toLowerCase(), 'utf8');
    const b = Buffer.from(code.toLowerCase(), 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false };
    }

    const sessionToken = this.jwt.sign(
      {
        memberGroup: 'robotx',
        eventId,
      },
      { expiresIn: '2h' },
    );

    return { valid: true, sessionToken };
  }

  /**
   * Decode and validate a member session token.
   * Returns the decoded payload or null if invalid/expired.
   */
  decodeMemberSession(
    token: string,
  ): { memberGroup: string; tier?: string; eventId: string } | null {
    try {
      const payload = this.jwt.verify(token) as {
        memberGroup: string;
        tier?: string;
        eventId: string;
      };
      if (!payload.memberGroup || !payload.eventId) return null;
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Resolve the SRA WordPress site URL for API calls.
   */
  private async resolveWpApiUrl(): Promise<string | null> {
    // Try env first, then DB setting
    const envUrl = this.config.get<string>('SRA_WP_URL');
    if (envUrl) return envUrl;

    // Fallback: check DB settings
    try {
      const setting = await this.prisma.setting.findFirst({
        where: { key: 'sra_wp_url', scope: 'global' },
      });
      if (setting) return setting.value as string;
    } catch { /* ignore */ }

    return null;
  }
}
