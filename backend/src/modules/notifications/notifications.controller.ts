import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { SendTestNotificationDto } from './dto/test-notification.dto';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(SupabaseAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  @Post('test')
  async sendTestNotification(
    @Req() req: any,
    @Body() body: SendTestNotificationDto,
  ) {
    const isAdmin =
      Array.isArray(req.user?.roles) && req.user.roles.includes('admin');
    if (process.env.NODE_ENV === 'production' && !isAdmin) {
      throw new ForbiddenException(
        'Test notification endpoint is restricted to administrators in production',
      );
    }

    const title = body?.title?.trim() || 'Bright & White Test';
    const message =
      body?.body?.trim() ||
      'This is a development push notification test for your device.';

    const record = await this.notifications.create(
      req.user.id,
      'dev_test_notification',
      title,
      message,
      {
        isDevTest: true,
        dispatchedAt: new Date().toISOString(),
      },
    );

    const result = await this.dispatcher.dispatchPersisted(record.id);

    return {
      ok: result.sentCount > 0,
      notificationId: record.id,
      status: result.status,
      attemptedDeviceCount: result.attemptedDeviceCount,
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      reason: result.reason,
      acceptanceNote:
        'FCM acceptance confirms provider receipt; delivery and display on device require valid notification permissions and active network on the client.',
    };
  }

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
