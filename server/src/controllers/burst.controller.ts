import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { BurstSearchDto, BurstsResponseDto } from 'src/dtos/burst.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { BurstService } from 'src/services/burst.service';

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
