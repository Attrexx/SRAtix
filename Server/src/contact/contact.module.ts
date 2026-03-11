import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { ContactService } from './contact.service';
import { ContactController } from './contact.controller';

@Module({
  imports: [EmailModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
