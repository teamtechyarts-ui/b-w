import {Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards} from '@nestjs/common';
import {Roles} from '../../common/decorators/roles.decorator';
import {RolesGuard} from '../../common/guards/roles.guard';
import {CancelOrderDto} from '../orders/dto/cancel-order.dto';
import {AdminManagementService} from './admin-management.service';

@Controller('admin')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminManagementController {
  constructor(private readonly management: AdminManagementService) {}
  @Get('customers') customers(@Query('search') search?: string) { return this.management.customers(search); }
  @Get('customers/:id') customer(@Param('id', ParseUUIDPipe) id: string) { return this.management.customer(id); }
  @Get('customers/:id/orders') orders(@Param('id', ParseUUIDPipe) id: string) { return this.management.orders(id); }
  @Get('orders/:id') order(@Param('id') id: string) { return this.management.order(id); }
  @Post('orders/:id/cancel') cancel(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderDto) {
    return this.management.cancel(req.user.id, id, dto.reason);
  }
}
