import { Controller, Post, Body, HttpCode, HttpStatus, Param, Get } from '@nestjs/common';
import { AuthService, TokenPair } from './auth.service';
import { IsNumber, IsArray, IsString, IsOptional, IsEmail, MinLength } from 'class-validator';
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

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
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
  @RateLimit({ limit: 20, windowSec: 60 })
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

  /**
   * POST /api/auth/login
   * Email + password authentication (app-native accounts).
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSec: 60 }) // Strict limit on password auth
  async login(@Body() dto: LoginDto): Promise<TokenPair> {
    return this.authService.loginWithPassword(dto.email, dto.password);
  }

  /**
   * GET /api/auth/confirm/:token
   * Email confirmation via token link.
   */
  @Get('confirm/:token')
  async confirmEmail(@Param('token') token: string) {
    return this.authService.confirmEmail(token);
  }
}
