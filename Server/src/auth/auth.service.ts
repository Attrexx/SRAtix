import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { createHmac } from 'crypto';

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
}
