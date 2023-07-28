import Stripe from "stripe"
import { EOL } from "os"
import {
  AbstractPaymentProcessor,
  Cart,
  isPaymentProcessorError,
  PaymentProcessorContext,
  PaymentProcessorError,
  PaymentProcessorSessionResponse,
  PaymentSessionStatus,
} from "@medusajs/medusa"
import { ClaimOrder, Discount, LineItem, ShippingMethod, Swap } from "@medusajs/medusa/dist/models"

import {
  ErrorCodes,
  ErrorIntentStatus,
  PaymentIntentOptions,
  StripeOptions,
  CalculationContextData,
  CalculationContextOptions,
  TaxCalculationContext,
  AllocationMapOptions,
  LineAllocationsMap,
  LineDiscountAmount
} from "../types"


export enum DiscountRuleType {
  FIXED = "fixed",
  PERCENTAGE = "percentage",
  FREE_SHIPPING = "free_shipping",
}

abstract class StripeBase extends AbstractPaymentProcessor {
  static identifier = ""

  protected readonly options_: StripeOptions;
  protected stripe_: Stripe
  protected calculationContext_: any

  protected constructor(_, options) {
    super(_, options);
    this.options_ = options
    this.init()
  }

   protected async calculationContext(options:any, cartOrOrder:any): Promise<any>  {
    this.calculationContext_ =
    options.calculation_context ||
    (await this.getCalculationContext(cartOrOrder, {
      exclude_shipping: true,
      exclude_gift_cards: options.exclude_gift_cards,
    }))
  }

  protected init(): void {
    this.stripe_ =
      this.stripe_ ||
      new Stripe(this.options_.api_key, {
        apiVersion: "2022-11-15",
      })
  }

  abstract get paymentIntentOptions(): PaymentIntentOptions


  async getCalculationContext(
    calculationContextData: CalculationContextData,
    options: CalculationContextOptions = {}
  ): Promise<TaxCalculationContext> {
    const allocationMap = await this.getAllocationMap(calculationContextData, {
      exclude_gift_cards: options.exclude_gift_cards,
      exclude_discounts: options.exclude_discounts,
    })

    let shippingMethods: ShippingMethod[] = []
    // Default to include shipping methods
    if (!options.exclude_shipping) {
      shippingMethods = calculationContextData.shipping_methods || []
    }

    return {
      shipping_address: calculationContextData.shipping_address,
      shipping_methods: shippingMethods,
      customer: calculationContextData.customer,
      region: calculationContextData.region,
      is_return: options.is_return ?? false,
      allocation_map: allocationMap,
    }
  }

  getLineDiscounts(
    cartOrOrder: {
      items: LineItem[]
      swaps?: Swap[]
      claims?: ClaimOrder[]
    },
    discount?: Discount
  ): LineDiscountAmount[] {
    let merged: LineItem[] = [...(cartOrOrder.items ?? [])]

    // merge items from order with items from order swaps
    if ("swaps" in cartOrOrder && cartOrOrder.swaps?.length) {
      for (const s of cartOrOrder.swaps) {
        merged = [...merged, ...s.additional_items]
      }
    }

    if ("claims" in cartOrOrder && cartOrOrder.claims?.length) {
      for (const c of cartOrOrder.claims) {
        merged = [...merged, ...c.additional_items]
      }
    }

    return merged.map((item) => {
      const adjustments = item?.adjustments || []
      const discountAdjustments = discount
        ? adjustments.filter(
            (adjustment) => adjustment.discount_id === discount.id
          )
        : []

      const customAdjustments = adjustments.filter(
        (adjustment) => adjustment.discount_id === null
      )

      const sumAdjustments = (total, adjustment) => total + adjustment.amount

      return {
        item,
        amount: item.allow_discounts
          ? discountAdjustments.reduce(sumAdjustments, 0)
          : 0,
        customAdjustmentsAmount: customAdjustments.reduce(sumAdjustments, 0),
      }
    })
  }

  async getAllocationMap(
    orderOrCart: {
      discounts?: Discount[]
      items: LineItem[]
      swaps?: Swap[]
      claims?: ClaimOrder[]
    },
    options: AllocationMapOptions = {}
  ): Promise<LineAllocationsMap> {
    const allocationMap: LineAllocationsMap = {}

    if (!options.exclude_discounts) {
      const discount = orderOrCart.discounts?.find(
        ({ rule }) => rule.type !== DiscountRuleType.FREE_SHIPPING
      )

      const lineDiscounts: LineDiscountAmount[] = this.getLineDiscounts(
        orderOrCart,
        discount
      )

      for (const ld of lineDiscounts) {
        const adjustmentAmount = ld.amount + ld.customAdjustmentsAmount

        if (allocationMap[ld.item.id]) {
          allocationMap[ld.item.id].discount = {
            amount: adjustmentAmount,
            /**
             * Used for the refund computation
             */
            unit_amount: adjustmentAmount / ld.item.quantity,
          }
        } else {
          allocationMap[ld.item.id] = {
            discount: {
              amount: adjustmentAmount,
              /**
               * Used for the refund computation
               */
              unit_amount: Math.round(adjustmentAmount / ld.item.quantity),
            },
          }
        }
      }
    }

    return allocationMap
  }


