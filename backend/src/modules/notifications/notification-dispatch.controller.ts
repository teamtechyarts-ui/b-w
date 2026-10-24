import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { NotificationDispatcher } from './notification-dispatcher.service';

@Controller('admin/notifications')
@UseGuards(RolesGuard)
@Roles('admin')
export class NotificationDispatchController {
  constructor(private readonly dispatcher: NotificationDispatcher) {}

  @Get('overview')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  overview() {
    return this.dispatcher.getDiagnosticOverview();
  }

  @Post(':id/dispatch')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  dispatch(@Param('id', ParseUUIDPipe) notificationId: string) {
    return this.dispatcher.dispatchPersisted(notificationId);
  }
}
