import type { SnapClient } from './client';
import type {
  TargetingDimension,
  TargetingResponse,
  GeoTarget,
  DemographicTarget,
  DeviceTarget,
} from '../types';

/**
 * Snapchat Targeting API
 * Explore targeting options and get insights
 */
export class TargetingApi {
  constructor(private readonly client: SnapClient) {}

  /**
   * Get all available targeting options for an ad account
   */
  async getOptions(adAccountId: string): Promise<TargetingDimension[]> {
    const response = await this.client.get<TargetingResponse>(
      `/adaccounts/${adAccountId}/targeting`
    );
    return response.targeting || [];
  }

  /**
   * Get available geo targeting options (countries, regions, metros)
   */
  async getGeoOptions(adAccountId: string): Promise<{
    countries: TargetingDimension[];
    regions: TargetingDimension[];
    metros: TargetingDimension[];
  }> {
    const [countries, regions, metros] = await Promise.all([
      this.client.get<TargetingResponse>(`/targeting/geo/country`),
      this.client.get<TargetingResponse>(`/targeting/geo/region`),
      this.client.get<TargetingResponse>(`/targeting/geo/metro`),
    ]);

    return {
      countries: countries.targeting || [],
      regions: regions.targeting || [],
      metros: metros.targeting || [],
    };
  }

  /**
   * Get available interest categories
   */
  async getInterests(): Promise<TargetingDimension[]> {
    const response = await this.client.get<TargetingResponse>('/targeting/interests');
    return response.targeting || [];
  }

  /**
   * Search interest categories
   */
  async searchInterests(query: string): Promise<TargetingDimension[]> {
    const response = await this.client.get<TargetingResponse>('/targeting/interests/search', {
      query,
    });
    return response.targeting || [];
  }

  /**
   * Get available device targeting options
   */
  async getDeviceOptions(): Promise<{
    osTypes: string[];
    carriers: TargetingDimension[];
    deviceMakes: TargetingDimension[];
  }> {
    const [carriers, deviceMakes] = await Promise.all([
      this.client.get<TargetingResponse>('/targeting/device/carrier'),
      this.client.get<TargetingResponse>('/targeting/device/make'),
    ]);

    return {
      osTypes: ['iOS', 'ANDROID', 'WEB'],
      carriers: carriers.targeting || [],
      deviceMakes: deviceMakes.targeting || [],
    };
  }

  /**
   * Get demographic targeting options
   */
  async getDemographicOptions(): Promise<{
    ageGroups: string[];
    genders: string[];
    languages: TargetingDimension[];
  }> {
    const languages = await this.client.get<TargetingResponse>('/targeting/demographics/language');

    return {
      ageGroups: ['13-17', '18-20', '21-24', '25-34', '35-49', '50+'],
      genders: ['MALE', 'FEMALE'],
      languages: languages.targeting || [],
    };
  }

  /**
   * Estimate reach for targeting specification
   */
  async estimateReach(
    adAccountId: string,
    targeting: {
      geos?: GeoTarget[];
      demographics?: DemographicTarget[];
      devices?: DeviceTarget[];
      interests?: string[];
      segments?: string[];
    }
  ): Promise<{
    estimate_ready: boolean;
    audience_size_minimum?: number;
    audience_size_maximum?: number;
  }> {
    const response = await this.client.post<{
      request_status: string;
      targeting_reach: {
        estimate_ready: boolean;
        audience_size_minimum?: number;
        audience_size_maximum?: number;
      };
    }>(
      `/adaccounts/${adAccountId}/targeting/reach`,
      { targeting_spec: targeting }
    );

    return response.targeting_reach;
  }

  /**
   * Get location radius options for location targeting
   */
  async getLocationRadiusOptions(): Promise<{
    units: string[];
    minRadius: number;
    maxRadius: number;
  }> {
    return {
      units: ['MILES', 'KILOMETERS'],
      minRadius: 0.5,
      maxRadius: 50,
    };
  }

  /**
   * Search for postal codes
   */
  async searchPostalCodes(countryCode: string, query: string): Promise<string[]> {
    const response = await this.client.get<{
      request_status: string;
      postal_codes: string[];
    }>('/targeting/geo/postal_code/search', {
      country_code: countryCode,
      query,
    });

    return response.postal_codes || [];
  }

  /**
   * Build a targeting specification
   */
  buildTargetingSpec(options: {
    countries?: string[];
    regions?: string[];
    metros?: string[];
    postalCodes?: string[];
    ageGroups?: string[];
    genders?: ('MALE' | 'FEMALE')[];
    languages?: string[];
    osTypes?: ('iOS' | 'ANDROID' | 'WEB')[];
    connectionTypes?: ('WIFI' | 'CELL')[];
    interests?: string[];
    segments?: string[];
    regulatedContent?: boolean;
  }): {
    geos?: GeoTarget[];
    demographics?: DemographicTarget[];
    devices?: DeviceTarget[];
    interests?: string[];
    segments?: string[];
    regulated_content?: boolean;
  } {
    const spec: {
      geos?: GeoTarget[];
      demographics?: DemographicTarget[];
      devices?: DeviceTarget[];
      interests?: string[];
      segments?: string[];
      regulated_content?: boolean;
    } = {};

    // Build geo targeting
    if (options.countries || options.regions || options.metros || options.postalCodes) {
      spec.geos = [];

      if (options.countries) {
        for (const country of options.countries) {
          spec.geos.push({ country_code: country });
        }
      }

      if (options.regions) {
        spec.geos.push({ region_id: options.regions });
      }

      if (options.metros) {
        spec.geos.push({ metro_id: options.metros });
      }

      if (options.postalCodes) {
        spec.geos.push({ postal_code: options.postalCodes });
      }
    }

    // Build demographic targeting
    if (options.ageGroups || options.genders || options.languages) {
      spec.demographics = [{
        age_groups: options.ageGroups,
        genders: options.genders,
        languages: options.languages,
      }];
    }

    // Build device targeting
    if (options.osTypes || options.connectionTypes) {
      spec.devices = [{
        os_type: options.osTypes,
        connection_types: options.connectionTypes,
      }];
    }

    // Add interests
    if (options.interests?.length) {
      spec.interests = options.interests;
    }

    // Add segments
    if (options.segments?.length) {
      spec.segments = options.segments;
    }

    // Regulated content flag
    if (options.regulatedContent !== undefined) {
      spec.regulated_content = options.regulatedContent;
    }

    return spec;
  }
}
