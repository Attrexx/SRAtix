import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService, TokenPair } from './auth.service';
import { IsNumber, IsArray, IsString, IsOptional } from 'class-validator';
import { RateLimit } from '../common/guards/rate-limit.guard';

class ExchangeTokenDto {
  @IsNumber()
  wpUserId!: number;

  @IsArray()
  @IsString({ each: true })
  wpRoles!: string[];

  @IsString()
  signature!: string;

  @IsString()
  sourceSite!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

class RefreshTokenDto {
  @IsString()
  refreshToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/auth/token
   * WP plugin ↔ Server token exchange (OAuth2-lite).
   */
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, windowSec: 60 }) // Tighter limit on auth endpoint
  async exchangeToken(@Body() dto: ExchangeTokenDto): Promise<TokenPair> {
    return this.authService.exchangeToken(
      dto.wpUserId,
      dto.wpRoles,
      dto.signature,
      dto.sourceSite,
      dto.email,
      dto.displayName,
    );
  }

  /**
   * POST /api/auth/refresh
   * Exchange a valid refresh token for a new access + refresh token pair.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowSec: 60 })
  async refreshToken(@Body() dto: RefreshTokenDto): Promise<TokenPair> {
    return this.authService.refreshAccessToken(dto.refreshToken);
  }
}
