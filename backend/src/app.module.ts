import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModule,
} from '@nestjs/throttler';

import { SupabaseModule } from './modules/supabase/supabase.module';
import { AuthModule } from './modules/auth/auth.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ServicesModule } from './modules/services/services.module';
import { OrdersModule } from './modules/orders/orders.module';
import { QrModule } from './modules/qr/qr.module';
import { OtpModule } from './modules/otp/otp.module';
import { HealthModule } from './modules/health/health.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { MapsModule } from './modules/maps/maps.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PackagesModule } from './modules/packages/packages.module';
import { GrowthModule } from './modules/growth/growth.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AdminManagementModule } from './modules/admin-management/admin-management.module';
import { ProductionModule } from './modules/production/production.module';

import { LogisticsModule } from './modules/logistics/logistics.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { FacilityModule } from './modules/facility/facility.module';
import { StaffModule } from './modules/staff/staff.module';
import { ClaimsModule } from './modules/claims/claims.module';
import { MailModule } from './modules/mail/mail.module';

import { SupabaseAuthGuard } from './common/guards/supabase-auth.guard';
import { validateProviderConfiguration } from './config/provider-config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateProviderConfiguration,
    }),

    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 100,
      },
    ]),

    SupabaseModule,

    AuthModule,
    RbacModule,
    CustomersModule,
    OrdersModule,
    ServicesModule,
    QrModule,
    OtpModule,
    HealthModule,
    PaymentsModule,
    MapsModule,
    DriversModule,
    NotificationsModule,
    PackagesModule,
    GrowthModule,
    AnalyticsModule,
    AdminManagementModule,
    ProductionModule,

    LogisticsModule,
    DeliveryModule,
    FacilityModule,
    StaffModule,
    ClaimsModule,
    MailModule,
  ],

  providers: [
    {
      provide: APP_GUARD,
      useClass: SupabaseAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
