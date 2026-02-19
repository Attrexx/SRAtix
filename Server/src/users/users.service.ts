import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

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
   * Get available SRAtix roles for the role selector UI.
   */
  getAvailableRoles() {
    return [
      { value: 'super_admin', label: 'Super Admin', description: 'Full platform access' },
      { value: 'event_admin', label: 'Event Admin', description: 'Manage events, attendees, check-ins' },
      { value: 'organization_admin', label: 'Organization Admin', description: 'Manage org exhibitor/sponsor data' },
      { value: 'exhibitor', label: 'Exhibitor', description: 'Booth data, lead capture, badge scanning' },
      { value: 'sponsor', label: 'Sponsor', description: 'Branding assets, impression analytics' },
      { value: 'partner', label: 'Partner', description: 'Limited analytics, co-branding' },
      { value: 'staff', label: 'Staff', description: 'Check-in ops, attendee assistance' },
      { value: 'volunteer', label: 'Volunteer', description: 'Check-in scanning only' },
      { value: 'scanner', label: 'Scanner', description: 'QR scan + check-in (kiosk/device)' },
      { value: 'attendee', label: 'Attendee', description: 'Own ticket, schedule, badge' },
    ];
  }
}
