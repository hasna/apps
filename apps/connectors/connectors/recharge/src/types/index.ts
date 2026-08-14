export interface RechargeConfig { token: string; }

export interface RechargeSubscription { id: number; customer_id: number; address_id: number; status: string; product_title: string; variant_title: string; price: string; quantity: number; next_charge_scheduled_at: string | null; created_at: string; updated_at: string; }
export interface RechargeSubscriptionList { subscriptions: RechargeSubscription[]; }
export interface RechargeCustomer { id: number; email: string; first_name: string; last_name: string; status: string; created_at: string; updated_at: string; number_active_subscriptions: number; }
export interface RechargeCustomerList { customers: RechargeCustomer[]; }
export interface RechargeOrder { id: number; customer_id: number; status: string; total_price: string; scheduled_at: string; processed_at: string | null; line_items: { subscription_id: number; title: string; quantity: number; price: string }[]; }
export interface RechargeOrderList { orders: RechargeOrder[]; }
export interface RechargeAddress { id: number; customer_id: number; first_name: string; last_name: string; address1: string; city: string; province: string; zip: string; country: string; }

export class RechargeApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'RechargeApiError'; this.statusCode = statusCode; }
}
