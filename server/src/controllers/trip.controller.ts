import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  TripCreateDto,
  TripDetailResponseDto,
  TripPreviewDto,
  TripPreviewResponseDto,
  TripResponseDto,
  TripSearchDto,
} from 'src/dtos/trip.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { TripService } from 'src/services/trip.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.Users)
@Controller('trips')
export class TripController {
  constructor(private service: TripService) {}

  @Get()
  @Authenticated({ permission: Permission.AlbumRead })
  @Endpoint({
    summary: 'List trips',
    description: 'List the trips of the current user, optionally only the trip of one album.',
    history: new HistoryBuilder().added('v3.2.2'),
  })
  getTrips(@Auth() auth: AuthDto, @Query() dto: TripSearchDto): Promise<TripResponseDto[]> {
    return this.service.getAll(auth, dto);
  }

  @Post()
  @Authenticated({ permission: Permission.AlbumUpdate })
  @Endpoint({
    summary: 'Mark an album as a trip',
    description:
      'Turn an album of the current user into a trip. Fails with 409 when it overlaps other trips that are not listed in replaceTripIds.',
    history: new HistoryBuilder().added('v3.2.2'),
  })
  createTrip(@Auth() auth: AuthDto, @Body() dto: TripCreateDto): Promise<TripResponseDto> {
    return this.service.create(auth, dto);
  }

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

  @Get(':id')
  @Authenticated({ permission: Permission.AlbumRead })
  @Endpoint({
    summary: 'Get a trip',
    description: 'Get a trip with its days, stops and route, computed from the photos in its album.',
    history: new HistoryBuilder().added('v3.2.2'),
  })
  getTrip(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<TripDetailResponseDto> {
    return this.service.get(auth, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated({ permission: Permission.AlbumUpdate })
  @Endpoint({
    summary: 'Unmark a trip',
    description:
      'Stop treating an album as a trip. A detected trip is dismissed so it is not found again; the album stays.',
    history: new HistoryBuilder().added('v3.2.2'),
  })
  removeTrip(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.remove(auth, id);
  }
}
