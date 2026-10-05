import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import {
  DeactivateNotificationDeviceDto,
  RegisterNotificationDeviceDto,
} from './dto/device.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(SupabaseAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('devices')
  device(@Req() req: any, @Body() body: RegisterNotificationDeviceDto) {
    return this.notifications.registerDevice(
      req.user.id,
      body.token,
      body.platform,
    );
  }

  @Delete('devices')
  deactivate(
    @Req() req: any,
    @Body() body: DeactivateNotificationDeviceDto,
  ) {
    return this.notifications.deactivateDevice(req.user.id, body.token);
  }

  @Get()
  list(@Req() req: any) {
    return this.notifications.list(req.user.id);
  }

  @Post('read-all')
  readAll(@Req() req: any) {
    return this.notifications.markAllRead(req.user.id);
  }

  @Post('mark-all-read')
  markAllRead(@Req() req: any) {
    return this.notifications.markAllRead(req.user.id);
  }

  @Post(':id/read')
  read(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(req.user.id, id);
  }
}
