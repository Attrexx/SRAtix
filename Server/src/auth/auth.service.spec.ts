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

describe('AuthService SRA member verification (isMember)', () => {
  function setup() {
    const jwt = {
      sign: jest.fn((payload: any) => `token:${JSON.stringify(payload)}`),
      verify: jest.fn(),
    };
    const config = {
      get: jest.fn(() => undefined),
      getOrThrow: jest.fn((key: string) =>
        key === 'WEBHOOK_SIGNING_SECRET' ? 'test-secret' : undefined,
      ),
    };
    const prisma = { user: { findUnique: jest.fn() }, event: { findUnique: jest.fn() } };
    const audit = { log: jest.fn() };
    const emailService = { sendNotification: jest.fn() };
    const service = new AuthService(jwt as any, config as any, prisma as any, audit as any, emailService as any);
    // The WP API URL resolution hits settings/env — stub it out.
    jest.spyOn(service as any, 'resolveWpApiUrl').mockResolvedValue('https://wp.example');
    return { service, jwt };
  }

  function mockWpResponse(body: any) {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200, json: async () => body } as unknown as Response);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('treats a verified member with an unmappable tier as a member, and encodes isMember in the JWT', async () => {
    const { service, jwt } = setup();
    mockWpResponse({
      valid: true,
      wpUserId: 7,
      email: 'm@example.com',
      firstName: 'Mem',
      lastName: 'Ber',
      membershipTier: null,
      isMember: true,
    });

    const res = await service.verifySraMember('m@example.com', 'pw', 'evt-1');
    service.onModuleDestroy();

    expect(res.authenticated).toBe(true);
    expect(res.isMember).toBe(true);
    expect(res.membershipTier).toBeUndefined();
    // Checkout enforces the no-duplicate-membership rule from the JWT, so the
    // flag must be signed into the token even when the tier is null.
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ memberGroup: 'sra', tier: null, isMember: true }),
      expect.objectContaining({ expiresIn: '2h' }),
    );
  });

  it('falls back to "has a tier" when an older sratix-control build omits isMember', async () => {
    const { service } = setup();
    mockWpResponse({ valid: true, wpUserId: 8, email: 't@example.com', membershipTier: 'professionals' });

    const res = await service.verifySraMember('t@example.com', 'pw', 'evt-1');
    service.onModuleDestroy();

    expect(res.isMember).toBe(true);
    expect(res.membershipTier).toBe('professionals');
  });

  it('does not treat a non-member WP account (isMember=false, no tier) as a member', async () => {
    const { service } = setup();
    mockWpResponse({ valid: true, wpUserId: 9, email: 'admin@example.com', membershipTier: null, isMember: false });

    const res = await service.verifySraMember('admin@example.com', 'pw', 'evt-1');
    service.onModuleDestroy();

    expect(res.authenticated).toBe(true);
    expect(res.isMember).toBe(false);
  });

  it('decodeMemberSession round-trips the isMember claim', () => {
    const { service, jwt } = setup();
    jwt.verify.mockReturnValue({ memberGroup: 'sra', tier: null, isMember: true, eventId: 'evt-1' });

    const session = service.decodeMemberSession('tok');
    service.onModuleDestroy();

    expect(session).toEqual(
      expect.objectContaining({ memberGroup: 'sra', isMember: true, eventId: 'evt-1' }),
    );
  });

  it('decodeMemberSession returns null for a token missing required claims', () => {
    const { service, jwt } = setup();
    jwt.verify.mockReturnValue({ tier: 'professionals' }); // no memberGroup / eventId

    expect(service.decodeMemberSession('tok')).toBeNull();
    service.onModuleDestroy();
  });
});
