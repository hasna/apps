export interface AirNowConfig { apiKey: string; }

export interface AirNowObservation { DateObserved: string; HourObserved: number; LocalTimeZone: string; ReportingArea: string; StateCode: string; Latitude: number; Longitude: number; ParameterName: string; AQI: number; Category: { Number: number; Name: string }; }
export interface AirNowForecast { DateForecast: string; ReportingArea: string; StateCode: string; Latitude: number; Longitude: number; ParameterName: string; AQI: number; Category: { Number: number; Name: string }; ActionDay: boolean; Discussion: string; }

export class AirNowApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AirNowApiError'; this.statusCode = statusCode; }
}
