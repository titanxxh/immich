import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
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
}
