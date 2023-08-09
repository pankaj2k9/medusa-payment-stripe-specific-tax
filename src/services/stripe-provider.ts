import {
  PaymentProcessorError,
} from "@medusajs/medusa"
import StripeBase from "../core/stripe-base"
import { PaymentIntentOptions, PaymentProviderKeys, StripeOptions } from "../types"

class StripeProviderService extends StripeBase {
  updatePaymentData(sessionId: string, data: Record<string, unknown>): Promise<Record<string, unknown> | PaymentProcessorError> {
    throw new Error("Method not implemented.")
  }
  static identifier = PaymentProviderKeys.STRIPE

  protected readonly options_: StripeOptions;

  constructor(_, options) {
    super(_, options)
    this.options_ = options
  }

  get paymentIntentOptions(): PaymentIntentOptions | any {
    return this.options_;
  }
}

export default StripeProviderService
