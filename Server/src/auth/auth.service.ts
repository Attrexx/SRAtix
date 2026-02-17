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

    // Map WP user to SRAtix user (create if first login)
    // TODO: Implement wp_mappings lookup and user creation
    const userId = `wp_${sourceSite}_${wpUserId}`;

    // Map WP roles to SRAtix roles
    const sratixRoles = this.mapWpRoles(wpRoles);

    return this.generateTokenPair({
      sub: userId,
      email: '', // Will be populated from mapping
      roles: sratixRoles,
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
