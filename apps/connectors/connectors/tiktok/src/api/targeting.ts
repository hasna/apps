import type { TikTokClient } from './client';
import type { Location, Interest, DeviceModel, Language, Carrier, TargetingCategory } from '../types';

/**
 * TikTok Targeting API
 * Get available targeting options (locations, interests, devices, etc.)
 */
export class TargetingApi {
  constructor(private readonly client: TikTokClient) {}

  // ============================================
  // Locations
  // ============================================

  /**
   * Get location targeting options
   * GET /targeting/recommend/get/
   */
  async getLocations(advertiserId: string, params?: {
    objective_type?: string;
    placement_type?: string;
    location_type?: 'COUNTRY' | 'STATE' | 'CITY' | 'DMA' | 'REGION';
  }): Promise<{ list: Location[] }> {
    return this.client.get<{ list: Location[] }>('/targeting/recommend/get/', {
      advertiser_id: advertiserId,
      objective_type: params?.objective_type,
      placement_type: params?.placement_type,
      location_type: params?.location_type,
    });
  }

  /**
   * Search locations by name
   * GET /region/search/
   */
  async searchLocations(
    advertiserId: string,
    query: string,
    params?: {
      objective_type?: string;
      placement_type?: string;
      level?: string;
    }
  ): Promise<{ regions: Location[] }> {
    return this.client.get<{ regions: Location[] }>('/region/search/', {
      advertiser_id: advertiserId,
      search_term: query,
      objective_type: params?.objective_type,
      placement_type: params?.placement_type,
      level: params?.level,
    });
  }

  // ============================================
  // Interests & Behaviors
  // ============================================

  /**
   * Get interest categories
   * GET /tool/interest_category/
   */
  async getInterestCategories(advertiserId: string, params?: {
    version?: number;
    placements?: string[];
  }): Promise<{ interest_categories: TargetingCategory[] }> {
    return this.client.get<{ interest_categories: TargetingCategory[] }>('/tool/interest_category/', {
      advertiser_id: advertiserId,
      version: params?.version,
      placements: params?.placements,
    });
  }

  /**
   * Get interest keywords
   * GET /tool/interest_keyword/recommend/
   */
  async getInterestKeywords(
    advertiserId: string,
    keyword: string,
    params?: {
      placements?: string[];
      language?: string;
    }
  ): Promise<{ list: Interest[] }> {
    return this.client.get<{ list: Interest[] }>('/tool/interest_keyword/recommend/', {
      advertiser_id: advertiserId,
      keyword,
      placements: params?.placements,
      language: params?.language,
    });
  }

  /**
   * Get action categories (behaviors)
   * GET /tool/action_category/
   */
  async getActionCategories(advertiserId: string, params?: {
    placements?: string[];
  }): Promise<{ action_categories: TargetingCategory[] }> {
    return this.client.get<{ action_categories: TargetingCategory[] }>('/tool/action_category/', {
      advertiser_id: advertiserId,
      placements: params?.placements,
    });
  }

  // ============================================
  // Demographics
  // ============================================

  /**
   * Get age targeting options
   * Returns available age groups for targeting
   */
  async getAgeOptions(): Promise<{
    age_groups: Array<{
      age_id: string;
      age_name: string;
      min_age?: number;
      max_age?: number;
    }>;
  }> {
    // Age groups are predefined by TikTok
    return {
      age_groups: [
        { age_id: 'AGE_13_17', age_name: '13-17', min_age: 13, max_age: 17 },
        { age_id: 'AGE_18_24', age_name: '18-24', min_age: 18, max_age: 24 },
        { age_id: 'AGE_25_34', age_name: '25-34', min_age: 25, max_age: 34 },
        { age_id: 'AGE_35_44', age_name: '35-44', min_age: 35, max_age: 44 },
        { age_id: 'AGE_45_54', age_name: '45-54', min_age: 45, max_age: 54 },
        { age_id: 'AGE_55_PLUS', age_name: '55+', min_age: 55 },
      ],
    };
  }

  /**
   * Get gender targeting options
   */
  async getGenderOptions(): Promise<{
    genders: Array<{
      gender_id: string;
      gender_name: string;
    }>;
  }> {
    return {
      genders: [
        { gender_id: 'GENDER_UNLIMITED', gender_name: 'All' },
        { gender_id: 'GENDER_MALE', gender_name: 'Male' },
        { gender_id: 'GENDER_FEMALE', gender_name: 'Female' },
      ],
    };
  }

  // ============================================
  // Languages
  // ============================================

