import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { TripPreviewDto, TripPreviewResponseDto } from 'src/dtos/trip.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { TripService } from 'src/services/trip.service';

@ApiTags(ApiTag.Users)
@Controller('trips')
export class TripController {
  constructor(private service: TripService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.UserPreferenceRead })
  @Endpoint({
    summary: 'Preview trips',
    description: 'List the trips that trip detection would find in the photos of the current user with these settings.',
    history: new HistoryBuilder().added('v3.2.2'),
  })
  previewTrips(@Auth() auth: AuthDto, @Body() dto: TripPreviewDto): Promise<TripPreviewResponseDto[]> {
    return this.service.preview(auth, dto);
  }

  @Post('detect')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated({ permission: Permission.UserPreferenceUpdate })
  @Endpoint({
    summary: 'Detect trips',
    description: 'Queue trip detection for the current user, creating albums for new trips.',
    history: new HistoryBuilder().added('v3.2.2'),
  })
  detectTrips(@Auth() auth: AuthDto): Promise<void> {
    return this.service.detect(auth);
  }
}
