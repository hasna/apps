// Surtr Defense Systems Connector Types
// Counter-UAS: sensors, threat fusion, situation picture, and engagements

// ============================================
// Configuration
// ============================================

export interface SurtrConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'table' | 'pretty';

// ============================================
// Common Types
// ============================================

export interface Paginated<T> {
  data: T[];
  total?: number;
  page?: number;
  page_size?: number;
  next_cursor?: string;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
  altitude?: number;
}

// ============================================
// Sensor Types
// ============================================

export type SensorType = 'radar' | 'rf' | 'eo' | 'ir' | 'acoustic' | 'lidar' | string;
export type SensorStatus = 'online' | 'offline' | 'degraded' | 'maintenance' | string;

export interface Sensor {
  id: string;
  name: string;
  type: SensorType;
  status: SensorStatus;
  location?: GeoPoint;
  site_id?: string;
  vendor?: string;
  model?: string;
  firmware?: string;
  last_seen?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ListSensorsOptions {
  status?: SensorStatus;
  type?: SensorType;
  site_id?: string;
  limit?: number;
  cursor?: string;
}

// ============================================
// Threat Types
// ============================================

export type ThreatClassification = 'uav' | 'group1' | 'group2' | 'group3' | 'bird' | 'unknown' | string;
export type ThreatSeverity = 'low' | 'medium' | 'high' | 'critical' | string;
export type ThreatState = 'active' | 'lost' | 'resolved' | string;

export interface Threat {
  id: string;
  classification: ThreatClassification;
  severity?: ThreatSeverity;
  state?: ThreatState;
  confidence?: number;
  track_id?: string;
  location?: GeoPoint;
  heading?: number;
  speed?: number;
  detected_by?: string[];
  first_detected_at?: string;
  last_updated_at?: string;
}

export interface ListThreatsOptions {
  state?: ThreatState;
  severity?: ThreatSeverity;
  classification?: ThreatClassification;
  since?: string;
  limit?: number;
  cursor?: string;
}

// ============================================
// Situation Picture Types
// ============================================

export interface SituationPicture {
  generated_at?: string;
  active_threats?: Threat[];
  sensors?: Sensor[];
  threat_count?: number;
  sensor_count?: number;
  posture?: string;
}

// ============================================
// Engagement Types
// ============================================

export type EngagementStatus = 'proposed' | 'authorized' | 'active' | 'complete' | 'aborted' | string;

export interface Engagement {
  id: string;
  threat_id?: string;
  effector_id?: string;
  method?: string;
  status?: EngagementStatus;
  authorized_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ListEngagementsOptions {
  status?: EngagementStatus;
  threat_id?: string;
  limit?: number;
  cursor?: string;
}

export interface EngagementRecommendationInput {
  threat_id: string;
  effector_id?: string;
  method?: string;
  constraints?: Record<string, unknown>;
}

export interface EngagementRecommendation {
  threat_id: string;
  recommended_effector_id?: string;
  method?: string;
  confidence?: number;
  rationale?: string;
  alternatives?: Array<{
    effector_id?: string;
    method?: string;
    confidence?: number;
  }>;
}

// ============================================
// API Error Types
// ============================================

export interface SurtrErrorDetail {
  code?: string;
  message: string;
  field?: string;
}

export class SurtrApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: SurtrErrorDetail[];

  constructor(message: string, statusCode: number, errors?: SurtrErrorDetail[]) {
    super(message);
    this.name = 'SurtrApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
