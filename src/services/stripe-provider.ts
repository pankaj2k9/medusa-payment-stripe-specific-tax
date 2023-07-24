import StripeBase from "../core/stripe-base"
import { PaymentIntentOptions, PaymentProviderKeys, StripeOptions } from "../types"

class StripeProviderService extends StripeBase {
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
