import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { DriverOrderLookupDto } from './dto/driver-order-lookup.dto';
import { ClaimJobDto } from './dto/claim-job.dto';

@Controller('drivers/me')
export class DriverDashboardController {
  constructor(private readonly drivers: DriversService) {}

  @Get('dashboard')
  dashboard(@Req() request: any) {
    return this.drivers.dashboard(request.user.id);
  }

  @Post('orders/lookup')
  lookupOrder(@Req() request: any, @Body() body: DriverOrderLookupDto) {
    return this.drivers.lookupOrder(request.user.id, body.code);
  }

  @Get('assignments/:id')
  assignment(@Req() request: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.drivers.assignment(request.user.id, id);
  }

  @Get('assignments/:id/handoff-qr')
  handoffQr(@Req() request: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.drivers.handoffQr(request.user.id, id);
  }

  @Post('jobs/:orderId/claim')
  claimJob(
    @Req() request: any,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: ClaimJobDto,
  ) {
    return this.drivers.claimJob(request.user.id, orderId, body.jobType);
  }
}
