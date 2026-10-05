import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import { Roles } from "../../common/decorators/roles.decorator";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Public } from "../../common/decorators/public.decorator";
import { PaymentsService } from "./payments.service";
import { RequestRefundDto, VerifyPaymentDto } from "./dto/payment.dto";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("orders/:orderId/create")
  create(@Req() req: any, @Param("orderId", ParseUUIDPipe) id: string) {
    return this.payments.createOrder(req.user.id, id);
  }

  @Get("orders/:orderId")
  status(@Req() req: any, @Param("orderId", ParseUUIDPipe) id: string) {
    return this.payments.getOrderPaymentSummary(req.user.id, id);
  }

  @Post("verify")
  verify(@Req() req: any, @Body() body: VerifyPaymentDto) {
    return this.payments.verifyPayment(req.user.id, body);
  }

  @Public()
  @Post("webhook/razorpay")
  webhook(
    @Req() req: any,
    @Headers("x-razorpay-signature")
    signature: string,
    @Headers("x-razorpay-event-id")
    eventId?: string,
  ) {
    return this.payments.webhook(req.rawBody, signature, eventId);
  }

  @Post("refunds/:paymentOrderId/request")
  request(
    @Req() req: any,
    @Param("paymentOrderId", ParseUUIDPipe)
    id: string,
    @Body()
    body: RequestRefundDto,
  ) {
    return this.payments.requestRefund(
      req.user.id,
      id,
      body.amount,
      body.reason,
    );
  }

  @UseGuards(RolesGuard)
  @Roles("admin")
  @Post("refunds/:refundId/approve")
  approve(
    @Req() req: any,
    @Param("refundId", ParseUUIDPipe)
    id: string,
    @Body() body: {notes?: string},
  ) {
    return this.payments.approveRefund(req.user.id, id, body?.notes || 'Approved by Admin');
  }
}
