// Zoho Bookings Connector — appointment scheduling and customer management
import { ZohoBookingsClient } from './client';
import type {
  ZohoBookingsAppointment,
  ZohoBookingsConfig,
  ZohoBookingsCustomer,
  ZohoBookingsCustomerDetails,
  ZohoBookingsResource,
  ZohoBookingsService,
  ZohoBookingsStaff,
  ZohoBookingsWorkspace,
} from '../types';

export { ZohoBookingsClient, encodeFormBody, resolveBookingsApiBase } from './client';

export class ZohoBookings {
  private readonly client: ZohoBookingsClient;

  constructor(config: ZohoBookingsConfig) {
    this.client = new ZohoBookingsClient(config);
  }

  static fromEnv(): ZohoBookings {
    const token = process.env.ZOHOBOOKINGS_TOKEN;
    if (!token) throw new Error('ZOHOBOOKINGS_TOKEN is required');
    return new ZohoBookings({
      token,
      baseUrl: process.env.ZOHOBOOKINGS_BASE_URL,
    });
  }

  // Workspaces
  async listWorkspaces(workspaceId?: string): Promise<{ data: ZohoBookingsWorkspace[] }> {
    return this.client.get('workspaces', { workspace_id: workspaceId });
  }

  async createWorkspace(name: string): Promise<unknown> {
    return this.client.post('createworkspace', { name });
  }

  // Services
  async listServices(options: {
    workspace_id: string;
    service_id?: string;
    staff_id?: string;
  }): Promise<{ data: ZohoBookingsService[]; next_page_available?: boolean; page?: number }> {
    return this.client.get('services', options);
  }

  async createService(params: Record<string, unknown>): Promise<unknown> {
    return this.client.post('createservice', params);
  }

  // Staff
  async listStaff(options: {
    workspace_id: string;
    staff_id?: string;
    service_id?: string;
    staff_email?: string;
  }): Promise<{ data: ZohoBookingsStaff[] }> {
    return this.client.get('staffs', options);
  }

  // Resources
  async listResources(options?: {
    resource_id?: string;
    service_id?: string;
  }): Promise<{ data: ZohoBookingsResource[] }> {
    return this.client.get('resources', options);
  }

  // Availability
  async getAvailableSlots(options: {
    service_id: string;
    selected_date: string;
    staff_id?: string;
    group_id?: string;
    resource_id?: string;
  }): Promise<{ data: string[]; time_zone?: string }> {
    return this.client.get('availableslots', options);
  }

  async getStaffAvailability(options: Record<string, string | undefined>): Promise<unknown> {
    return this.client.get('staffavailability', options);
  }

  async getGroupAvailability(options: Record<string, string | undefined>): Promise<unknown> {
    return this.client.get('groupavailability', options);
  }

  // Appointments
  async fetchAppointments(
    filters: Record<string, unknown>,
  ): Promise<{ response?: ZohoBookingsAppointment[]; next_page_available?: boolean; page?: number }> {
    return this.client.post('fetchappointment', { data: filters });
  }

  async getAppointment(bookingId: string): Promise<ZohoBookingsAppointment> {
    return this.client.get('getappointment', { booking_id: bookingId });
  }

  async bookAppointment(params: {
    service_id: string;
    from_time: string;
    customer_details: ZohoBookingsCustomerDetails;
    staff_id?: string;
    resource_id?: string;
    group_id?: string;
    to_time?: string;
    time_zone?: string;
    notes?: string;
    additional_fields?: Record<string, unknown>;
    payment_info?: Record<string, unknown>;
  }): Promise<ZohoBookingsAppointment> {
    const { customer_details, additional_fields, payment_info, ...rest } = params;
    return this.client.post('appointment', {
      ...rest,
      customer_details,
      ...(additional_fields ? { additional_fields } : {}),
      ...(payment_info ? { payment_info } : {}),
    });
  }

  async rescheduleAppointment(params: Record<string, unknown>): Promise<unknown> {
    return this.client.post('rescheduleappointment', params);
  }

  async updateAppointment(
    bookingId: string,
    action: 'completed' | 'cancel' | 'noshow',
  ): Promise<unknown> {
    return this.client.post('updateappointment', { booking_id: bookingId, action });
  }

  async cancelAppointment(bookingId: string): Promise<unknown> {
    return this.updateAppointment(bookingId, 'cancel');
  }

  // Customers
  async listCustomers(options?: Record<string, string | undefined>): Promise<unknown> {
    return this.client.get('fetchcustomers', options);
  }

  async createCustomer(
    customers: Array<Record<string, unknown>>,
  ): Promise<{ response?: ZohoBookingsCustomer[] }> {
    return this.client.post('addcustomer', { customerMap: { data: customers } });
  }

  async updateCustomer(customerMap: Record<string, unknown>): Promise<unknown> {
    return this.client.post('updatecustomer', { customerMap });
  }

  async deleteCustomer(customerId: string): Promise<unknown> {
    return this.client.post('deletecustomer', { customer_id: customerId });
  }

  // Metadata
  async listServiceCategories(workspaceId?: string): Promise<unknown> {
    return this.client.get('servicecategories', workspaceId ? { workspace_id: workspaceId } : undefined);
  }

  async listAdditionalFields(serviceId?: string): Promise<unknown> {
    return this.client.get('additionalfields', serviceId ? { service_id: serviceId } : undefined);
  }

  async listBookingPages(workspaceId?: string): Promise<unknown> {
    return this.client.get('bookingpages', workspaceId ? { workspace_id: workspaceId } : undefined);
  }

  getClient(): ZohoBookingsClient {
    return this.client;
  }
}
