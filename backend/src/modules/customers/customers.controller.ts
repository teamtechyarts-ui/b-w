import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateAddressDto, UpdateCustomerDto } from './dto/customer.dto';

@Controller('customers/me')
export class CustomersController {
  constructor(private readonly c: CustomersService) {}

  @Get()
  me(@Req() r: any) {
    return this.c.me(r.user.id);
  }

  @Patch()
  update(@Req() r: any, @Body() d: UpdateCustomerDto) {
    return this.c.updateMe(r.user.id, d);
  }

  @Delete()
  deleteAccount(@Req() r: any) {
    return this.c.deleteAccount(r.user.id);
  }

  @Get('addresses')
  addresses(@Req() r: any) {
    return this.c.addresses(r.user.id);
  }

  @Post('addresses')
  add(@Req() r: any, @Body() d: CreateAddressDto) {
    return this.c.addAddress(r.user.id, d);
  }

  @Patch('addresses/:id')
  patch(@Req() r: any, @Param('id') id: string, @Body() d: Partial<CreateAddressDto>) {
    return this.c.updateAddress(r.user.id, id, d);
  }

  @Delete('addresses/:id')
  del(@Req() r: any, @Param('id') id: string) {
    return this.c.removeAddress(r.user.id, id);
  }
}
