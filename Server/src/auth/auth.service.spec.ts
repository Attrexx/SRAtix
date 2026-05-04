import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService password auth normalization', () => {
  function setup(overrides: Record<string, any> = {}) {
    const jwt = {
      sign: jest.fn((payload: any) => `token:${payload.sub}:${payload.type ?? 'access'}`),
      verify: jest.fn(),
    };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'EXHIBITOR_PORTAL_URL') return 'https://swissroboticsday.ch/exhibitor-portal/';
        return undefined;
      }),
    };
    const prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      event: {
        findUnique: jest.fn(),
      },
      ...overrides.prisma,
    };
    const audit = { log: jest.fn() };
    const emailService = { sendNotification: jest.fn() };
    const service = new AuthService(jwt as any, config as any, prisma as any, audit as any, emailService as any);

    return { service, jwt, config, prisma, audit, emailService };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes login emails before looking up the user', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      displayName: 'Staff Member',
      passwordHash: 'hash',
      active: true,
      tokenVersion: 0,
      roles: [{ role: 'exhibitor', orgId: 'org-1' }],
    });
    prisma.user.update.mockResolvedValue({});
    jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);

    const result = await service.loginWithPassword(' Staff@Example.COM ', 'secret');
    service.onModuleDestroy();

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'staff@example.com' },
      include: { roles: true },
    });
    expect(result.user.email).toBe('staff@example.com');
    expect(result.user.roles).toEqual(['exhibitor']);
  });

  it('allows portal password reset for users without an existing password', async () => {
    const { service, prisma, emailService } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      active: true,
      passwordHash: null,
      displayName: 'Staff Member',
    });
    prisma.user.update.mockResolvedValue({});
    prisma.event.findUnique.mockResolvedValue({ meta: { pagePaths: { setPassword: '/set-password/' } } });

    await service.requestPasswordReset(' Staff@Example.COM ', undefined, {
      context: 'portal',
      eventId: 'event-1',
    });
    service.onModuleDestroy();

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'staff@example.com' },
      select: { id: true, active: true, passwordHash: true, displayName: true },
    });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
    }));
    expect(emailService.sendNotification).toHaveBeenCalledWith(
      'staff@example.com',
      'Reset your SRAtix password',
      expect.stringContaining('https://swissroboticsday.ch/set-password/?token='),
      expect.stringContaining('https://swissroboticsday.ch/set-password/?token='),
    );
  });

  it('keeps dashboard reset silent for users without a password', async () => {
    const { service, prisma, emailService } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      active: true,
      passwordHash: null,
      displayName: 'Staff Member',
    });

    await service.requestPasswordReset('staff@example.com', undefined, { context: 'dashboard' });
    service.onModuleDestroy();

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(emailService.sendNotification).not.toHaveBeenCalled();
  });

  it('rejects invalid passwords after normalized lookup', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      displayName: 'Staff Member',
      passwordHash: 'hash',
      active: true,
      tokenVersion: 0,
      roles: [],
    });
    jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);

    await expect(service.loginWithPassword(' Staff@Example.COM ', 'wrong')).rejects.toThrow(UnauthorizedException);
    service.onModuleDestroy();
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: 'staff@example.com' },
    }));
  });
});
