import { container } from './../api/utils/__fixtures__/container';
import {
  ITaxCalculationStrategy,
  LineItem,
  LineItemTaxLine,
  ShippingMethodTaxLine,
  TaxCalculationContext,
} from "@medusajs/medusa";
import Stripe from "stripe";
class TaxCalculationStrategy implements ITaxCalculationStrategy {
  private stripe: Stripe;
  private container: any;
  constructor(container, options) {
    // options contains plugin configurations
    this.stripe = new Stripe(options.api_key, {
      apiVersion: "2022-11-15",
    });
    this.container = container;
  }
  async calculate(
    items: LineItem[],
    taxLines: (ShippingMethodTaxLine | LineItemTaxLine)[],
    calculationContext: TaxCalculationContext
  ): Promise<any> {
    const manager = container.resolve("manager")
    const orderService = this.container.resolve("orderService")
    const orderId = items[0].order_id;
    const cartId = items[0].cart_id;

    const finalAmount = await manager.transaction(async (transactionManager) => {
      if (orderId) {
        // TODO: Use OrderService to retrieve tax amount from order metadata to prevent unnecessary calls to the Stripe Tax API
        const order = await orderService
          .withTransaction(transactionManager)
          .retrieveByCartId(cartId)
          .catch(() => undefined)
        const taxAmount = order?.metadata?.tax?.amount
        // If tax amount isn't stored in the order metadata yet, return 0
        return taxAmount || 0
      }
      // TODO: Use CartService to retrieve tax amount from cart metadata to prevent unnecessary calls to the Stripe Tax API
      const cartService = this.container.resolve("cartService")
      const cart = await cartService
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
