import {
  LineItem,
  LineItemTaxLine,
  ShippingMethod,
  ShippingMethodTaxLine,
} from "@medusajs/medusa/dist/models"
import { ITaxCalculationStrategy, TaxCalculationContext } from "@medusajs/medusa/dist/interfaces"
import { calculatePriceTaxAmount } from "@medusajs/medusa/dist/utils"
import TaxInclusivePricingFeatureFlag from "@medusajs/medusa/dist/loaders/feature-flags/tax-inclusive-pricing"
import { FlagRouter } from "@medusajs/medusa/dist/utils/flag-router"

class TaxCalculationStrategy implements ITaxCalculationStrategy {
  protected readonly featureFlagRouter_: FlagRouter

  constructor({ featureFlagRouter }) {
    this.featureFlagRouter_ = featureFlagRouter
  }

  async calculate(
    items: LineItem[],
    taxLines: (ShippingMethodTaxLine | LineItemTaxLine)[],
    calculationContext: TaxCalculationContext
  ): Promise<number> {
    const lineItemsTaxLines = taxLines.filter(
      (tl) => "item_id" in tl
    ) as LineItemTaxLine[]
    const shippingMethodsTaxLines = taxLines.filter(
      (tl) => "shipping_method_id" in tl
    ) as ShippingMethodTaxLine[]

    return Math.round(
      this.calculateLineItemsTax(items, lineItemsTaxLines, calculationContext) +
        this.calculateShippingMethodsTax(
          calculationContext.shipping_methods,
          shippingMethodsTaxLines
        )
    )
  }

  private calculateLineItemsTax(
    items: LineItem[],
    taxLines: LineItemTaxLine[],
    context: TaxCalculationContext
  ): number {
    let taxTotal = 0

    for (const item of items) {
      const allocations = context.allocation_map[item.id] || {}

      const filteredTaxLines = taxLines.filter((tl) => tl.item_id === item.id)
      const includesTax =
        this.featureFlagRouter_.isFeatureEnabled(
          TaxInclusivePricingFeatureFlag.key
        ) && item.includes_tax

      let taxableAmount
      if (includesTax) {
        const taxRate = filteredTaxLines.reduce(
          (accRate: number, nextLineItemTaxLine: LineItemTaxLine) => {
            return accRate + (nextLineItemTaxLine.rate || 0) / 100
          },
          0
        )
        const taxIncludedInPrice = Math.round(
          calculatePriceTaxAmount({
            price: item.unit_price,
            taxRate,
            includesTax,
          })
        )
        taxableAmount = (item.unit_price - taxIncludedInPrice) * item.quantity
      } else {
        taxableAmount = item.unit_price * item.quantity
      }

      taxableAmount -= allocations.discount?.amount ?? 0

      for (const filteredTaxLine of filteredTaxLines) {
        taxTotal += Math.round(
          calculatePriceTaxAmount({
            price: taxableAmount,
            taxRate: filteredTaxLine.rate / 100,
          })
        )
      }
    }
    return taxTotal
  }

  private calculateShippingMethodsTax(
    shipping_methods: ShippingMethod[],
    taxLines: ShippingMethodTaxLine[]
  ): number {
    const taxInclusiveEnabled = this.featureFlagRouter_.isFeatureEnabled(
      TaxInclusivePricingFeatureFlag.key
    )

    let taxTotal = 0
    for (const sm of shipping_methods) {
      const lineRates = taxLines.filter((tl) => tl.shipping_method_id === sm.id)
      for (const lineRate of lineRates) {
        taxTotal += calculatePriceTaxAmount({
          price: sm.price,
          taxRate: lineRate.rate / 100,
          includesTax: taxInclusiveEnabled && sm.includes_tax,
        })
      }
    }
    return taxTotal
  }
}

export default TaxCalculationStrategy

// import {
//   ITaxCalculationStrategy,
//   LineItem,
//   LineItemTaxLine,
//   ShippingMethodTaxLine,
//   TaxCalculationContext,
// } from "@medusajs/medusa";
// import Stripe from "stripe";


// class TaxCalculationStrategy implements ITaxCalculationStrategy {
//   private stripe: Stripe;
//   private manager: any;
//   private orderService: any;
//   private cartService:any;
//   constructor(container, options) {
//     this.stripe = new Stripe(options.api_key, {
//       apiVersion: "2022-11-15",
//     });
//     this.manager = container.manager
//     this.cartService = container.cartService
//     this.orderService = container.orderService
//   }
//   async calculate(
//     items: LineItem[],
//     taxLines: (ShippingMethodTaxLine | LineItemTaxLine)[],
//     calculationContext: TaxCalculationContext
//   ): Promise<any> {
//     const orderId = items[0].order_id;
//     const cartId = items[0].cart_id;

//     const finalAmount = await this.manager.transaction(async (transactionManager) => {
//       if (orderId) {
//         // TODO: Use OrderService to retrieve tax amount from order metadata to prevent unnecessary calls to the Stripe Tax API
//         const order = await this.orderService
//           .withTransaction(transactionManager)
//           .retrieveByCartId(cartId)
//           .catch(() => undefined)
//         const taxAmount = order?.metadata?.tax?.amount
//         // If tax amount isn't stored in the order metadata yet, return 0
//         return taxAmount || 0
//       }
//       // TODO: Use CartService to retrieve tax amount from cart metadata to prevent unnecessary calls to the Stripe Tax API

//       const cart = await this.cartService
//         .withTransaction(transactionManager)
//         .retrieve(cartId, { select: ["context"] })
//       const taxAmount = cart?.metadata?.tax?.amount
//       // If tax amount isn't stored in the cart metadata yet, return 0
//       return taxAmount || 0
//     })
//     return finalAmount;

//   }
// }
// export default TaxCalculationStrategy;
