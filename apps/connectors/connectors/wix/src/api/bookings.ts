import type { WixClient } from './client';
import type {
  Service,
  ServiceCategory,
  ServiceMedia,
  ServiceForm,
  ServicePayment,
  ServicePaymentFixed,
  ServicePaymentVaried,
  ServicePaymentCustom,
  PaymentOptions,
  OnlineBooking,
  ServiceLocation,
  BusinessLocation,
  CustomLocation,
  BookingPolicy,
  ServiceSchedule,
  ResourceGroup,
  ConferencingOptions,
  Booking,
  BookedEntity,
  BookedSlot,
  BookedSchedule,
  BookedResource,
  BookingContactDetails,
  BookingField,
  ExternalCalendarOverrides,
  Price,
  Address,
  StreetAddress,
  MediaItem,
  ImageInfo,
  VideoInfo,
} from '../types';

export interface ListServicesOptions {
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export interface QueryServicesOptions extends ListServicesOptions {
  filter?: Record<string, unknown>;
  sort?: { fieldName: string; order?: 'ASC' | 'DESC' }[];
}

export interface ListBookingsOptions {
  limit?: number;
  offset?: number;
}

export interface QueryBookingsOptions extends ListBookingsOptions {
  filter?: Record<string, unknown>;
  sort?: { fieldName: string; order?: 'ASC' | 'DESC' }[];
}

/**
 * Wix Bookings API
 * Services endpoint: /bookings/v2/services
 * Bookings endpoint: /bookings/v2/bookings
 */
export class BookingsApi {
  constructor(private readonly client: WixClient) {}

  // ============================================
  // Services
  // ============================================

  /**
   * List services
   */
  async listServices(options: ListServicesOptions = {}): Promise<Service[]> {
    const response = await this.client.request<{ services: Record<string, unknown>[] }>(
      '/bookings/v2/services/query',
      {
        method: 'POST',
        body: {
          query: {
            paging: {
              limit: options.limit || 50,
              offset: options.offset || 0,
            },
          },
          includeDeleted: options.includeDeleted,
        },
      }
    );

    return this.transformServices(response.services || []);
  }

  /**
   * Query services with filters
   */
  async queryServices(options: QueryServicesOptions = {}): Promise<Service[]> {
    const response = await this.client.request<{ services: Record<string, unknown>[] }>(
      '/bookings/v2/services/query',
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
          includeDeleted: options.includeDeleted,
        },
      }
    );

