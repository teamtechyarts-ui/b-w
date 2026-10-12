import {Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards} from '@nestjs/common';
import {IsIn, IsNumber, IsString, MaxLength, Min} from 'class-validator';
import {Roles} from '../../common/decorators/roles.decorator';
import {RolesGuard} from '../../common/guards/roles.guard';
import {AdminIssuesService} from './admin-issues.service';

class DecisionDto {
  @IsString() @MaxLength(1000) notes!: string;
}
class ClaimDecisionDto extends DecisionDto {
  @IsIn(['under_review','approved','rejected','resolved']) status!: string;
}
class RefundRequestDto {
  @IsNumber({maxDecimalPlaces: 2}) @Min(0.01) amount!: number;
  @IsString() @MaxLength(500) reason!: string;
}

@Controller('admin/issues')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminIssuesController {
  constructor(private readonly issues: AdminIssuesService) {}
  @Get() overview() { return this.issues.overview(); }
  @Get('orders/:orderId') order(@Param('orderId') id: string) { return this.issues.order(id); }
  @Post('orders/:orderId/claims/:claimId/decision') claim(@Req() req: any, @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('claimId', ParseUUIDPipe) claimId: string, @Body() body: ClaimDecisionDto) {
    return this.issues.claimDecision(req.user.id, orderId, claimId, body.status, body.notes);
  }
  @Post('orders/:orderId/payments/:paymentId/refunds') requestRefund(@Req() req: any,
    @Param('orderId', ParseUUIDPipe) orderId: string, @Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() body: RefundRequestDto) {
    return this.issues.requestRefund(req.user.id, orderId, paymentId, body.amount, body.reason);
  }
  @Post('orders/:orderId/refunds/:refundId/approve') approveRefund(@Req() req: any,
    @Param('orderId', ParseUUIDPipe) orderId: string, @Param('refundId', ParseUUIDPipe) refundId: string, @Body() body: DecisionDto) {
    return this.issues.approveRefund(req.user.id, orderId, refundId, body.notes);
  }
  @Post('orders/:orderId/refunds/:refundId/reject') rejectRefund(@Req() req: any,
    @Param('orderId', ParseUUIDPipe) orderId: string, @Param('refundId', ParseUUIDPipe) refundId: string, @Body() body: DecisionDto) {
    return this.issues.rejectRefund(req.user.id, orderId, refundId, body.notes);
  }
}
