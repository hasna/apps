export interface EcwidConfig { storeId: string; token: string; }

export interface EcwidProduct { id: number; sku: string; name: string; price: number; compareToPrice: number; weight: number; quantity: number; enabled: boolean; description: string; imageUrl: string; categoryIds: number[]; created: string; updated: string; }
export interface EcwidProductList { total: number; count: number; offset: number; limit: number; items: EcwidProduct[]; }
export interface EcwidOrder { id: number; orderNumber: number; vendorOrderNumber: string; total: number; subtotal: number; email: string; paymentStatus: string; fulfillmentStatus: string; shippingPerson: { name: string; street: string; city: string; stateOrProvinceName: string; postalCode: string; countryName: string }; items: { id: number; productId: number; name: string; quantity: number; price: number }[]; createDate: string; }
export interface EcwidOrderList { total: number; count: number; offset: number; limit: number; items: EcwidOrder[]; }
export interface EcwidCategory { id: number; name: string; parentId: number; enabled: boolean; productCount: number; }
export interface EcwidCustomer { id: number; email: string; name: string; totalOrderCount: number; registered: string; }

export class EcwidApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'EcwidApiError'; this.statusCode = statusCode; }
}