    return this.transformServices(response.services || []);
  }

  /**
   * Get a single service by ID
   */
  async getService(serviceId: string): Promise<Service> {
    const response = await this.client.request<{ service: Record<string, unknown> }>(
      `/bookings/v2/services/${serviceId}`
    );

    return this.transformService(response.service);
  }

  // ============================================
  // Bookings
  // ============================================

  /**
   * List bookings
   */
  async listBookings(options: ListBookingsOptions = {}): Promise<Booking[]> {
    const response = await this.client.request<{ bookings: Record<string, unknown>[] }>(
      '/bookings/v2/bookings/query',
      {
        method: 'POST',
        body: {
          query: {
            paging: {
              limit: options.limit || 50,
              offset: options.offset || 0,
            },
          },
        },
      }
    );

    return this.transformBookings(response.bookings || []);
  }

  /**
   * Query bookings with filters
   */
  async queryBookings(options: QueryBookingsOptions = {}): Promise<Booking[]> {
    const response = await this.client.request<{ bookings: Record<string, unknown>[] }>(
      '/bookings/v2/bookings/query',
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

    return this.transformBookings(response.bookings || []);
  }

  /**
   * Get a single booking by ID
   */
  async getBooking(bookingId: string): Promise<Booking> {
    const response = await this.client.request<{ booking: Record<string, unknown> }>(
      `/bookings/v2/bookings/${bookingId}`
    );

    return this.transformBooking(response.booking);
  }

  /**
   * Get booking count
   */
  async countBookings(filter?: Record<string, unknown>): Promise<number> {
    const response = await this.client.request<{ bookings: Record<string, unknown>[]; pagingMetadata?: { total?: number } }>(
      '/bookings/v2/bookings/query',
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

    return response.pagingMetadata?.total || response.bookings?.length || 0;
  }

  /**
   * Get service count
   */
  async countServices(filter?: Record<string, unknown>): Promise<number> {
    const response = await this.client.request<{ services: Record<string, unknown>[]; pagingMetadata?: { total?: number } }>(
      '/bookings/v2/services/query',
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

    return response.pagingMetadata?.total || response.services?.length || 0;
  }

  // ============================================
  // Transform Methods - Services
  // ============================================

  private transformService(service: Record<string, unknown>): Service {
    const category = service.category as Record<string, unknown> | undefined;
    const media = service.media as Record<string, unknown> | undefined;
    const form = service.form as Record<string, unknown> | undefined;
    const payment = service.payment as Record<string, unknown> | undefined;
    const onlineBooking = service.onlineBooking as Record<string, unknown> | undefined;
    const locations = service.locations as Record<string, unknown>[] | undefined;
    const bookingPolicy = service.bookingPolicy as Record<string, unknown> | undefined;
    const schedule = service.schedule as Record<string, unknown> | undefined;
    const resourceGroups = service.resourceGroups as Record<string, unknown>[] | undefined;
    const conferencing = service.conferencing as Record<string, unknown> | undefined;

    return {
      id: service.id as string || service._id as string || '',
      scheduleId: service.scheduleId as string | undefined,
      name: service.name as string || '',
      description: service.description as string | undefined,
      category: category ? this.transformCategory(category) : undefined,
      tagLine: service.tagLine as string | undefined,
      defaultCapacity: service.defaultCapacity as number | undefined,
      media: media ? this.transformServiceMedia(media) : undefined,
      hidden: service.hidden as boolean | undefined,
      form: form ? this.transformForm(form) : undefined,
      payment: payment ? this.transformPayment(payment) : undefined,
      onlineBooking: onlineBooking ? this.transformOnlineBooking(onlineBooking) : undefined,
      locations: locations?.map(l => this.transformLocation(l)),
      bookingPolicy: bookingPolicy ? this.transformBookingPolicy(bookingPolicy) : undefined,
      schedule: schedule ? this.transformSchedule(schedule) : undefined,
      staffMemberIds: service.staffMemberIds as string[] | undefined,
      resourceGroups: resourceGroups?.map(r => this.transformResourceGroup(r)),
      conferencing: conferencing ? this.transformConferencing(conferencing) : undefined,
      slug: service.slug as string | undefined,
      createdDate: service.createdDate as string | service._createdDate as string | undefined,
      updatedDate: service.updatedDate as string | service._updatedDate as string | undefined,
    };
  }

  private transformServices(services: Record<string, unknown>[]): Service[] {
    return services.map(s => this.transformService(s));
  }

  private transformCategory(category: Record<string, unknown>): ServiceCategory {
    return {
      id: category.id as string | category._id as string | undefined,
      name: category.name as string | undefined,
      sortOrder: category.sortOrder as number | undefined,
    };
  }

  private transformServiceMedia(media: Record<string, unknown>): ServiceMedia {
    const mainMedia = media.mainMedia as Record<string, unknown> | undefined;
    const items = media.items as Record<string, unknown>[] | undefined;
    const coverMedia = media.coverMedia as Record<string, unknown> | undefined;
    return {
      mainMedia: mainMedia ? this.transformMediaItem(mainMedia) : undefined,
      items: items?.map(i => this.transformMediaItem(i)),
      coverMedia: coverMedia ? this.transformMediaItem(coverMedia) : undefined,
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

  private transformForm(form: Record<string, unknown>): ServiceForm {
    return {
      id: form.id as string | form._id as string | undefined,
    };
  }

  private transformPayment(payment: Record<string, unknown>): ServicePayment {
    const fixed = payment.fixed as Record<string, unknown> | undefined;
    const varied = payment.varied as Record<string, unknown> | undefined;
    const custom = payment.custom as Record<string, unknown> | undefined;
    const options = payment.options as Record<string, unknown> | undefined;
    return {
      rateType: payment.rateType as ServicePayment['rateType'] | undefined,
      fixed: fixed ? this.transformPaymentFixed(fixed) : undefined,
      varied: varied ? this.transformPaymentVaried(varied) : undefined,
      custom: custom ? this.transformPaymentCustom(custom) : undefined,
      options: options ? this.transformPaymentOptions(options) : undefined,
    };
  }

  private transformPaymentFixed(fixed: Record<string, unknown>): ServicePaymentFixed {
    const price = fixed.price as Record<string, unknown> | undefined;
    const deposit = fixed.deposit as Record<string, unknown> | undefined;
    return {
      price: price ? this.transformPrice(price) : undefined,
      deposit: deposit ? this.transformPrice(deposit) : undefined,
    };
  }

  private transformPaymentVaried(varied: Record<string, unknown>): ServicePaymentVaried {
    const defaultPrice = varied.defaultPrice as Record<string, unknown> | undefined;
    const minPrice = varied.minPrice as Record<string, unknown> | undefined;
    const maxPrice = varied.maxPrice as Record<string, unknown> | undefined;
    const deposit = varied.deposit as Record<string, unknown> | undefined;
    return {
      defaultPrice: defaultPrice ? this.transformPrice(defaultPrice) : undefined,
      minPrice: minPrice ? this.transformPrice(minPrice) : undefined,
      maxPrice: maxPrice ? this.transformPrice(maxPrice) : undefined,
      deposit: deposit ? this.transformPrice(deposit) : undefined,
    };
  }

  private transformPaymentCustom(custom: Record<string, unknown>): ServicePaymentCustom {
    return {
      description: custom.description as string | undefined,
    };
  }

  private transformPaymentOptions(options: Record<string, unknown>): PaymentOptions {
    return {
      online: options.online as boolean | undefined,
      inPerson: options.inPerson as boolean | undefined,
      pricingPlan: options.pricingPlan as boolean | undefined,
    };
  }

  private transformPrice(price: Record<string, unknown>): Price {
    return {
      amount: price.amount as string || '0',
      currency: price.currency as string || 'USD',
      formattedAmount: price.formattedAmount as string | undefined,
    };
  }

  private transformOnlineBooking(online: Record<string, unknown>): OnlineBooking {
    return {
      enabled: online.enabled as boolean | undefined,
    };
  }

  private transformLocation(location: Record<string, unknown>): ServiceLocation {
    const business = location.business as Record<string, unknown> | undefined;
    const custom = location.custom as Record<string, unknown> | undefined;
    return {
      type: location.type as ServiceLocation['type'] | undefined,
      business: business ? this.transformBusinessLocation(business) : undefined,
      custom: custom ? this.transformCustomLocation(custom) : undefined,
    };
  }

  private transformBusinessLocation(business: Record<string, unknown>): BusinessLocation {
    const address = business.address as Record<string, unknown> | undefined;
    return {
      id: business.id as string | business._id as string | undefined,
      name: business.name as string | undefined,
      address: address ? this.transformAddress(address) : undefined,
    };
  }

  private transformCustomLocation(custom: Record<string, unknown>): CustomLocation {
    const address = custom.address as Record<string, unknown> | undefined;
    return {
      address: address ? this.transformAddress(address) : undefined,
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

  private transformBookingPolicy(policy: Record<string, unknown>): BookingPolicy {
    return {
      id: policy.id as string | policy._id as string | undefined,
      name: policy.name as string | undefined,
    };
  }

  private transformSchedule(schedule: Record<string, unknown>): ServiceSchedule {
    return {
      id: schedule.id as string | schedule._id as string | undefined,
      firstSessionStart: schedule.firstSessionStart as string | undefined,
      lastSessionEnd: schedule.lastSessionEnd as string | undefined,
    };
  }

  private transformResourceGroup(group: Record<string, unknown>): ResourceGroup {
    return {
      id: group.id as string | group._id as string | undefined,
      name: group.name as string | undefined,
    };
  }

  private transformConferencing(conferencing: Record<string, unknown>): ConferencingOptions {
    return {
      enabled: conferencing.enabled as boolean | undefined,
    };
  }

  // ============================================
  // Transform Methods - Bookings
  // ============================================

  private transformBooking(booking: Record<string, unknown>): Booking {
    const bookedEntity = booking.bookedEntity as Record<string, unknown> | undefined;
    const contactDetails = booking.contactDetails as Record<string, unknown> | undefined;
    const additionalFields = booking.additionalFields as Record<string, unknown>[] | undefined;
    const externalCalendarOverrides = booking.externalCalendarOverrides as Record<string, unknown> | undefined;

    return {
      id: booking.id as string || booking._id as string || '',
      bookedEntity: bookedEntity ? this.transformBookedEntity(bookedEntity) : undefined,
      status: booking.status as Booking['status'] | undefined,
      paymentStatus: booking.paymentStatus as Booking['paymentStatus'] | undefined,
      selectedPaymentOption: booking.selectedPaymentOption as string | undefined,
      contactDetails: contactDetails ? this.transformContactDetails(contactDetails) : undefined,
      additionalFields: additionalFields?.map(f => this.transformBookingField(f)),
      numberOfParticipants: booking.numberOfParticipants as number | undefined,
      createdDate: booking.createdDate as string | booking._createdDate as string | undefined,
      updatedDate: booking.updatedDate as string | booking._updatedDate as string | undefined,
      startDate: booking.startDate as string | undefined,
      endDate: booking.endDate as string | undefined,
      externalCalendarOverrides: externalCalendarOverrides ? this.transformExternalCalendarOverrides(externalCalendarOverrides) : undefined,
      revision: booking.revision as string | undefined,
      extendedFields: booking.extendedFields as Record<string, unknown> | undefined,
    };
  }

  private transformBookings(bookings: Record<string, unknown>[]): Booking[] {
    return bookings.map(b => this.transformBooking(b));
  }

  private transformBookedEntity(entity: Record<string, unknown>): BookedEntity {
    const slot = entity.slot as Record<string, unknown> | undefined;
    const schedule = entity.schedule as Record<string, unknown> | undefined;
    return {
      slot: slot ? this.transformBookedSlot(slot) : undefined,
      schedule: schedule ? this.transformBookedSchedule(schedule) : undefined,
      title: entity.title as string | undefined,
      tags: entity.tags as string[] | undefined,
    };
  }

  private transformBookedSlot(slot: Record<string, unknown>): BookedSlot {
    const resource = slot.resource as Record<string, unknown> | undefined;
    const location = slot.location as Record<string, unknown> | undefined;
    return {
      sessionId: slot.sessionId as string | undefined,
      serviceId: slot.serviceId as string | undefined,
      scheduleId: slot.scheduleId as string | undefined,
      startDate: slot.startDate as string | undefined,
      endDate: slot.endDate as string | undefined,
      timezone: slot.timezone as string | undefined,
      resource: resource ? this.transformBookedResource(resource) : undefined,
      location: location ? this.transformLocation(location) : undefined,
    };
  }

  private transformBookedSchedule(schedule: Record<string, unknown>): BookedSchedule {
    const location = schedule.location as Record<string, unknown> | undefined;
    return {
      scheduleId: schedule.scheduleId as string | undefined,
      serviceId: schedule.serviceId as string | undefined,
      timezone: schedule.timezone as string | undefined,
      firstSessionStart: schedule.firstSessionStart as string | undefined,
      lastSessionEnd: schedule.lastSessionEnd as string | undefined,
      location: location ? this.transformLocation(location) : undefined,
    };
  }

  private transformBookedResource(resource: Record<string, unknown>): BookedResource {
    return {
      id: resource.id as string | resource._id as string | undefined,
      name: resource.name as string | undefined,
    };
  }

  private transformContactDetails(contact: Record<string, unknown>): BookingContactDetails {
    const fullAddress = contact.fullAddress as Record<string, unknown> | undefined;
    return {
      contactId: contact.contactId as string | undefined,
      firstName: contact.firstName as string | undefined,
      lastName: contact.lastName as string | undefined,
      email: contact.email as string | undefined,
      phone: contact.phone as string | undefined,
      fullAddress: fullAddress ? this.transformAddress(fullAddress) : undefined,
      timeZone: contact.timeZone as string | undefined,
      countryCode: contact.countryCode as string | undefined,
    };
  }

  private transformBookingField(field: Record<string, unknown>): BookingField {
    return {
      fieldId: field.fieldId as string | undefined,
      label: field.label as string | undefined,
      valueType: field.valueType as BookingField['valueType'] | undefined,
      value: field.value as string | undefined,
    };
  }

  private transformExternalCalendarOverrides(overrides: Record<string, unknown>): ExternalCalendarOverrides {
    return {
      title: overrides.title as string | undefined,
      description: overrides.description as string | undefined,
    };
  }
}
