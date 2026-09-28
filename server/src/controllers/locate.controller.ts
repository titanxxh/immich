import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { LocateAssetIdsDto, LocateGroupsResponseDto, LocateSuggestionResponseDto } from 'src/dtos/locate.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { LocateService } from 'src/services/locate.service';

@ApiTags(ApiTag.Assets)
@Controller('locate')
export class LocateController {
  constructor(private service: LocateService) {}

  @Get('groups')
  @Authenticated({ permission: Permission.AssetRead })
  @Endpoint({
    summary: 'Get photos to locate',
    description: 'Group the camera photos of the current user that have no location by when they were taken.',
    history: new HistoryBuilder().added('v3.2.2'),
  })
  getLocateGroups(@Auth() auth: AuthDto): Promise<LocateGroupsResponseDto> {
    return this.service.getGroups(auth);
  }

  @Post('suggestion')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.AssetRead })
  @Endpoint({
    summary: 'Suggest a location',
    description: 'Suggest where the photos were taken, from located photos in the same folders or nearby in time.',
    history: new HistoryBuilder().added('v3.2.2'),
  })
  getLocateSuggestion(@Auth() auth: AuthDto, @Body() dto: LocateAssetIdsDto): Promise<LocateSuggestionResponseDto> {
    return this.service.getSuggestion(auth, dto);
  }

  @Post('ignore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated({ permission: Permission.AssetUpdate })
  @Endpoint({
    summary: 'Ignore photos to locate',
    description: 'Stop offering the photos for locating. They can still be located from the photo itself.',
    history: new HistoryBuilder().added('v3.2.2'),
  })
  ignoreLocateAssets(@Auth() auth: AuthDto, @Body() dto: LocateAssetIdsDto): Promise<void> {
    return this.service.ignore(auth, dto);
  }
}
