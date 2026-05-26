export interface DHLConfig { apiKey: string; }

export interface DHLShipment { id: string; service: string; origin: DHLAddress; destination: DHLAddress; status: { timestamp: string; location: string; statusCode: string; status: string; description: string }; events: DHLEvent[]; }
export interface DHLEvent { timestamp: string; location: string; statusCode: string; status: string; description: string; }
export interface DHLAddress { address: { addressLocality: string; postalCode: string; countryCode: string }; }
export interface DHLTrackingResult { shipments: DHLShipment[]; }
export interface DHLRate { productName: string; deliveryCapabilities: { estimatedDeliveryDateAndTime: string }; totalPrice: { price: number; currencyType: string }[]; }
export interface DHLRateResult { products: DHLRate[]; }
export interface DHLLocation { url: string; location: { address: { streetAddress: string; addressLocality: string; postalCode: string; countryCode: string }; geo: { latitude: number; longitude: number } }; name: string; openingHours: string; }

export class DHLApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'DHLApiError'; this.statusCode = statusCode; }
}