  /**
   * Get language targeting options
   * GET /tool/language/
   */
  async getLanguages(advertiserId: string): Promise<{ languages: Language[] }> {
    return this.client.get<{ languages: Language[] }>('/tool/language/', {
      advertiser_id: advertiserId,
    });
  }

  // ============================================
  // Devices
  // ============================================

  /**
   * Get device model targeting options
   * GET /tool/device_model/
   */
  async getDeviceModels(advertiserId: string, params?: {
    brand?: string;
    os?: 'IOS' | 'ANDROID';
  }): Promise<{ list: DeviceModel[] }> {
    return this.client.get<{ list: DeviceModel[] }>('/tool/device_model/', {
      advertiser_id: advertiserId,
      brand: params?.brand,
      os: params?.os,
    });
  }

  /**
   * Get operating system options
   */
  async getOperatingSystems(): Promise<{
    operating_systems: Array<{
      os_id: string;
      os_name: string;
    }>;
  }> {
    return {
      operating_systems: [
        { os_id: 'ANDROID', os_name: 'Android' },
        { os_id: 'IOS', os_name: 'iOS' },
      ],
    };
  }

  /**
   * Get network types
   */
  async getNetworkTypes(): Promise<{
    network_types: Array<{
      network_id: string;
      network_name: string;
    }>;
  }> {
    return {
      network_types: [
        { network_id: 'WIFI', network_name: 'WiFi' },
        { network_id: '2G', network_name: '2G' },
        { network_id: '3G', network_name: '3G' },
        { network_id: '4G', network_name: '4G' },
        { network_id: '5G', network_name: '5G' },
      ],
    };
  }

  // ============================================
  // Carriers
  // ============================================

  /**
   * Get carrier targeting options
   * GET /tool/carrier/
   */
  async getCarriers(advertiserId: string, locationIds?: string[]): Promise<{ carriers: Carrier[] }> {
    return this.client.get<{ carriers: Carrier[] }>('/tool/carrier/', {
      advertiser_id: advertiserId,
      location_ids: locationIds,
    });
  }

  // ============================================
  // Household & Spending
  // ============================================

  /**
   * Get household income targeting options
   */
  async getHouseholdIncomeOptions(): Promise<{
    household_incomes: Array<{
      income_id: string;
      income_name: string;
    }>;
  }> {
    return {
      household_incomes: [
        { income_id: 'TOP_5_PCT', income_name: 'Top 5%' },
        { income_id: 'TOP_10_PCT', income_name: 'Top 10%' },
        { income_id: 'TOP_10_25_PCT', income_name: 'Top 10-25%' },
        { income_id: 'TOP_25_50_PCT', income_name: 'Top 25-50%' },
        { income_id: 'BOTTOM_50_PCT', income_name: 'Bottom 50%' },
      ],
    };
  }

  /**
   * Get spending power targeting options
   */
  async getSpendingPowerOptions(): Promise<{
    spending_powers: Array<{
      spending_id: string;
      spending_name: string;
    }>;
  }> {
    return {
      spending_powers: [
        { spending_id: 'HIGH', spending_name: 'High' },
        { spending_id: 'MEDIUM', spending_name: 'Medium' },
        { spending_id: 'LOW', spending_name: 'Low' },
      ],
    };
  }

  // ============================================
  // Audience Size Estimation
  // ============================================

  /**
   * Get estimated audience size for targeting criteria
   * GET /tool/targeting_reach/
   */
  async getReachEstimate(params: {
    advertiser_id: string;
    objective_type: string;
    placement_type?: string;
    location_ids?: string[];
    age_groups?: string[];
    gender?: string;
    languages?: string[];
    interest_category_ids?: string[];
    interest_keyword_ids?: string[];
    audience_ids?: string[];
    excluded_audience_ids?: string[];
    device_model_ids?: string[];
    operating_systems?: string[];
    network_types?: string[];
  }): Promise<{
    reach: {
      lower_bound: number;
      upper_bound: number;
    };
  }> {
    return this.client.get('/tool/targeting_reach/', {
      advertiser_id: params.advertiser_id,
      objective_type: params.objective_type,
      placement_type: params.placement_type,
      location_ids: params.location_ids,
      age_groups: params.age_groups,
      gender: params.gender,
      languages: params.languages,
      interest_category_ids: params.interest_category_ids,
      interest_keyword_ids: params.interest_keyword_ids,
      audience_ids: params.audience_ids,
      excluded_audience_ids: params.excluded_audience_ids,
      device_model_ids: params.device_model_ids,
      operating_systems: params.operating_systems,
      network_types: params.network_types,
    });
  }
}
