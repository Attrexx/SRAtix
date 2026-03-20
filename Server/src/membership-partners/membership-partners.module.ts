import { Module } from '@nestjs/common';
import { MembershipPartnersService } from './membership-partners.service';
import { MembershipPartnersController } from './membership-partners.controller';

@Module({
  controllers: [MembershipPartnersController],
  providers: [MembershipPartnersService],
  exports: [MembershipPartnersService],
})
export class MembershipPartnersModule {}
