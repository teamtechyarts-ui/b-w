import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';

import { DeliveryService } from './delivery.service';

@Controller()
export class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
  ) {}

  @Post('orders/:orderId/assign-delivery')
  assign(
    @Req() req: any,
    @Param('orderId', ParseUUIDPipe)
    orderId: string,
  ) {
    return this.delivery.assign(
      req.user.id,
      orderId,
    );
  }

  @Post(
    'orders/:orderId/delivery-proof/upload-url',
  )
  upload(
    @Req() req: any,
    @Param('orderId', ParseUUIDPipe)
    orderId: string,
    @Body()
    body: {
      fileName: string;
    },
  ) {
    return this.delivery.createUploadPath(
      req.user.id,
      orderId,
      body.fileName,
    );
  }

  @Post(
    'orders/:orderId/complete-delivery',
  )
  complete(
    @Req() req: any,
    @Param('orderId', ParseUUIDPipe)
    orderId: string,
    @Body()
    body: {
      otp: string;
      photoPath?: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    return this.delivery.complete(
      req.user.id,
      orderId,
      body.otp,
      body.photoPath,
      body.latitude,
      body.longitude,
    );
  }
}
