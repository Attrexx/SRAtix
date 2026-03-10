import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

/**
 * Canonical SRAtix role names.
 * This is the single source of truth for valid role values.
 * Any role assignment not in this set will be rejected with a 400 error.
 * Role descriptions and scoping rules are documented in PRODUCTION-ARCHITECTURE.md.
 */
export const VALID_ROLES = [
  'super_admin',         // Platform owner — full access (global scope)
  'admin',               // Restricted platform admin — no settings, no event deletion, limited user mgmt
  'organization_admin',  // Full org admin (org-scoped)
  'event_admin',         // Manages events, attendees, check-ins (org-scoped)
  'staff',               // Check-in ops + attendee assistance (org-scoped)
  'scanner',             // QR scan + check-in, kiosk/device accounts (org-scoped)
  'volunteer',           // Read-only event view (org-scoped)
  'exhibitor',           // Booth data, lead capture, badge scanning (org-scoped)
  'sponsor',             // Branding assets, impression analytics (org-scoped)
  'partner',             // Limited analytics, co-branding (org-scoped)
  'attendee',            // End-user self-service — own ticket + schedule (org-scoped)
] as const;

export type SratixRole = typeof VALID_ROLES[number];

/**
 * Role hierarchy levels — lower number = higher rank.
 * Used for user-management authorization (admins cannot manage same-rank or higher users).
 */
export const ROLE_HIERARCHY: Record<string, number> = {
  super_admin: 0,
  admin: 1,
  organization_admin: 2,
  event_admin: 2,
  staff: 3,
  scanner: 3,
  volunteer: 3,
  exhibitor: 3,
  sponsor: 3,
  partner: 3,
  attendee: 4,
};

/** Get the hierarchy level for a single role (unknown roles → 99). */
export function getRoleLevel(role: string): number {
  return ROLE_HIERARCHY[role] ?? 99;
}

/** Get the highest rank (lowest numeric level) from an array of roles. */
export function getHighestRoleLevel(roles: string[]): number {
  if (roles.length === 0) return 99;
  return Math.min(...roles.map(getRoleLevel));
}

/** Validate a set of role strings and throw 400 if any are unknown. */
function validateRoles(roles: string[]): void {
  const invalid = roles.filter((r) => !(VALID_ROLES as readonly string[]).includes(r));
  if (invalid.length > 0) {
    throw new BadRequestException(
      `Unknown role(s): ${invalid.join(', ')}. Valid roles: ${VALID_ROLES.join(', ')}`,
    );
  }
}

