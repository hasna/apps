import type { WixClient } from './client';
import type {
  Order,
  UpdateOrderRequest,
  OrderLineItem,
  BuyerInfo,
  OrderTotals,
  OrderBillingInfo,
  OrderShippingInfo,
  ShipmentDetails,
  TrackingInfo,
  PickupDetails,
  BuyerDetails,
  OrderActivity,
  ChannelInfo,
  EnteredBy,
  Address,
  StreetAddress,
  OrderLineItemOption,
  OrderCustomTextField,
  OrderLineItemDiscount,
  LineItemPriceData,
  MediaItem,
  ImageInfo,
  VideoInfo,
} from '../types';

export interface ListOrdersOptions {
  limit?: number;
  offset?: number;
  sort?: { fieldName: string; order?: 'ASC' | 'DESC' }[];
}

export interface QueryOrdersOptions extends ListOrdersOptions {
  filter?: Record<string, unknown>;
}

/**
 * Wix Stores Orders API
 * Endpoint: /stores/v2/orders
 */
export class OrdersApi {
  constructor(private readonly client: WixClient) {}

  /**
   * List orders
   */
  async list(options: ListOrdersOptions = {}): Promise<Order[]> {
    const response = await this.client.request<{ orders: Record<string, unknown>[] }>(
      '/stores/v2/orders/query',
      {
        method: 'POST',
        body: {
          query: {
            paging: {
              limit: options.limit || 50,
              offset: options.offset || 0,
            },
            sort: options.sort,
          },
        },
      }
    );

    return this.transformOrders(response.orders || []);
  }

  /**
   * Query orders with filters
   */
  async query(options: QueryOrdersOptions = {}): Promise<Order[]> {
    const response = await this.client.request<{ orders: Record<string, unknown>[] }>(
      '/stores/v2/orders/query',
      {
        method: 'POST',
        body: {
          query: {
            filter: options.filter,
            sort: options.sort,
            paging: {
              limit: options.limit || 50,
              offset: options.offset || 0,
            },
          },
        },
      }
    );

    return this.transformOrders(response.orders || []);
  }

  /**
   * Get a single order by ID
   */
  async get(orderId: string): Promise<Order> {
    const response = await this.client.request<{ order: Record<string, unknown> }>(
      `/stores/v2/orders/${orderId}`
    );

    return this.transformOrder(response.order);
  }

  /**
   * Update an order
   */
  async update(orderId: string, order: UpdateOrderRequest): Promise<Order> {
    const body: Record<string, unknown> = {};

    if (order.buyerNote !== undefined) {
      body.buyerNote = order.buyerNote;
    }
    if (order.archived !== undefined) {
      body.archived = order.archived;
    }

    const response = await this.client.request<{ order: Record<string, unknown> }>(
      `/stores/v2/orders/${orderId}`,
      { method: 'PATCH', body: { order: body } }
    );

    return this.transformOrder(response.order);
  }

  /**
   * Archive an order
   */
  async archive(orderId: string): Promise<void> {
    await this.client.request<void>(
      `/stores/v2/orders/${orderId}/archive`,
      { method: 'POST' }
    );
  }

  /**
   * Unarchive an order
   */
  async unarchive(orderId: string): Promise<void> {
    await this.client.request<void>(
      `/stores/v2/orders/${orderId}/unarchive`,
      { method: 'POST' }
    );
  }

  /**
   * Get order count
   */
  async count(filter?: Record<string, unknown>): Promise<number> {
    const response = await this.client.request<{ orders: Record<string, unknown>[]; totalResults?: number }>(
      '/stores/v2/orders/query',
      {
        method: 'POST',
        body: {
          query: {
            filter,
            paging: { limit: 1, offset: 0 },
          },
        },
      }
    );

    return response.totalResults || response.orders?.length || 0;
  }

