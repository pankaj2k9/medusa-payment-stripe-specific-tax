import {
  LineItem,
  LineItemTaxLine,
  ShippingMethod,
  ShippingMethodTaxLine,
} from "@medusajs/medusa/dist/models"
import Stripe from "stripe";
import { ITaxCalculationStrategy, TaxCalculationContext } from "@medusajs/medusa/dist/interfaces"
import { calculatePriceTaxAmount } from "@medusajs/medusa/dist/utils"
import { FlagRouter } from "@medusajs/medusa/dist/utils/flag-router"
import TaxInclusivePricingFeatureFlag from "@medusajs/medusa/dist/loaders/feature-flags/tax-inclusive-pricing"

class TaxCalculationStrategy implements ITaxCalculationStrategy {
  protected readonly featureFlagRouter_: FlagRouter
  private stripe: Stripe;
  constructor({ featureFlagRouter }, options) {
    this.featureFlagRouter_ = featureFlagRouter
    this.stripe = new Stripe(options.api_key, {
      apiVersion: "2022-11-15",
    });
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
      await this.calculateLineItemsTax(items, lineItemsTaxLines, calculationContext) +
      this.calculateShippingMethodsTax(
        calculationContext.shipping_methods,
        shippingMethodsTaxLines
      )
    )
  }

  private async calculateLineItemsTax(
    items: LineItem[],
    taxLines: LineItemTaxLine[],
    context: TaxCalculationContext
  ): Promise<any> {

    const {
      customer: customerContext,
      region,
      shipping_address,
    } = context;
    const customerStripeId = customerContext?.metadata?.stripe_id as
      | string
      | undefined;
    const currency = region?.currency_code;
    const lineItems = items.map((item: any) => {
      let taxableAmount: number;
      // TODO: Amount should account for discounts (will somehow need access to TaxCalculationContext, as found in the calculate method parameter in tax-calculation.ts)
      const allocations = context.allocation_map[item.id] || {}
      taxableAmount = item.unit_price * item.quantity
      taxableAmount -= allocations.discount?.amount ?? 0
      return {
        amount: taxableAmount,
        reference: `${item.title} - ${item.id}`,
        tax_code: "txcd_99999999",
      };
    });

    const address = {
      line1: shipping_address?.address_1 || '',
      line2: shipping_address?.address_2 || '',
      city: shipping_address?.city || '',
      state: shipping_address?.province || '',
      postal_code: shipping_address?.postal_code || '',
      country: shipping_address?.country_code || '',
    };


    if (!shipping_address?.address_1 || lineItems?.length <= 0 || !shipping_address?.city || !shipping_address?.province || !shipping_address?.postal_code || !shipping_address?.country_code ) {
      return 0;
    }
    const shippingCost = context?.shipping_methods?.reduce(
      (cost, method) => method.price + cost,
      0
    );

    const calculation = await this.stripe.tax.calculations.create({
      currency,
      line_items: lineItems,
      customer_details: {
        address,
        address_source: "shipping",
      },
      shipping_cost: {
        amount: shippingCost,
        tax_code: "txcd_92010001",
      },

      expand: ["line_items.data.tax_breakdown"],
    });

    return calculation.tax_amount_exclusive;
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
//   CartService,
//   ITaxCalculationStrategy,
//   LineItem,
//   LineItemTaxLine,
//   OrderService,
//   ShippingMethodTaxLine,
//   TaxCalculationContext,
// } from "@medusajs/medusa";
// import Stripe from "stripe";
// import { asClass, InjectionMode } from 'awilix'

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
//     this.cartService =  asClass(CartService).setInjectionMode(InjectionMode.PROXY)
//     this.orderService = asClass(OrderService).setInjectionMode(InjectionMode.PROXY)
//   }
//   async calculate(
//     items: LineItem[],
//     taxLines: (ShippingMethodTaxLine | LineItemTaxLine)[],
//     calculationContext: TaxCalculationContext
//   ): Promise<any> {
//     const orderId = items[0]?.order_id;
//     const cartId = items[0]?.cart_id;

//     console.log("cartService", this.cartService);

//     const finalAmount = await this.manager.transaction(async (transactionManager) => {
//       console.log("transactionManager", transactionManager)
//       if (orderId) {
//         // TODO: Use OrderService to retrieve tax amount from order metadata to prevent unnecessary calls to the Stripe Tax API
//         // const order = await this.orderService
//         //   .withTransaction(transactionManager)
//         //   .retrieveByCartId(cartId)
//         //   .catch(() => undefined)
//         // const taxAmount = order?.metadata?.tax?.amount
//         // If tax amount isn't stored in the order metadata yet, return 0
//         return 1000 || 0
//       }
//       // TODO: Use CartService to retrieve tax amount from cart metadata to prevent unnecessary calls to the Stripe Tax API

//       // const cart = await this.cartService
//       //   .withTransaction(transactionManager)
//       //   .retrieve(cartId, { select: ["context"] })
//       // const taxAmount = cart?.metadata?.tax?.amount
//       // If tax amount isn't stored in the cart metadata yet, return 0
//       return 1500 || 0
//     })
//     return finalAmount;

//   }
// }
// export default TaxCalculationStrategy;
