import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";

import { LogisticsService } from "./logistics.service";
import { UpdateDriverLocationDto } from "./dto/update-driver-location.dto";

@Controller()
export class LogisticsController {
  constructor(private readonly logistics: LogisticsService) {}

  @Patch("drivers/me/availability")
  availability(@Req() req: any, @Body() body: { isAvailable: boolean }) {
    return this.logistics.updateAvailability(req.user.id, body.isAvailable);
  }

  @Post("drivers/me/location")
  location(
    @Req() req: any,
    @Body() body: UpdateDriverLocationDto,
  ) {
    return this.logistics.updateLocation(
      req.user.id,
      body.assignmentId,
      body.latitude,
      body.longitude,
      body.accuracyM,
    );
  }

  @Get("orders/:orderId/tracking")
  tracking(
    @Req() req: any,
    @Param("orderId", ParseUUIDPipe)
    orderId: string,
  ) {
    return this.logistics.trackOrder(req.user.id, orderId);
  }

  @Post("orders/:orderId/assign-driver")
  assign(
    @Req() req: any,
    @Param("orderId", ParseUUIDPipe)
    orderId: string,
    @Body()
    body: {
      assignmentType: "pickup" | "delivery";
    },
  ) {
    return this.logistics.assignBestDriver(
      orderId,
      body.assignmentType,
      req.user.id,
    );
  }

  @Post("driver-assignments/:assignmentId/accept")
  accept(
    @Req() req: any,
    @Param("assignmentId", ParseUUIDPipe)
    id: string,
  ) {
    return this.logistics.respondToAssignment(req.user.id, id, true);
  }

  @Post("driver-assignments/:assignmentId/reject")
  reject(
    @Req() req: any,
    @Param("assignmentId", ParseUUIDPipe)
    id: string,
    @Body() body: { reason?: string },
  ) {
    return this.logistics.respondToAssignment(
      req.user.id,
      id,
      false,
      body.reason,
    );
  }

  @Post("driver-assignments/:assignmentId/reassign")
  reassign(
    @Req() req: any,
    @Param("assignmentId", ParseUUIDPipe) id: string,
    @Body() body: { newDriverId: string },
  ) {
    return this.logistics.reassignDriver(req.user.id, id, body.newDriverId);
  }

  @Post("driver-assignments/:assignmentId/navigation")
  navigation(
    @Req() req: any,
    @Param("assignmentId", ParseUUIDPipe)
    id: string,
  ) {
    return this.logistics.startNavigation(req.user.id, id);
  }

  @Post("driver-assignments/:assignmentId/arrive")
  arrive(
    @Req() req: any,
    @Param("assignmentId", ParseUUIDPipe)
    id: string,
  ) {
    return this.logistics.arrive(req.user.id, id);
  }

  @Post("driver-assignments/:assignmentId/facility-transit")
  facilityTransit(
    @Req() req: any,
    @Param("assignmentId", ParseUUIDPipe)
    id: string,
  ) {
    return this.logistics.startFacilityTransit(req.user.id, id);
  }

  @Post("driver-assignments/:assignmentId/confirm-facility-handover")
  confirmFacilityHandover(
    @Req() req: any,
    @Param("assignmentId", ParseUUIDPipe)
    id: string,
  ) {
    return this.logistics.confirmFacilityHandover(req.user.id, id);
  }

  @Get("drivers/me/nearby-jobs")
  nearby(
    @Req() req: any,
    @Query("radiusKm")
    radiusKm?: string,
  ) {
    return this.logistics.nearbyJobs(
      req.user.id,
      radiusKm ? Number(radiusKm) : 3,
    );
  }
}
