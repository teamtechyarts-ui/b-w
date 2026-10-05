import { Module, ServiceUnavailableException } from "@nestjs/common";

import { getProviderConfiguration } from "../../config/provider-config";
import { SupabaseModule } from "../supabase/supabase.module";
import { LogisticsModule } from "../logistics/logistics.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { PAYMENT_PROVIDER } from "./providers/payment.provider";
import { RazorpayPaymentProvider } from "./providers/razorpay-payment.provider";
import { DevelopmentPaymentProvider } from "./providers/development-payment.provider";

function isConfiguredRazorpayKey(keyId?: string, keySecret?: string): boolean {
  if (!keyId || !keySecret) return false;
  const normalizedKey = keyId.trim().toLowerCase();
  const normalizedSecret = keySecret.trim().toLowerCase();
  if (
    normalizedKey === 'dev_razorpay_key_id' ||
    normalizedSecret === 'dev_razorpay_key_secret' ||
    normalizedKey.includes('placeholder') ||
    normalizedSecret.includes('placeholder')
  ) {
    return false;
  }
  return true;
}

@Module({
  imports: [SupabaseModule, LogisticsModule],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      useFactory: () => {
        const configuration = getProviderConfiguration();

        if (configuration.nodeEnv === "production") {
          if (
            !configuration.payments.keyId ||
            !configuration.payments.keySecret ||
            !isConfiguredRazorpayKey(
              configuration.payments.keyId,
              configuration.payments.keySecret,
            )
          ) {
            throw new ServiceUnavailableException(
              "Razorpay is not configured for production",
            );
          }
          return new RazorpayPaymentProvider(
            configuration.payments.keyId,
            configuration.payments.keySecret,
          );
        }

        if (
          configuration.payments.keyId &&
          configuration.payments.keySecret &&
          isConfiguredRazorpayKey(
            configuration.payments.keyId,
            configuration.payments.keySecret,
          )
        ) {
          return new RazorpayPaymentProvider(
            configuration.payments.keyId,
            configuration.payments.keySecret,
          );
        }

        return new DevelopmentPaymentProvider();
      },
    },
    PaymentsService,
  ],
  controllers: [PaymentsController],
  exports: [PaymentsService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
