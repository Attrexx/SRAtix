import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService, TokenPair } from './auth.service';
import { IsNumber, IsArray, IsString } from 'class-validator';

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
  async exchangeToken(@Body() dto: ExchangeTokenDto): Promise<TokenPair> {
    return this.authService.exchangeToken(
      dto.wpUserId,
      dto.wpRoles,
      dto.signature,
      dto.sourceSite,
    );
  }
}
