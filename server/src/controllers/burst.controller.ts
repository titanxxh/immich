import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { BurstSearchDto, BurstsResponseDto } from 'src/dtos/burst.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { BurstService } from 'src/services/burst.service.js';

@ApiTags(ApiTag.Duplicates)
@Controller('bursts')
export class BurstController {
  constructor(private service: BurstService) {}

  @Get()
  @Authenticated({ permission: Permission.DuplicateRead })
  @Endpoint({
    summary: 'Get bursts',
    description:
      'Get a page of duplicate groups of photos, largest or oldest first, with how sharp each photo is and the sharpest one suggested to keep.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  getBursts(@Auth() auth: AuthDto, @Query() dto: BurstSearchDto): Promise<BurstsResponseDto> {
    return this.service.getBursts(auth, dto);
  }
}
