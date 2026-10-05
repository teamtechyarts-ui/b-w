import {Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards} from '@nestjs/common';
import {IsBoolean, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min} from 'class-validator';
import {Roles} from '../../common/decorators/roles.decorator';
import {RolesGuard} from '../../common/guards/roles.guard';
import {AdminFacilityOversightService} from './admin-facility-oversight.service';

export class CreateFacilityDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number | null;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number | null;
  @IsOptional() @IsNumber({maxDecimalPlaces: 0}) @Min(100) @Max(100000) serviceRadiusMeters?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateFacilityDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number | null;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number | null;
  @IsOptional() @IsNumber({maxDecimalPlaces: 0}) @Min(100) @Max(100000) serviceRadiusMeters?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AddPincodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Pincode must be exactly 6 numeric digits' })
  pincode!: string;
}

@Controller('admin/facilities')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminFacilityOversightController {
  constructor(private readonly oversight: AdminFacilityOversightService) {}

  @Get() list() { return this.oversight.list(); }
  @Get('locations') listLocations() { return this.oversight.listLocations(); }

  @Post() create(@Req() req: any, @Body() body: CreateFacilityDto) {
    return this.oversight.createLocation(req.user.id, body);
  }
  @Post('locations') createLocation(@Req() req: any, @Body() body: CreateFacilityDto) {
    return this.oversight.createLocation(req.user.id, body);
  }

  @Patch(':facilityId') update(@Req() req: any, @Param('facilityId', ParseUUIDPipe) id: string, @Body() body: UpdateFacilityDto) {
    return this.oversight.updateLocation(req.user.id, id, body);
  }
  @Patch('locations/:facilityId') updateLocation(@Req() req: any, @Param('facilityId', ParseUUIDPipe) id: string, @Body() body: UpdateFacilityDto) {
    return this.oversight.updateLocation(req.user.id, id, body);
  }

  @Delete(':facilityId') delete(@Req() req: any, @Param('facilityId', ParseUUIDPipe) id: string) {
    return this.oversight.deleteLocation(req.user.id, id);
  }
  @Delete('locations/:facilityId') deleteLocation(@Req() req: any, @Param('facilityId', ParseUUIDPipe) id: string) {
    return this.oversight.deleteLocation(req.user.id, id);
  }

  @Get(':facilityId/pincodes')
  getPincodes(@Param('facilityId', ParseUUIDPipe) facilityId: string) {
    return this.oversight.getFacilityPincodes(facilityId);
  }

  @Post(':facilityId/pincodes')
  addPincode(
    @Req() req: any,
    @Param('facilityId', ParseUUIDPipe) facilityId: string,
    @Body() body: AddPincodeDto,
  ) {
    return this.oversight.addFacilityPincode(req.user.id, facilityId, body.pincode);
  }

  @Delete(':facilityId/pincodes/:pincode')
  removePincode(
    @Req() req: any,
    @Param('facilityId', ParseUUIDPipe) facilityId: string,
    @Param('pincode') pincode: string,
  ) {
    return this.oversight.removeFacilityPincode(req.user.id, facilityId, pincode);
  }

  @Get(':facilityId') facility(@Param('facilityId', ParseUUIDPipe) id: string) { return this.oversight.facility(id); }
  @Get(':facilityId/orders/:orderId') order(@Param('facilityId', ParseUUIDPipe) facilityId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string) { return this.oversight.order(facilityId, orderId); }
}

