import { Body, Controller, Post } from '@nestjs/common';
import { RateLimit } from '../common/guards/rate-limit.guard';
import { ContactService } from './contact.service';
import { CreateContactDto } from './contact.dto';

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @RateLimit({ limit: 3, windowSec: 60 })
  submitLead(@Body() dto: CreateContactDto) {
    return this.contactService.submitLead(dto);
  }
}
