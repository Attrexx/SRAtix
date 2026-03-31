import { Injectable, UnauthorizedException, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcrypt';
import { VALID_ROLES } from '../users/users.service';
import { AuditLogService, AuditAction } from '../audit-log/audit-log.service';
import { EmailService } from '../email/email.service';

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
    private readonly emailService: EmailService,
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
    meta?: { ip?: string; userAgent?: string },
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
    const secret = this.config.get<string>('WP_API_SECRET');
    if (!secret) {
      this.logger.error('WP_API_SECRET is not configured — cannot verify WP token exchanges');
      throw new UnauthorizedException('Server misconfigured');
    }
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

      // If mapping has no orgId, try to resolve from org-scoped roles
      if (!orgId) {
        const orgRole = await this.prisma.userRole.findFirst({
          where: { userId, orgId: { not: null } },
          select: { orgId: true },
        });
        if (orgRole?.orgId) {
          orgId = orgRole.orgId;
          // Persist so future logins don't need this lookup
          await this.prisma.wpMapping.update({
            where: { id: mapping.id },
            data: { orgId },
          });
        }
      }

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
      // First login — link to existing User (by email or wpUserId) or create new
      const resolvedEmail = wpEmail ?? `wp-${wpUserId}@${sourceSite}`;
      let user = await this.prisma.user.findFirst({
        where: {
          OR: [
            ...(wpEmail ? [{ email: wpEmail }] : []),
            { wpUserId },
          ],
        },
      });

      if (user) {
        // Existing user found by email/wpUserId — link, don't duplicate
        userId = user.id;
        email = user.email;
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            wpUserId,
            lastLoginAt: new Date(),
            ...(wpEmail ? { email: wpEmail } : {}),
            ...(wpDisplayName ? { displayName: wpDisplayName } : {}),
          },
        });
        if (wpEmail) email = wpEmail;
      } else {
        user = await this.prisma.user.create({
          data: {
            email: resolvedEmail,
            displayName: wpDisplayName ?? `WP User ${wpUserId}`,
            wpUserId,
            lastLoginAt: new Date(),
          },
        });
        userId = user.id;
        email = user.email;
      }

      // Resolve orgId from existing org-scoped role (e.g., seed-created exhibitor role)
      if (!orgId) {
        const orgRole = await this.prisma.userRole.findFirst({
          where: { userId, orgId: { not: null } },
          select: { orgId: true },
        });
        if (orgRole?.orgId) orgId = orgRole.orgId;
      }

      // Create bidirectional mapping
      await this.prisma.wpMapping.create({
        data: {
          wpEntityType: 'user',
          wpEntityId: wpUserId,
          sratixEntityType: 'user',
          sratixEntityId: userId,
          orgId: orgId ?? null,
        },
      });

      this.logger.log(
        `Created SRAtix user ${userId} for WP user ${wpUserId}@${sourceSite}`,
      );
    }

    // Map WP roles to SRAtix roles
    const sratixRoles = this.mapWpRoles(wpRoles);

    // Sync roles to UserRole table.
    // Use upsert-style logic: delete existing roles that would collide, then create.
    // When orgId is set, we must also clean org-scoped roles to avoid unique-constraint
    // violations (e.g., a seed-created 'exhibitor' role for the same org).
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({
        where: {
          userId,
          ...(orgId ? { OR: [{ orgId: null }, { orgId }] } : { orgId: null }),
        },
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

    this.audit.log({
      userId,
      action: AuditAction.AUTH_LOGIN,
      entity: 'user',
      entityId: userId,
      detail: { method: 'wp_token_exchange', sourceSite },
      ip: meta?.ip,
      userAgent: meta?.userAgent,
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

    // Look up user + roles in a single query (eliminates a DB roundtrip)
    const user = await this.prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        email: true,
        displayName: true,
        wpUserId: true,
        tokenVersion: true,
        roles: { select: { role: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Reject refresh tokens issued before the latest revocation
    if ((decoded.ver ?? 0) < user.tokenVersion) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // Parallelize independent DB calls: WP mapping lookup + last-login update
    const [orgId] = await Promise.all([
      // Resolve orgId from WP mapping (if user has a WP account)
      user.wpUserId
        ? this.prisma.wpMapping
            .findUnique({
              where: {
                wpEntityType_wpEntityId: {
                  wpEntityType: 'user',
                  wpEntityId: user.wpUserId,
                },
              },
            })
            .then((m) => m?.orgId ?? undefined)
        : Promise.resolve(undefined),
      // Update last login timestamp (fire-and-forget, no return value needed)
      this.prisma.user.update({
        where: { id: decoded.sub },
        data: { lastLoginAt: new Date() },
      }),
    ]);

    const roles = user.roles.map((ur) => ur.role);

    // If no roles stored in DB, fallback to attendee
    const effectiveRoles = roles.length > 0 ? roles : ['attendee'];

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
    meta?: { ip?: string; userAgent?: string },
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

    this.audit.log({
      userId: user.id,
      action: AuditAction.AUTH_LOGIN,
      entity: 'user',
      entityId: user.id,
      detail: { method: 'password' },
      ip: meta?.ip,
      userAgent: meta?.userAgent,
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

  // ─── Password Reset ────────────────────────────────────────────

  /**
   * Request a password reset email.
   * Always succeeds silently to prevent email enumeration.
   */
  async requestPasswordReset(
    email: string,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, active: true, passwordHash: true, displayName: true },
    });

    // Silently return for non-existent, inactive, or WP-only users
    if (!user || !user.active || !user.passwordHash) return;

    // Generate token: store SHA-256 hash in DB, send raw in email
    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: hashedToken,
        resetTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      },
    });

    this.audit.log({
      userId: user.id,
      action: AuditAction.AUTH_PASSWORD_RESET_REQUESTED,
      entity: 'user',
      entityId: user.id,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });

    // Send reset email
    const resetUrl = `https://tix.swiss-robotics.org/auth/reset?token=${rawToken}`;
    const html = this.renderPasswordResetEmail(user.displayName, resetUrl);
    const text = `Hi ${user.displayName},\n\nYou requested a password reset for your SRAtix account.\n\nClick here to reset your password: ${resetUrl}\n\nThis link expires in 30 minutes. If you did not request this, you can safely ignore this email.\n\n— Swiss Robotics Association / SRAtix`;

    this.emailService.sendNotification(email, 'Reset your SRAtix password', html, text);
  }

  /**
   * Reset password using a valid token.
   */
  async resetPassword(
    rawToken: string,
    newPassword: string,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<{ email: string }> {
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');

    const user = await this.prisma.user.findUnique({
      where: { resetToken: hashedToken },
      select: { id: true, email: true, resetTokenExpiresAt: true },
    });

    if (!user) {
      throw new UnauthorizedException('TOKEN_CONSUMED');
    }
    if (!user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
      throw new UnauthorizedException('TOKEN_EXPIRED');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null,
        tokenVersion: { increment: 1 }, // invalidate all sessions
      },
    });

    this.audit.log({
      userId: user.id,
      action: AuditAction.AUTH_PASSWORD_RESET_COMPLETED,
      entity: 'user',
      entityId: user.id,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });

    return { email: user.email };
  }

  // ─── Password Setup (new accounts without password) ────────────

  /**
   * Generate a password setup token for a newly created account.
   * Unlike requestPasswordReset(), this does NOT require an existing passwordHash.
   * Returns the raw token (caller is responsible for building the URL and sending the email).
   * Expiry: 7 days (longer than reset since it's a first-time setup).
   */
  async initiatePasswordSetup(userId: string): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        resetToken: hashedToken,
        resetTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    this.audit.log({
      userId,
      action: AuditAction.AUTH_PASSWORD_RESET_REQUESTED,
      entity: 'user',
      entityId: userId,
      detail: { reason: 'initial_password_setup' },
    });

    return rawToken;
  }

  /**
   * Render password reset email HTML.
   */
  private renderPasswordResetEmail(displayName: string, resetUrl: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="padding:32px 32px 0;text-align:center;">
          <img src="https://tix.swiss-robotics.org/logo.png" alt="SRAtix" height="32" style="height:32px;" />
        </td></tr>
        <tr><td style="padding:24px 32px 32px;">
          <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a2e;">Reset Your Password</h2>
          <p style="margin:0 0 16px;font-size:15px;color:#4a4a68;line-height:1.5;">
            Hi <strong>${displayName}</strong>,
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#4a4a68;line-height:1.5;">
            We received a request to reset your password. Click the button below to choose a new password.
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr><td align="center">
              <a href="${resetUrl}" style="display:inline-block;padding:12px 32px;background:#1a1a2e;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
                Reset Password
              </a>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:13px;color:#8a8aab;line-height:1.5;">
            This link expires in <strong>30 minutes</strong>. If you did not request a password reset, you can safely ignore this email.
          </p>
          <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
          <p style="margin:0;font-size:11px;color:#b0b0c0;text-align:center;">
            Swiss Robotics Association &middot; SRAtix
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
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
   * @deprecated Use verifyPartnerCode() instead.
   * Kept for backward compatibility during transition.
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
   * Verify a membership partner's shared access code for a given event.
   * Returns a short-lived session token encoding the partner ID on success.
   */
  async verifyPartnerCode(
    eventId: string,
    partnerId: string,
    code: string,
  ): Promise<{ valid: boolean; sessionToken?: string; partnerName?: string }> {
    const partner = await this.prisma.membershipPartner.findFirst({
      where: { id: partnerId, eventId, active: true },
      select: { accessCode: true, name: true },
    });

    if (!partner || !code) {
      return { valid: false };
    }

    // Timing-safe comparison (case-insensitive)
    const a = Buffer.from(partner.accessCode.toLowerCase(), 'utf8');
    const b = Buffer.from(code.toLowerCase(), 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false };
    }

    const sessionToken = this.jwt.sign(
      {
        memberGroup: 'partner',
        partnerId,
        eventId,
      },
      { expiresIn: '2h' },
    );

    return { valid: true, sessionToken, partnerName: partner.name };
  }

  /**
   * Decode and validate a member session token.
   * Returns the decoded payload or null if invalid/expired.
   */
  decodeMemberSession(
    token: string,
  ): { memberGroup: string; tier?: string; partnerId?: string; eventId: string } | null {
    try {
      const payload = this.jwt.verify(token) as {
        memberGroup: string;
        tier?: string;
        partnerId?: string;
        eventId: string;
      };
      if (!payload.memberGroup || !payload.eventId) return null;
      return payload;
    } catch {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Demo / Impersonation (non-production only)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Find the first super_admin user (for secret-based demo auth).
   */
  async findSuperAdmin(): Promise<{ id: string; email: string }> {
    const role = await this.prisma.userRole.findFirst({
      where: { role: 'super_admin' },
      select: { userId: true, user: { select: { id: true, email: true } } },
    });
    if (!role?.user) throw new UnauthorizedException('No super_admin account exists');
    return role.user;
  }

  /**
   * Generate an exhibitor-scoped JWT for the calling super_admin.
   * Creates a demo Organization, Event, ExhibitorProfile, EventExhibitor,
   * TicketType (category=exhibitor), Attendee, and Ticket — all idempotent.
   *
   * Only available when NODE_ENV !== 'production'.
   */
  async generateDemoExhibitorSession(
    callerUserId: string,
  ): Promise<TokenPair & { demoOrgId: string; demoEventId: string }> {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new UnauthorizedException('Demo access disabled in production');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: callerUserId },
      include: { roles: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const isSuperAdmin = user.roles.some((r) => r.role === 'super_admin');
    if (!isSuperAdmin) {
      throw new UnauthorizedException('Only super_admin may use demo access');
    }

    const DEMO_SLUG = '_demo-exhibitor';

    // ── Org ────────────────────────────────────────────────────
    let org = await this.prisma.organization.findUnique({ where: { slug: DEMO_SLUG } });
    if (!org) {
      org = await this.prisma.organization.create({
        data: {
          name: 'Demo Robotics AG',
          slug: DEMO_SLUG,
          type: 'exhibitor',
          contactEmail: user.email,
          meta: { demo: true },
        },
      });
      this.logger.log(`Created demo org ${org.id}`);
    }

    // ── Event ──────────────────────────────────────────────────
    let event = await this.prisma.event.findFirst({
      where: { orgId: org.id, slug: 'srd-demo-2026' },
    });
    if (!event) {
      // Find the real SRD org event if exists, otherwise create a standalone demo event
      event = await this.prisma.event.create({
        data: {
          orgId: org.id,
          name: 'Swiss Robotics Day 2026 (Demo)',
          slug: 'srd-demo-2026',
          description: 'Demo event for exhibitor portal testing',
          venue: 'SwissTech Convention Center',
          venueAddress: 'Route Louis-Favre 2, 1024 Ecublens, Switzerland',
          startDate: new Date('2026-10-22T08:00:00+02:00'),
          endDate: new Date('2026-10-22T18:00:00+02:00'),
          doorsOpen: new Date('2026-10-22T07:30:00+02:00'),
          status: 'published',
          currency: 'CHF',
          maxCapacity: 2000,
          meta: {
            demo: true,
            pagePaths: {
              exhibitorPortal: '/exhibitor-portal',
            },
            setupOptions: [
              {
                id: 'electricity',
                label: 'Extra Power Outlet (230V)',
                priceCents: 5000,
                category: 'infrastructure',
              },
              {
                id: 'wifi',
                label: 'Dedicated Wi-Fi Access Point',
                priceCents: 8000,
                category: 'infrastructure',
              },
              {
                id: 'monitor-24',
                label: '24" Monitor on Stand',
                priceCents: 15000,
                category: 'equipment',
              },
              {
                id: 'table-extra',
                label: 'Extra Table (120×60cm)',
                priceCents: 3500,
                category: 'furniture',
              },
            ],
          },
        },
      });
      this.logger.log(`Created demo event ${event.id}`);
    }

    // ── TicketType (exhibitor category) ────────────────────────
    let ticketType = await this.prisma.ticketType.findFirst({
      where: { eventId: event.id, category: 'exhibitor' },
    });
    if (!ticketType) {
      ticketType = await this.prisma.ticketType.create({
        data: {
          eventId: event.id,
          name: 'Exhibitor Pass (Demo)',
          priceCents: 0,
          category: 'exhibitor',
          status: 'active',
          maxStaff: 5,
        },
      });
    }

    // ── Attendee ───────────────────────────────────────────────
    let attendee = await this.prisma.attendee.findUnique({
      where: { eventId_email: { eventId: event.id, email: user.email } },
    });
    if (!attendee) {
      attendee = await this.prisma.attendee.create({
        data: {
          eventId: event.id,
          orgId: org.id,
          email: user.email,
          firstName: user.displayName.split(' ')[0] || 'Demo',
          lastName: user.displayName.split(' ').slice(1).join(' ') || 'Admin',
          company: 'Demo Robotics AG',
          status: 'confirmed',
        },
      });
    }

    // ── Ticket ─────────────────────────────────────────────────
    let ticket = await this.prisma.ticket.findFirst({
      where: { eventId: event.id, attendeeId: attendee.id, ticketTypeId: ticketType.id },
    });
    if (!ticket) {
      const code = `DEMO-EX-${randomBytes(4).toString('hex').toUpperCase()}`;
      ticket = await this.prisma.ticket.create({
        data: {
          eventId: event.id,
          orgId: org.id,
          ticketTypeId: ticketType.id,
          attendeeId: attendee.id,
          code,
          status: 'valid',
        },
      });
    }

    // ── ExhibitorProfile ───────────────────────────────────────
    let profile = await this.prisma.exhibitorProfile.findUnique({
      where: { orgId: org.id },
    });
    if (!profile) {
      profile = await this.prisma.exhibitorProfile.create({
        data: {
          orgId: org.id,
          companyName: 'Demo Robotics AG',
          legalName: 'Demo Robotics AG',
          website: 'https://demo-robotics.example.com',
          description:
            '<p>Leading provider of collaborative robotic arms for manufacturing and research. ' +
            'Our cobots combine Swiss precision engineering with cutting-edge AI to deliver ' +
            'safe, intuitive automation solutions.</p>',
          contactEmail: user.email,
          contactPhone: '+41 21 555 0100',
          socialLinks: {
            linkedin: 'https://linkedin.com/company/demo-robotics',
            twitter: 'https://twitter.com/demorobotics',
          },
        },
      });
      this.logger.log(`Created demo ExhibitorProfile ${profile.id}`);
    }

    // ── EventExhibitor ─────────────────────────────────────────
    let eventExhibitor = await this.prisma.eventExhibitor.findUnique({
      where: {
        eventId_exhibitorProfileId: {
          eventId: event.id,
          exhibitorProfileId: profile.id,
        },
      },
    });
    if (!eventExhibitor) {
      eventExhibitor = await this.prisma.eventExhibitor.create({
        data: {
          eventId: event.id,
          exhibitorProfileId: profile.id,
          boothNumber: 'A-12',
          expoArea: 'Hall 1 — Collaborative Robotics',
          exhibitorCategory: 'industry',
          exhibitorType: 'Premium Exhibitor',
          demoTitle: 'CoBot X3: AI-Powered Pick & Place',
          demoDescription:
            '<p>Live demonstration of our flagship CoBot X3 performing high-speed ' +
            'bin-picking with real-time object recognition. See how our AI adapts to ' +
            'unseen objects in under 200ms.</p>',
          status: 'published',
          meta: {
            buyerName: user.displayName,
            orderNumber: 'DEMO-001',
          },
        },
      });
      this.logger.log(`Created demo EventExhibitor ${eventExhibitor.id}`);
    }

    // ── ExhibitorStaff (2 demo members) ────────────────────────
    const existingStaff = await this.prisma.exhibitorStaff.count({
      where: { eventExhibitorId: eventExhibitor.id },
    });
    if (existingStaff === 0) {
      await this.prisma.exhibitorStaff.createMany({
        data: [
          {
            eventExhibitorId: eventExhibitor.id,
            firstName: 'Alice',
            lastName: 'Meier',
            email: 'alice.meier@demo-robotics.example.com',
            role: 'booth_manager',
            passStatus: 'registered',
          },
          {
            eventExhibitorId: eventExhibitor.id,
            firstName: 'Bruno',
            lastName: 'Keller',
            email: 'bruno.keller@demo-robotics.example.com',
            phone: '+41 79 555 0201',
            role: 'demo_presenter',
            passStatus: 'pending',
          },
        ],
      });
    }

    // ── UserRole (exhibitor, org-scoped) ───────────────────────
    const hasExhibitorRole = await this.prisma.userRole.findFirst({
      where: { userId: user.id, role: 'exhibitor', orgId: org.id },
    });
    if (!hasExhibitorRole) {
      await this.prisma.userRole.create({
        data: { userId: user.id, role: 'exhibitor', orgId: org.id },
      });
    }

    // ── Issue JWT ──────────────────────────────────────────────
    const tokens = await this.generateTokenPair(
      {
        sub: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: ['exhibitor'],
        orgId: org.id,
      },
      user.tokenVersion,
    );

    this.audit.log({
      userId: user.id,
      action: AuditAction.AUTH_LOGIN,
      entity: 'user',
      entityId: user.id,
      detail: { method: 'demo_exhibitor', orgId: org.id, eventId: event.id },
    });

    return { ...tokens, demoOrgId: org.id, demoEventId: event.id };
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
