// import {
//   LineItem,
//   LineItemTaxLine,
//   ShippingMethod,
//   ShippingMethodTaxLine,
// } from "@medusajs/medusa/dist/models"
// import { ITaxCalculationStrategy, TaxCalculationContext } from "@medusajs/medusa/dist/interfaces"
// import { calculatePriceTaxAmount } from "@medusajs/medusa/dist/utils"
// import TaxInclusivePricingFeatureFlag from "@medusajs/medusa/dist/loaders/feature-flags/tax-inclusive-pricing"
// import { FlagRouter } from "@medusajs/medusa/dist/utils/flag-router"
// import Stripe from "stripe";
// class TaxCalculationStrategy implements ITaxCalculationStrategy {
//   protected readonly featureFlagRouter_: FlagRouter
//   private stripe_: Stripe;
//   constructor({ featureFlagRouter }, options) {
//     this.featureFlagRouter_ = featureFlagRouter
//     this.stripe_ = new Stripe(options.api_key, {
//             apiVersion: "2022-11-15",
//      });
//   }

//   async calculate(
//     items: LineItem[],
//     taxLines: (ShippingMethodTaxLine | LineItemTaxLine)[],
//     calculationContext: TaxCalculationContext
//   ): Promise<number> {
//     const lineItemsTaxLines = taxLines.filter(
//       (tl) => "item_id" in tl
//     ) as LineItemTaxLine[]

//     return this.calculateLineItemsTax(items, lineItemsTaxLines, calculationContext)
//   }

//    private async calculateLineItemsTax(
//     items: LineItem[],
//     taxLines: LineItemTaxLine[],
//     context: TaxCalculationContext
//   ): Promise<number> {
//     const { shipping_address, region, shipping_methods } = context;
//     const lineItems = items.map((item) => {
//       return {
//         amount: item.unit_price * item.quantity || 0,
//         tax_code:  "txcd_92010001",
//       };
//     });
//     console.log("shipping_methods", shipping_methods[0])
//     const calculation =
//     shipping_address && shipping_address.postal_code
//       ? await this.stripe_.tax.calculations.create({
//           currency: region.currency_code,
//           line_items: lineItems,
//           customer_details: {
//             address: {
//               line1: shipping_address.address_1 || "",
//               city: shipping_address.city || "",
//               state: shipping_address.province || "",
//               postal_code: shipping_address.postal_code || "",
//               country: shipping_address.country_code?.toUpperCase() || "",
//             },
//             address_source: "shipping",
//           },
//           shipping_cost: {
//             amount: 1000,
//             tax_code: "txcd_92010001",
//           },
//           expand: ["line_items.data.tax_breakdown"],
//         })
//       : null;
//       return calculation?.tax_amount_exclusive || 0;
//   }

// }

// export default TaxCalculationStrategy

import {
  ITaxCalculationStrategy,
  LineItem,
  LineItemTaxLine,
  ShippingMethodTaxLine,
  TaxCalculationContext,
} from "@medusajs/medusa";
import Stripe from "stripe";
import { asClass, InjectionMode } from 'awilix'

class TaxCalculationStrategy implements ITaxCalculationStrategy {
  private stripe: Stripe;
  private manager: any;
  private orderService: any;
  private cartService:any;
  constructor(container, options) {
    this.stripe = new Stripe(options.api_key, {
      apiVersion: "2022-11-15",
    });
    this.manager = container.manager
    this.cartService =  asClass(container.cartService).setInjectionMode(InjectionMode.PROXY)
    this.orderService = asClass(container.orderService).setInjectionMode(InjectionMode.PROXY)
  }
  async calculate(
    items: LineItem[],
    taxLines: (ShippingMethodTaxLine | LineItemTaxLine)[],
    calculationContext: TaxCalculationContext
  ): Promise<any> {
    const orderId = items[0].order_id;
    const cartId = items[0].cart_id;

    console.log("cartService", this.cartService);

    const finalAmount = await this.manager.transaction(async (transactionManager) => {
      if (orderId) {
        // TODO: Use OrderService to retrieve tax amount from order metadata to prevent unnecessary calls to the Stripe Tax API
        const order = await this.orderService
          .withTransaction(transactionManager)
          .retrieveByCartId(cartId)
          .catch(() => undefined)
        const taxAmount = order?.metadata?.tax?.amount
        // If tax amount isn't stored in the order metadata yet, return 0
        return taxAmount || 0
      }
      // TODO: Use CartService to retrieve tax amount from cart metadata to prevent unnecessary calls to the Stripe Tax API

      const cart = await this.cartService
        .withTransaction(transactionManager)
        .retrieve(cartId, { select: ["context"] })
      const taxAmount = cart?.metadata?.tax?.amount
      // If tax amount isn't stored in the cart metadata yet, return 0
      return taxAmount || 0
    })
    return finalAmount;

  }
}
export default TaxCalculationStrategy;