  getPaymentIntentOptions(): PaymentIntentOptions {
    const options: PaymentIntentOptions = {}

    if (this?.paymentIntentOptions?.capture_method) {
      options.capture_method = this.paymentIntentOptions.capture_method
    }

    if (this?.paymentIntentOptions?.setup_future_usage) {
      options.setup_future_usage = this.paymentIntentOptions.setup_future_usage
    }

    if (this?.paymentIntentOptions?.payment_method_types) {
      options.payment_method_types =
        this.paymentIntentOptions.payment_method_types
    }

    return options
  }

  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    const id = paymentSessionData.id as string
    const paymentIntent = await this.stripe_.paymentIntents.retrieve(id)

    switch (paymentIntent.status) {
      case "requires_payment_method":
      case "requires_confirmation":
      case "processing":
        return PaymentSessionStatus.PENDING
      case "requires_action":
        return PaymentSessionStatus.REQUIRES_MORE
      case "canceled":
        return PaymentSessionStatus.CANCELED
      case "requires_capture":
      case "succeeded":
        return PaymentSessionStatus.AUTHORIZED
      default:
        return PaymentSessionStatus.PENDING
    }
  }

  async initiatePayment(
    context: PaymentProcessorContext
  ): Promise<PaymentProcessorError | PaymentProcessorSessionResponse> {
    const intentRequestData = this.getPaymentIntentOptions()
    const {
      email,
      context: cart_context,
      currency_code,
      amount,
      resource_id,
      customer,
    } = context;
    const description = (cart_context.payment_description ??
      this.options_?.payment_description) as string

    const intentRequest: Stripe.PaymentIntentCreateParams = {
      description,
      amount: Math.round(amount),
      currency: currency_code,
      metadata: { resource_id },
      capture_method: this.options_.capture ? "automatic" : "manual",
      ...intentRequestData,
    }

    if (this.options_?.automatic_payment_methods) {
      intentRequest.automatic_payment_methods = { enabled: true }
    }

    if (customer?.metadata?.stripe_id) {
      intentRequest.customer = customer.metadata.stripe_id as string
    } else {
      let stripeCustomer
      try {
        stripeCustomer = await this.stripe_.customers.create({
          email,
        })
      } catch (e) {
        return this.buildError(
          "An error occurred in initiatePayment when creating a Stripe customer",
          e
        )
      }

      intentRequest.customer = stripeCustomer.id
    }

    let session_data
    try {
      session_data = (await this.stripe_.paymentIntents.create(
        intentRequest
      )) as unknown as Record<string, unknown>
    } catch (e) {
      return this.buildError(
        "An error occurred in InitiatePayment during the creation of the stripe payment intent",
        e
      )
    }

    return {
      session_data,
      update_requests: customer?.metadata?.stripe_id
        ? undefined
        : {
          customer_metadata: {
            stripe_id: intentRequest.customer,
          },
        },
    }
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<
    | PaymentProcessorError
    | {
      status: PaymentSessionStatus
      data: PaymentProcessorSessionResponse["session_data"]
    }
  > {
    const status = await this.getPaymentStatus(paymentSessionData)
    return { data: paymentSessionData, status }
  }

  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    try {
      const id = paymentSessionData.id as string
      return (await this.stripe_.paymentIntents.cancel(
        id
      )) as unknown as PaymentProcessorSessionResponse["session_data"]
    } catch (error) {
      if (error.payment_intent?.status === ErrorIntentStatus.CANCELED) {
        return error.payment_intent
      }

      return this.buildError("An error occurred in cancelPayment", error)
    }
  }

  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    const id = paymentSessionData.id as string
    try {
      const intent = await this.stripe_.paymentIntents.capture(id)
      return intent as unknown as PaymentProcessorSessionResponse["session_data"]
    } catch (error) {
      if (error.code === ErrorCodes.PAYMENT_INTENT_UNEXPECTED_STATE) {
        if (error.payment_intent?.status === ErrorIntentStatus.SUCCEEDED) {
          return error.payment_intent
        }
      }

      return this.buildError("An error occurred in capturePayment", error)
    }
  }

  async deletePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    return await this.cancelPayment(paymentSessionData)
  }

  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    const id = paymentSessionData.id as string

    try {
      await this.stripe_.refunds.create({
        amount: Math.round(refundAmount),
        payment_intent: id as string,
      })
    } catch (e) {
      return this.buildError("An error occurred in refundPayment", e)
    }

    return paymentSessionData
  }

  async retrievePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    try {
      const id = paymentSessionData.id as string
      const intent = await this.stripe_.paymentIntents.retrieve(id)
      return intent as unknown as PaymentProcessorSessionResponse["session_data"]
    } catch (e) {
      return this.buildError("An error occurred in retrievePayment", e)
    }
  }

  async updatePayment(
    context: PaymentProcessorContext & { context: { cart?: Cart }}
  ): Promise<PaymentProcessorError | PaymentProcessorSessionResponse | void> {
    const { amount, customer, paymentSessionData, currency_code,
      context: paymentProcessorContext,
    } = context;

    // Context includes cart data we can use for our calculations
    const { cart } = paymentProcessorContext;
    // We need the cart data so throw an error if it's missing
    if (!cart) {
      return this.buildError(
        "An error occurred in updatePayment",
        new Error("Cart data is missing from paymentProcessorContext")
      );
    }
    this.calculationContext(this.options_, cart)
    // Legally, we must use shipping_address for calculating sales tax, not billing_address
    const { id: cartId, shipping_address, items } = cart;
    // This should be an array of the individual line items
    const lineItems = items.map((item:any) => {
      let taxableAmount: number;
      // TODO: Amount should account for discounts (will somehow need access to TaxCalculationContext, as found in the calculate method parameter in tax-calculation.ts)
      const allocations = this.calculationContext_.allocation_map[item.id] || {}
      taxableAmount = item.unit_price * item.quantity
      taxableAmount -= allocations.discount?.amount ?? 0
      return {
        amount: taxableAmount,
        reference: `${item.title} - ${item.id}`,
        tax_code: "txcd_99999999",
      };
    });

    // TODO: Add shipping cost (will somehow need access to TaxCalculationContext, as found in the calculate method parameter in tax-calculation.ts)
    const shippingCost = this.calculationContext_.shipping_methods.reduce(
      (cost, method) => method.price + cost,
      0
    );

    // Only perform this calculation if a shipping address postal code is provided, otherwise use the default functionality for this method
    // This will avoid unnecessary API calls
    const calculation =
      shipping_address && shipping_address.postal_code
        ? await this.stripe_.tax.calculations.create({
            currency: currency_code,
            line_items: lineItems,
            customer_details: {
              address: {
                line1: shipping_address.address_1 || "",
                city: shipping_address.city || "",
                state: shipping_address.province || "",
                postal_code: shipping_address.postal_code || "",
                country: shipping_address.country_code?.toUpperCase() || "",
              },
              address_source: "shipping",
            },
            shipping_cost: {
              amount: shippingCost,
              tax_code: "txcd_92010001",
            },
            expand: ["line_items.data.tax_breakdown"],
          })
        : null;
    const amountTotal = calculation ? calculation.amount_total : amount;
    const stripeId = customer?.metadata?.stripe_id;

    if (stripeId !== paymentSessionData.customer) {
      const result = await this.initiatePayment(context)
      if (isPaymentProcessorError(result)) {
        return this.buildError(
          "An error occurred in updatePayment during the initiate of the new payment for the new customer",
          result
        )
      }

      return result
    } else {
      if (amountTotal && paymentSessionData.amount === Math.round(amountTotal)) {
        return
      }
      try {
        const id = paymentSessionData.id as string;
        const sessionMetadata =
          paymentSessionData.metadata as Stripe.Emptyable<Stripe.MetadataParam>
        const metadata = sessionMetadata || {}
        // Store the cart ID in the metadata
        metadata.cartId = cartId
        // We need to store the calculation ID in the metadata to create the tax transaction later
        if (calculation) metadata.tax_calculation = calculation.id
        const sessionData = (await this.stripe_.paymentIntents.update(id, {
          amount: Math.round(amountTotal),
          metadata,
        })) as unknown as PaymentProcessorSessionResponse["session_data"]
        // TODO: Use CartService here to update the cart metadata with tax information to cache API call
        /*
        Example metadata: {
          tax: {
            calculationId: calculation.id,
            amount: calculation.tax_amount_exclusive,
          }
        }
        See src/strategies/tax-calculation.ts for how this will be used
        */
        // Whatever is returned here in the session_data property will update in the PaymentSession object, so no need to import any payment session services to update
        return { session_data: sessionData }
      } catch (e) {
        return this.buildError("An error occurred in updatePayment", e)
      }
    }
  }

  /**
   * Constructs Stripe Webhook event
   * @param {object} data - the data of the webhook request: req.body
   * @param {object} signature - the Stripe signature on the event, that
   *    ensures integrity of the webhook event
   * @return {object} Stripe Webhook event
   */
  constructWebhookEvent(data, signature) {
    return this.stripe_.webhooks.constructEvent(
      data,
      signature,
      this.options_.webhook_secret
    )
  }

  protected buildError(
    message: string,
    e: Stripe.StripeRawError | PaymentProcessorError | Error
  ): PaymentProcessorError {
    return {
      error: message,
      code: "code" in e ? e.code : "",
      detail: isPaymentProcessorError(e)
        ? `${e.error}${EOL}${e.detail ?? ""}`
        : "detail" in e
          ? e.detail
          : e.message ?? "",
    }
  }
}

export default StripeBase
