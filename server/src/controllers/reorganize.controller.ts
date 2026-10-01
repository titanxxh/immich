import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  ReorganizationItemDto,
  ReorganizationItemsQueryDto,
  ReorganizationResponseDto,
  ReorganizeDto,
  ReorganizeFolderQueryDto,
  ReorganizeFoldersResponseDto,
  ReorganizeItemsDto,
  ReorganizeItemsResponseDto,
  ReorganizePreviewResponseDto,
} from 'src/dtos/reorganize.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { ReorganizeService } from 'src/services/reorganize.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.Assets)
@Controller('reorganizations')
export class ReorganizeController {
  constructor(private service: ReorganizeService) {}

  @Get('folders')
  @Authenticated({ permission: Permission.FolderRead })
  @Endpoint({
    summary: 'List folders to reorganize',
    description:
      'List the folders inside a folder of one of the external libraries of the current user, or their import paths.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  getReorganizeFolders(
    @Auth() auth: AuthDto,
    @Query() dto: ReorganizeFolderQueryDto,
  ): Promise<ReorganizeFoldersResponseDto> {
    return this.service.getFolders(auth, dto);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.AssetRead })
  @Endpoint({
    summary: 'Preview a reorganization',
    description:
      'Work out where the photos of a folder or album would go when moved into date folders, without moving anything.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  previewReorganization(@Auth() auth: AuthDto, @Body() dto: ReorganizeDto): Promise<ReorganizePreviewResponseDto> {
    return this.service.preview(auth, dto);
  }

  @Post('preview/items')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.AssetRead })
  @Endpoint({
    summary: 'List the photos of a reorganization preview',
    description: 'List where each photo would go, for one date folder or for the photos that stay for one reason.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  previewReorganizationItems(
    @Auth() auth: AuthDto,
    @Body() dto: ReorganizeItemsDto,
  ): Promise<ReorganizeItemsResponseDto> {
    return this.service.previewItems(auth, dto);
  }

  @Get()
  @Authenticated({ permission: Permission.AssetRead })
  @Endpoint({
    summary: 'List reorganizations',
    description: 'List the reorganizations of the current user, newest first, with how far each got.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  getReorganizations(@Auth() auth: AuthDto): Promise<ReorganizationResponseDto[]> {
    return this.service.getAll(auth);
  }

  @Post()
  @Authenticated({ permission: Permission.AssetUpdate })
  @Endpoint({
    summary: 'Start a reorganization',
    description:
      'Move the photos of a folder or album into date folders in the background, keeping each photo the same asset.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  createReorganization(@Auth() auth: AuthDto, @Body() dto: ReorganizeDto): Promise<ReorganizationResponseDto> {
    return this.service.create(auth, dto);
  }

  @Get(':id')
  @Authenticated({ permission: Permission.AssetRead })
  @Endpoint({
    summary: 'Get a reorganization',
    description: 'Get how far a reorganization got.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  getReorganization(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<ReorganizationResponseDto> {
    return this.service.get(auth, id);
  }

  @Get(':id/items')
  @Authenticated({ permission: Permission.AssetRead })
  @Endpoint({
    summary: 'List the photos of a reorganization',
    description: 'List where each photo of a reorganization was and went, optionally only the ones in one state.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  getReorganizationItems(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() dto: ReorganizationItemsQueryDto,
  ): Promise<ReorganizationItemDto[]> {
    return this.service.getItems(auth, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.AssetUpdate })
  @Endpoint({
    summary: 'Cancel a reorganization',
    description: 'Stop a running reorganization after the photo it is busy with. Photos already moved stay moved.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  cancelReorganization(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<ReorganizationResponseDto> {
    return this.service.cancel(auth, id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.AssetUpdate })
  @Endpoint({
    summary: 'Continue a reorganization',
    description: 'Continue a reorganization, or its undo, that stopped early, and retry the photos that failed.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  resumeReorganization(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<ReorganizationResponseDto> {
    return this.service.resume(auth, id);
  }

  @Post(':id/undo')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.AssetUpdate })
  @Endpoint({
    summary: 'Undo a reorganization',
    description:
      'Move the photos of a reorganization back to where they were. A photo stays when it was moved again or deleted since, or when its old place is taken.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  undoReorganization(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<ReorganizationResponseDto> {
    return this.service.undo(auth, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated({ permission: Permission.AssetUpdate })
  @Endpoint({
    summary: 'Delete a reorganization record',
    description: 'Forget a reorganization. The photos stay where they are and it can no longer be undone.',
    history: new HistoryBuilder().added('v3.2.4'),
  })
  deleteReorganization(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.delete(auth, id);
  }
}
