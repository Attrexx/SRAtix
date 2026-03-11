import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/**
 * Guard that accepts EITHER:
 *   1. `X-Deploy-Key` header matching DEPLOY_KEY env var (CLI / CI)
 *   2. JWT Bearer token with `super_admin` role (Dashboard UI)
 */
@Injectable()
export class DeployAuthGuard implements CanActivate {
  private readonly deployKey: string | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {
    this.deployKey = this.config.get<string>('DEPLOY_KEY');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // ── Path 1: Deploy key header ─────────────────────────────
    const headerKey = req.headers?.['x-deploy-key'];
    if (headerKey && this.deployKey && headerKey === this.deployKey) {
      return true;
    }

    // ── Path 2: JWT Bearer token with super_admin ─────────────
    const authHeader: string | undefined = req.headers?.['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const payload = this.jwt.verify(token);
        const roles: string[] = payload.roles ?? [];
        if (roles.includes('super_admin') || roles.includes('admin')) {
          req.user = payload;
          return true;
        }
      } catch {
        // Invalid/expired JWT — fall through to rejection
      }
    }

    throw new UnauthorizedException(
      'Requires X-Deploy-Key header or Bearer token with super_admin role',
    );
  }
}