  /**
   * Transform API response to our types
   */
  private transformOrder(order: Record<string, unknown>): Order {
    const buyerInfo = order.buyerInfo as Record<string, unknown> | undefined;
    const totals = order.totals as Record<string, unknown> | undefined;
    const billingInfo = order.billingInfo as Record<string, unknown> | undefined;
    const shippingInfo = order.shippingInfo as Record<string, unknown> | undefined;
    const channelInfo = order.channelInfo as Record<string, unknown> | undefined;
    const enteredBy = order.enteredBy as Record<string, unknown> | undefined;
    const activities = order.activities as Record<string, unknown>[] | undefined;
    const lineItems = order.lineItems as Record<string, unknown>[] | undefined;

    return {
      id: order.id as string || order._id as string || '',
      number: order.number as number || 0,
      createdDate: order.createdDate as string || order._createdDate as string || '',
      updatedDate: order.updatedDate as string || order._updatedDate as string | undefined,
      lineItems: lineItems ? this.transformLineItems(lineItems) : [],
      buyerInfo: buyerInfo ? this.transformBuyerInfo(buyerInfo) : undefined,
      paymentStatus: order.paymentStatus as string | undefined,
      fulfillmentStatus: order.fulfillmentStatus as string | undefined,
      buyerNote: order.buyerNote as string | undefined,
      currency: order.currency as string | undefined,
      weightUnit: order.weightUnit as string | undefined,
      totals: totals ? this.transformTotals(totals) : undefined,
      billingInfo: billingInfo ? this.transformBillingInfo(billingInfo) : undefined,
      shippingInfo: shippingInfo ? this.transformShippingInfo(shippingInfo) : undefined,
      activities: activities?.map(a => this.transformActivity(a)),
      archived: order.archived as boolean | undefined,
      channelInfo: channelInfo ? this.transformChannelInfo(channelInfo) : undefined,
      enteredBy: enteredBy ? this.transformEnteredBy(enteredBy) : undefined,
      lastUpdated: order.lastUpdated as string | undefined,
      numericId: order.numericId as string | undefined,
    };
  }

  private transformOrders(orders: Record<string, unknown>[]): Order[] {
    return orders.map(o => this.transformOrder(o));
  }

  private transformLineItems(items: Record<string, unknown>[]): OrderLineItem[] {
    return items.map(item => {
      const options = item.options as Record<string, unknown>[] | undefined;
      const customTextFields = item.customTextFields as Record<string, unknown>[] | undefined;
      const discount = item.discount as Record<string, unknown> | undefined;
      const priceData = item.priceData as Record<string, unknown> | undefined;
      const mediaItem = item.mediaItem as Record<string, unknown> | undefined;

      return {
        id: item.id as string | item._id as string | undefined,
        productId: item.productId as string | undefined,
        name: item.name as string | undefined,
        quantity: item.quantity as number | undefined,
        price: item.price as string | undefined,
        totalPrice: item.totalPrice as string | undefined,
        sku: item.sku as string | undefined,
        weight: item.weight as number | undefined,
        lineItemType: item.lineItemType as string | undefined,
        options: options?.map(o => this.transformLineItemOption(o)),
        customTextFields: customTextFields?.map(c => this.transformCustomTextField(c)),
        fulfillerId: item.fulfillerId as string | undefined,
        mediaItem: mediaItem ? this.transformMediaItem(mediaItem) : undefined,
        discount: discount ? this.transformLineItemDiscount(discount) : undefined,
        tax: item.tax as number | undefined,
        taxIncludedInPrice: item.taxIncludedInPrice as boolean | undefined,
        priceData: priceData ? this.transformLineItemPriceData(priceData) : undefined,
      };
    });
  }

  private transformLineItemOption(option: Record<string, unknown>): OrderLineItemOption {
    return {
      option: option.option as string | undefined,
      selection: option.selection as string | undefined,
    };
  }

  private transformCustomTextField(field: Record<string, unknown>): OrderCustomTextField {
    return {
      title: field.title as string | undefined,
      value: field.value as string | undefined,
    };
  }

  private transformLineItemDiscount(discount: Record<string, unknown>): OrderLineItemDiscount {
    return {
      amount: discount.amount as string | undefined,
    };
  }

  private transformLineItemPriceData(data: Record<string, unknown>): LineItemPriceData {
    return {
      price: data.price as string | undefined,
      totalPrice: data.totalPrice as string | undefined,
      taxIncludedInPrice: data.taxIncludedInPrice as boolean | undefined,
    };
  }

  private transformMediaItem(item: Record<string, unknown>): MediaItem {
    const image = item.image as Record<string, unknown> | undefined;
    const video = item.video as Record<string, unknown> | undefined;
    const thumbnail = item.thumbnail as Record<string, unknown> | undefined;
    return {
      id: item.id as string | item._id as string | undefined,
      title: item.title as string | undefined,
      mediaType: item.mediaType as 'IMAGE' | 'VIDEO' | undefined,
      image: image ? this.transformImageInfo(image) : undefined,
      video: video ? this.transformVideoInfo(video) : undefined,
      thumbnail: thumbnail ? this.transformImageInfo(thumbnail) : undefined,
    };
  }

  private transformImageInfo(image: Record<string, unknown>): ImageInfo {
    return {
      url: image.url as string | undefined,
      width: image.width as number | undefined,
      height: image.height as number | undefined,
      format: image.format as string | undefined,
      altText: image.altText as string | undefined,
    };
  }

  private transformVideoInfo(video: Record<string, unknown>): VideoInfo {
    return {
      url: video.url as string | undefined,
    };
  }

