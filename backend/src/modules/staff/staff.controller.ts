import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ProvisionStaffDto } from './dto/provision-staff.dto';
import { ChangeDriverPinDto } from './dto/change-driver-pin.dto';
import { StaffService } from './staff.service';

class DriverNameDto {
  @IsString() @IsNotEmpty() @MaxLength(100) fullName!: string;
}
class ReassignFacilityDto { @IsUUID() facilityId!: string; }

@Controller()
@UseGuards(RolesGuard)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Post('admin/staff')
  @Roles('admin')
  provision(@Req() req: any, @Body() body: ProvisionStaffDto) {
    return this.staff.provision(req.user.id, body);
  }

  @Patch('admin/staff/:profileId/driver-pin')
  @Roles('admin')
  changeDriverPin(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) id: string,
    @Body() body: ChangeDriverPinDto,
  ) {
    const pin = body.resolvedPin || body.newPin || body.pin || '';
    return this.staff.changeStaffPin(req.user.id, id, pin);
  }

  @Patch('admin/staff/:profileId/facility-pin')
  @Roles('admin')
  changeFacilityPin(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) id: string,
    @Body() body: ChangeDriverPinDto,
  ) {
    const pin = body.resolvedPin || body.newPin || body.pin || '';
    return this.staff.changeStaffPin(req.user.id, id, pin);
  }

  @Patch('admin/staff/:profileId/pin')
  @Roles('admin')
  changeStaffPin(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) id: string,
    @Body() body: ChangeDriverPinDto,
  ) {
    const pin = body.resolvedPin || body.newPin || body.pin || '';
    return this.staff.changeStaffPin(req.user.id, id, pin);
  }

  @Get('admin/staff')
  @Roles('admin')
  list(@Req() req: any, @Query('search') search?: string, @Query('role') role?: string, @Query('status') status?: string) {
    return this.staff.list(req.user.id, search, role, status);
  }

  @Get('admin/staff/facilities')
  @Roles('admin')
  facilities(@Req() req: any) { return this.staff.facilities(req.user.id); }

  @Get('admin/staff/:profileId')
  @Roles('admin')
  detail(@Req() req: any, @Param('profileId', ParseUUIDPipe) id: string) { return this.staff.detail(req.user.id, id); }

  @Patch('admin/staff/:profileId/facility')
  @Roles('admin')
  reassignFacility(@Req() req: any, @Param('profileId', ParseUUIDPipe) id: string, @Body() body: ReassignFacilityDto) {
    return this.staff.reassignFacility(req.user.id, id, body.facilityId);
  }

  @Patch('admin/staff/:profileId/availability')
  @Roles('admin')
  updateAvailability(@Req() req: any, @Param('profileId', ParseUUIDPipe) id: string, @Body('isAvailable') isAvailable: boolean) {
    return this.staff.updateDriverAvailability(req.user.id, id, Boolean(isAvailable));
  }

  @Patch('admin/staff/:profileId/revoke-access')
  @Roles('admin')
  revokeAccess(@Req() req: any, @Param('profileId', ParseUUIDPipe) id: string) { return this.staff.revokeAccess(req.user.id, id); }

  @Patch('admin/staff/:profileId/deactivate')
  @Roles('admin')
  deactivate(@Req() req: any, @Param('profileId', ParseUUIDPipe) id: string) {
    return this.staff.deactivate(req.user.id, id);
  }

  @Patch('admin/staff/:profileId/activate')
  @Roles('admin')
  activate(@Req() req: any, @Param('profileId', ParseUUIDPipe) id: string) {
    return this.staff.activate(req.user.id, id);
  }

  @Get('drivers/me/profile')
  @Roles('driver')
  driverProfile(@Req() req: any) {
    return this.staff.driverProfile(req.user.id);
  }

  @Patch('drivers/me/profile')
  @Roles('driver')
  updateDriverProfile(@Req() req: any, @Body() body: DriverNameDto) {
    return this.staff.updateDriverName(req.user.id, body.fullName);
  }
}
