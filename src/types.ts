import { Address, ClaimOrder, Customer, Discount, LineItem, Region, ShippingMethod, Swap } from "@medusajs/medusa/dist/models"
import { DiscountAllocation, GiftCardAllocation } from "@medusajs/medusa/dist/types/totals"

export interface StripeOptions {
  api_key: string
  webhook_secret: string
  /**
   * Use this flag to capture payment immediately (default is false)
   */
  capture?: boolean
  /**
   * set `automatic_payment_methods` to `{ enabled: true }`
   */
  automatic_payment_methods?: boolean
  /**
   * Set a default description on the intent if the context does not provide one
   */
  payment_description?: string
}

export interface PaymentIntentOptions {
  capture_method?: "automatic" | "manual"
  setup_future_usage?: "on_session" | "off_session"
  payment_method_types?: string[]
}

export const ErrorCodes = {
  PAYMENT_INTENT_UNEXPECTED_STATE: "payment_intent_unexpected_state",
}

export const ErrorIntentStatus = {
  SUCCEEDED: "succeeded",
  CANCELED: "canceled",
}

export const PaymentProviderKeys = {
  STRIPE: "stripe",
  BAN_CONTACT: "stripe-bancontact",
  BLIK: "stripe-blik",
  GIROPAY: "stripe-giropay",
  IDEAL: "stripe-ideal",
  PRZELEWY_24: "stripe-przelewy24",
}
export type CalculationContextData = {
  discounts: Discount[]
  items: LineItem[]
  customer: Customer
  region: Region
  shipping_address: Address | null
  swaps?: Swap[]
  claims?: ClaimOrder[]
  shipping_methods?: ShippingMethod[]
}

export type CalculationContextOptions = {
  is_return?: boolean
  exclude_shipping?: boolean
  exclude_gift_cards?: boolean
  exclude_discounts?: boolean
}

export type TaxCalculationContext = {
  shipping_address: Address | null
  customer: Customer
  region: Region
  is_return: boolean
  shipping_methods: ShippingMethod[]
  allocation_map: LineAllocationsMap
}

export type LineAllocationsMap = {
  [K: string]: { gift_card?: GiftCardAllocation; discount?: DiscountAllocation }
}
export type AllocationMapOptions = {
  exclude_gift_cards?: boolean
  exclude_discounts?: boolean
}

export type LineDiscountAmount = {
  item: LineItem
  amount: number
  customAdjustmentsAmount: number
}