  private transformBuyerInfo(buyer: Record<string, unknown>): BuyerInfo {
    return {
      id: buyer.id as string | buyer._id as string | undefined,
      type: buyer.type as string | undefined,
      firstName: buyer.firstName as string | undefined,
      lastName: buyer.lastName as string | undefined,
      phone: buyer.phone as string | undefined,
      email: buyer.email as string | undefined,
    };
  }

  private transformTotals(totals: Record<string, unknown>): OrderTotals {
    return {
      subtotal: totals.subtotal as string | undefined,
      shipping: totals.shipping as string | undefined,
      tax: totals.tax as string | undefined,
      discount: totals.discount as string | undefined,
      total: totals.total as string | undefined,
      weight: totals.weight as string | undefined,
      quantity: totals.quantity as number | undefined,
    };
  }

  private transformBillingInfo(billing: Record<string, unknown>): OrderBillingInfo {
    const address = billing.address as Record<string, unknown> | undefined;
    return {
      address: address ? this.transformAddress(address) : undefined,
      paymentMethod: billing.paymentMethod as string | undefined,
      paymentGatewayTransactionId: billing.paymentGatewayTransactionId as string | undefined,
      paymentProviderTransactionId: billing.paymentProviderTransactionId as string | undefined,
      paidDate: billing.paidDate as string | undefined,
    };
  }

  private transformShippingInfo(shipping: Record<string, unknown>): OrderShippingInfo {
    const shipmentDetails = shipping.shipmentDetails as Record<string, unknown> | undefined;
    const pickupDetails = shipping.pickupDetails as Record<string, unknown> | undefined;
    return {
      deliveryOption: shipping.deliveryOption as string | undefined,
      estimatedDeliveryTime: shipping.estimatedDeliveryTime as string | undefined,
      shipmentDetails: shipmentDetails ? this.transformShipmentDetails(shipmentDetails) : undefined,
      shippingRegion: shipping.shippingRegion as string | undefined,
      pickupDetails: pickupDetails ? this.transformPickupDetails(pickupDetails) : undefined,
    };
  }

  private transformShipmentDetails(details: Record<string, unknown>): ShipmentDetails {
    const address = details.address as Record<string, unknown> | undefined;
    const trackingInfo = details.trackingInfo as Record<string, unknown> | undefined;
    return {
      address: address ? this.transformAddress(address) : undefined,
      trackingInfo: trackingInfo ? this.transformTrackingInfo(trackingInfo) : undefined,
    };
  }

  private transformTrackingInfo(tracking: Record<string, unknown>): TrackingInfo {
    return {
      trackingNumber: tracking.trackingNumber as string | undefined,
      shippingProvider: tracking.shippingProvider as string | undefined,
      trackingLink: tracking.trackingLink as string | undefined,
    };
  }

  private transformPickupDetails(pickup: Record<string, unknown>): PickupDetails {
    const pickupAddress = pickup.pickupAddress as Record<string, unknown> | undefined;
    const buyerDetails = pickup.buyerDetails as Record<string, unknown> | undefined;
    return {
      pickupAddress: pickupAddress ? this.transformAddress(pickupAddress) : undefined,
      buyerDetails: buyerDetails ? this.transformBuyerDetails(buyerDetails) : undefined,
      pickupInstructions: pickup.pickupInstructions as string | undefined,
    };
  }

  private transformBuyerDetails(buyer: Record<string, unknown>): BuyerDetails {
    return {
      firstName: buyer.firstName as string | undefined,
      lastName: buyer.lastName as string | undefined,
      email: buyer.email as string | undefined,
      phone: buyer.phone as string | undefined,
    };
  }

  private transformAddress(address: Record<string, unknown>): Address {
    const streetAddress = address.streetAddress as Record<string, unknown> | undefined;
    return {
      country: address.country as string | undefined,
      subdivision: address.subdivision as string | undefined,
      city: address.city as string | undefined,
      postalCode: address.postalCode as string | undefined,
      addressLine: address.addressLine as string | undefined,
      addressLine2: address.addressLine2 as string | undefined,
      streetAddress: streetAddress ? this.transformStreetAddress(streetAddress) : undefined,
    };
  }

  private transformStreetAddress(street: Record<string, unknown>): StreetAddress {
    return {
      number: street.number as string | undefined,
      name: street.name as string | undefined,
      apt: street.apt as string | undefined,
    };
  }

  private transformActivity(activity: Record<string, unknown>): OrderActivity {
    return {
      type: activity.type as string | undefined,
      timestamp: activity.timestamp as string | undefined,
    };
  }

  private transformChannelInfo(channel: Record<string, unknown>): ChannelInfo {
    return {
      type: channel.type as string | undefined,
    };
  }

  private transformEnteredBy(entered: Record<string, unknown>): EnteredBy {
    return {
      id: entered.id as string | entered._id as string | undefined,
      identityType: entered.identityType as string | undefined,
    };
  }
}