export interface UserWithRoles {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  orgId: string | null;
  wpUserId: number | null;
  emailConfirmedAt: Date | null;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all users with their roles.
   */
  async findAll(): Promise<UserWithRoles[]> {
    const users = await this.prisma.user.findMany({
      include: { roles: true },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      roles: u.roles.map((r) => r.role),
      orgId: u.roles.find((r) => r.orgId)?.orgId ?? null,
      wpUserId: u.wpUserId,
      emailConfirmedAt: u.emailConfirmedAt,
      active: u.active,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    }));
  }

  /**
   * Get a single user by ID.
   */
  async findOne(id: string): Promise<UserWithRoles> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true },
    });

    if (!user) throw new NotFoundException('User not found');

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles.map((r) => r.role),
      orgId: user.roles.find((r) => r.orgId)?.orgId ?? null,
      wpUserId: user.wpUserId,
      emailConfirmedAt: user.emailConfirmedAt,
      active: user.active,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }

  /**
   * Create an app-native user with password (Super Admin action).
   */
  async create(data: {
    email: string;
    displayName: string;
    password: string;
    roles: string[];
    orgId?: string;
  }): Promise<UserWithRoles> {
    validateRoles(data.roles);

    const existing = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        displayName: data.displayName,
        passwordHash,
        emailConfirmedAt: new Date(), // admin-created = auto-confirmed
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
      `Created user ${user.id} (${data.email}) with roles: ${data.roles.join(', ')}`,
    );

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: data.roles,
      orgId: data.orgId ?? null,
      wpUserId: null,
      emailConfirmedAt: user.emailConfirmedAt,
      active: user.active,
      lastLoginAt: null,
      createdAt: user.createdAt,
    };
  }

  /**
   * Update user details (Super Admin action).
   */
  async update(
    id: string,
    data: {
      email?: string;
      displayName?: string;
      password?: string;
      roles?: string[];
      orgId?: string;
      active?: boolean;
    },
  ): Promise<UserWithRoles> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // Build update payload
    const updateData: Record<string, unknown> = {};
    if (data.email !== undefined) updateData.email = data.email;
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.active !== undefined) updateData.active = data.active;
    if (data.password) {
      updateData.passwordHash = await bcrypt.hash(data.password, 12);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: updateData,
    });

    // Update roles if provided
    let finalRoles = user.roles.map((r) => r.role);
    if (data.roles !== undefined) {
      validateRoles(data.roles);
      // Replace all roles (delete existing, insert new)
      await this.prisma.userRole.deleteMany({ where: { userId: id } });
      for (const role of data.roles) {
        await this.prisma.userRole.create({
          data: {
            userId: id,
            orgId: data.orgId ?? null,
            role,
          },
        });
      }
      finalRoles = data.roles;
      this.logger.log(`Updated roles for ${id}: ${data.roles.join(', ')}`);
    }

    return {
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      roles: finalRoles,
      orgId: data.orgId ?? user.roles.find((r) => r.orgId)?.orgId ?? null,
      wpUserId: updated.wpUserId,
      emailConfirmedAt: updated.emailConfirmedAt,
      active: updated.active,
      lastLoginAt: updated.lastLoginAt,
      createdAt: updated.createdAt,
    };
  }

  /**
   * Deactivate a user (soft-delete — preserves audit trail).
   */
  async deactivate(id: string): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: { active: false },
    });

    this.logger.log(`Deactivated user ${id} (${user.email})`);
    return { success: true };
  }

  /**
   * Re-activate a user.
   */
  async activate(id: string): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: { active: true },
    });

    this.logger.log(`Activated user ${id} (${user.email})`);
    return { success: true };
  }

  /**
   * Get user stats for the Super Admin panel.
   */
  async getStats(): Promise<{
    activeUsers: Array<{ id: string; displayName: string; email: string; roles: string[] }>;
    loginHistory: Array<{
      id: string;
      userId: string;
      displayName: string;
      roles: string[];
      ip: string | null;
      userAgent: string | null;
      timestamp: Date;
    }>;
    neverLoggedInCount: number;
  }> {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);

    const [activeUsersRaw, loginHistoryRaw, neverLoggedInCount] = await Promise.all([
      // Users active in the last 15 minutes (lastLoginAt updated on token refresh)
      this.prisma.user.findMany({
        where: {
          active: true,
          lastLoginAt: { gte: fifteenMinAgo },
        },
        include: { roles: true },
        orderBy: { lastLoginAt: 'desc' },
      }),
      // Last 50 login events from audit log
      this.prisma.auditLog.findMany({
        where: { action: 'auth.login' },
        orderBy: { timestamp: 'desc' },
        take: 50,
        include: {
          user: {
            select: { displayName: true },
            // Also get roles via a separate include
          },
        },
      }),
      // Count of active users who never logged in
      this.prisma.user.count({
        where: {
          active: true,
          lastLoginAt: null,
        },
      }),
    ]);

    const activeUsers = activeUsersRaw.map((u) => ({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      roles: u.roles.map((r) => r.role),
    }));

    // For login history, we need user roles too — fetch them in batch
    const userIds = [...new Set(loginHistoryRaw.filter((l) => l.userId).map((l) => l.userId!))];
    const userRolesMap = new Map<string, string[]>();
    if (userIds.length > 0) {
      const userRoles = await this.prisma.userRole.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, role: true },
      });
      for (const ur of userRoles) {
        const existing = userRolesMap.get(ur.userId) ?? [];
        existing.push(ur.role);
        userRolesMap.set(ur.userId, existing);
      }
    }

    const loginHistory = loginHistoryRaw.map((entry) => ({
      id: entry.id,
      userId: entry.userId ?? '',
      displayName: entry.user?.displayName ?? 'Unknown',
      roles: entry.userId ? (userRolesMap.get(entry.userId) ?? []) : [],
      ip: entry.ip,
      userAgent: entry.userAgent,
      timestamp: entry.timestamp,
    }));

    return { activeUsers, loginHistory, neverLoggedInCount };
  }

  /**
   * Get available SRAtix roles for the role selector UI.
   * Values are sourced from the VALID_ROLES constant — the single source of truth.
   */
  getAvailableRoles() {
    const meta: Record<string, { label: string; description: string }> = {
      super_admin:         { label: 'Super Admin',         description: 'Full platform access' },
      admin:               { label: 'Admin',               description: 'Platform admin (no settings, limited user management)' },
      organization_admin:  { label: 'Organization Admin',  description: 'Manage org exhibitor/sponsor data' },
      event_admin:         { label: 'Event Admin',         description: 'Manage events, attendees, check-ins' },
      staff:               { label: 'Staff',               description: 'Check-in ops, attendee assistance' },
      scanner:             { label: 'Scanner',             description: 'QR scan + check-in (kiosk/device)' },
      volunteer:           { label: 'Volunteer',           description: 'Check-in scanning only' },
      exhibitor:           { label: 'Exhibitor',           description: 'Booth data, lead capture, badge scanning' },
      sponsor:             { label: 'Sponsor',             description: 'Branding assets, impression analytics' },
      partner:             { label: 'Partner',             description: 'Limited analytics, co-branding' },
      attendee:            { label: 'Attendee',            description: 'Own ticket, schedule, badge' },
    };
    return VALID_ROLES.map((r) => ({ value: r, ...meta[r] }));
  }
}
