import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { createHmac, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

export interface JwtPayload {
  sub: string; // user ID
  email: string;
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
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

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
  ): Promise<TokenPair> {
    // Verify the HMAC signature from the WP plugin
    const secret = this.config.getOrThrow<string>('WP_API_SECRET');
    const payload = `${wpUserId}:${wpRoles.sort().join(',')}:${sourceSite}`;
    const expectedSig = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    if (signature !== expectedSig) {
      this.logger.warn(
        `Invalid signature for WP user ${wpUserId} from ${sourceSite}`,
      );
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
    let orgId: string | undefined;

    if (mapping) {
      // Existing mapping — resolve user
      userId = mapping.sratixEntityId;
      orgId = mapping.orgId ?? undefined;

      // Fetch email from User record
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
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

    return this.generateTokenPair({
      sub: userId,
      email,
      roles: sratixRoles,
      orgId,
    });
  }

  /**
   * Generate a new access + refresh token pair.
   */
  async generateTokenPair(
    payload: Omit<JwtPayload, 'iat' | 'exp'>,
  ): Promise<TokenPair> {
    const accessToken = this.jwt.sign(payload, { expiresIn: '15m' });
    const refreshToken = this.jwt.sign(
      { sub: payload.sub, type: 'refresh' },
      { expiresIn: '7d' },
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
    };
  }

  /**
   * Exchange a valid refresh token for a new token pair.
   * Looks up the user from DB to get current email/roles.
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
    let decoded: { sub: string; type?: string };
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
      select: { id: true, email: true, wpUserId: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
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
      roles: effectiveRoles,
      orgId,
    });
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
      roles: effectiveRoles,
      orgId,
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
}
