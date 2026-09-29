import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  FootprintRegionDetailResponseDto,
  FootprintRegionParamDto,
  FootprintShapesResponseDto,
  FootprintsResponseDto,
} from 'src/dtos/footprint.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { FootprintService } from 'src/services/footprint.service';

@ApiTags(ApiTag.Map)
@Controller('footprints')
export class FootprintController {
  constructor(private service: FootprintService) {}

  @Get()
  @Authenticated({ permission: Permission.MapRead })
  @Endpoint({
    summary: 'List footprint regions',
    description:
      'List every region the current user took camera photos in, with the first and last visit, hidden ones included.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  getFootprints(@Auth() auth: AuthDto): Promise<FootprintsResponseDto> {
    return this.service.getAll(auth);
  }

  @Get('shapes')
  @Authenticated({ permission: Permission.MapRead })
  @Endpoint({
    summary: 'Get footprint outlines',
    description: 'Get simplified outlines of the regions the current user visited, as GeoJSON.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  getFootprintShapes(@Auth() auth: AuthDto): Promise<FootprintShapesResponseDto> {
    return this.service.getShapes(auth);
  }

  @Get('regions/:id')
  @Authenticated({ permission: Permission.MapRead })
  @Endpoint({
    summary: 'Get a footprint region',
    description: 'Get a region, province or country the current user took camera photos in, with some of those photos.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  getFootprintRegion(
    @Auth() auth: AuthDto,
    @Param() { id }: FootprintRegionParamDto,
  ): Promise<FootprintRegionDetailResponseDto> {
    return this.service.getRegion(auth, id);
  }
}
