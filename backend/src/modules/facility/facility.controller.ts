import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator";
import { RolesGuard } from "../../common/guards/roles.guard";

import { FacilityService } from "./facility.service";
import {
  ResolveIntakeDiscrepancyDto,
  VerifyIntakeDto,
} from "./dto/verify-intake.dto";
import { QualityDecisionDto } from "./dto/quality-decision.dto";
import { ConfirmPackingDto } from "./dto/confirm-packing.dto";

@Controller("facility")
@UseGuards(RolesGuard)
@Roles("facility_employee", "manager")
export class FacilityController {
  constructor(private readonly facility: FacilityService) {}

  @Get("me/dashboard")
  dashboard(@Req() req: any) {
    return this.facility.dashboard(req.user.id);
  }

  @Get("orders/:orderId/available-delivery-drivers")
  availableDeliveryDrivers(
    @Req() req: any,
    @Param("orderId", ParseUUIDPipe) orderId: string,
  ) {
    return this.facility.availableDeliveryDrivers(req.user.id, orderId);
  }

  @Post("orders/:orderId/reassign-delivery")
  reassignDelivery(
    @Req() req: any,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: { driverId: string },
  ) {
    return this.facility.reassignDelivery(req.user.id, orderId, body.driverId);
  }

  @Post("orders/:orderId/handover-to-driver")
  handoverToDriver(
    @Req() req: any,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body?: { driverId?: string },
  ) {
    return this.facility.handoverToDriver(req.user.id, orderId, body?.driverId);
  }

  @Post("receive/qr")
  receive(
    @Req() req: any,
    @Body()
    body: {
      token: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    return this.facility.receiveByQr(
      req.user.id,
      body.token,
      body.latitude,
      body.longitude,
    );
  }

  @Post("receive/preview")
  preview(@Req() req: any, @Body() body: { token: string }) {
    return this.facility.previewReceipt(req.user.id, body.token);
  }

  @Post("receive/order-id/preview")
  previewByOrderId(@Req() req: any, @Body() body: { orderNumber: string }) {
    return this.facility.previewReceiptByOrderNumber(
      req.user.id,
      body.orderNumber,
    );
  }

  @Post("receive/order-id")
  receiveByOrderId(
    @Req() req: any,
    @Body()
    body: { orderNumber: string; latitude?: number; longitude?: number },
  ) {
    return this.facility.receiveByOrderNumber(
      req.user.id,
      body.orderNumber,
      body.latitude,
      body.longitude,
    );
  }

  @Post("orders/:orderId/verify")
  verify(
    @Req() req: any,
    @Param("orderId", ParseUUIDPipe)
    orderId: string,
    @Body()
    body: {
      itemCount?: number;
      weightKg?: number;
      notes?: string;
    },
  ) {
    return this.facility.verifyOrder(req.user.id, orderId, body);
  }

  @Get("orders/:orderId/intake")
  intake(@Req() req: any, @Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.facility.intakeDetails(req.user.id, orderId);
  }

  @Post("orders/:orderId/intake-verify")
  verifyIntake(
    @Req() req: any,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: VerifyIntakeDto,
  ) {
    return this.facility.verifyIntake(req.user.id, orderId, body);
  }

  @Patch("orders/:orderId/intake-discrepancies/:discrepancyId/resolve")
  @Roles("manager")
  resolveIntake(
    @Req() req: any,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Param("discrepancyId", ParseUUIDPipe) discrepancyId: string,
    @Body() body: ResolveIntakeDiscrepancyDto,
  ) {
    return this.facility.resolveIntakeDiscrepancy(
      req.user.id,
      orderId,
      discrepancyId,
      body.notes,
    );
  }

  @Post("orders/:orderId/processing")
  start(
    @Req() req: any,
    @Param("orderId", ParseUUIDPipe)
    orderId: string,
    @Body()
    body: {
      processType: string;
      machineId?: string;
    },
  ) {
    return this.facility.startProcessing(
      req.user.id,
      orderId,
      body.processType,
      body.machineId,
    );
  }

  @Get("orders/:orderId/processing")
  processingHistory(
    @Req() req: any,
    @Param("orderId", ParseUUIDPipe) orderId: string,
  ) {
    return this.facility.processingHistory(req.user.id, orderId);
  }

  @Post("operations/:operationId/complete")
  complete(
    @Req() req: any,
    @Param("operationId", ParseUUIDPipe)
    operationId: string,
  ) {
    return this.facility.completeProcessing(req.user.id, operationId);
  }

  @Post("orders/:orderId/quality-check")
  quality(
    @Req() req: any,
    @Param("orderId", ParseUUIDPipe)
    orderId: string,
    @Body()
    body: QualityDecisionDto,
  ) {
    return this.facility.qualityCheck(
      req.user.id,
      orderId,
      body.approved,
      body.notes,
      body.defectCode,
      body.affectedItemIds,
    );
  }

  @Get("orders/:orderId/packing")
  packing(@Req() req: any, @Param("orderId", ParseUUIDPipe) orderId: string) {
    return this.facility.packingDetails(req.user.id, orderId);
  }

  @Post("orders/:orderId/packing")
  confirmPacking(
    @Req() req: any,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: ConfirmPackingDto,
  ) {
    return this.facility.confirmPacking(req.user.id, orderId, body);
  }
}
