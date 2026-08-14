export interface OuraConfig { token: string; }

export interface OuraSleep { id: string; day: string; bedtime_start: string; bedtime_end: string; duration: number; total_sleep_duration: number; rem_sleep_duration: number; deep_sleep_duration: number; light_sleep_duration: number; awake_time: number; efficiency: number; heart_rate: { interval: number; items: number[]; }; }
export interface OuraActivity { id: string; day: string; score: number; active_calories: number; total_calories: number; steps: number; equivalent_walking_distance: number; high_activity_time: number; medium_activity_time: number; low_activity_time: number; sedentary_time: number; }
export interface OuraReadiness { id: string; day: string; score: number; temperature_deviation: number; contributors: { activity_balance: number; body_temperature: number; hrv_balance: number; previous_day_activity: number; previous_night: number; recovery_index: number; resting_heart_rate: number; sleep_balance: number }; }
export interface OuraHeartRate { bpm: number; source: string; timestamp: string; }
export interface OuraPersonalInfo { id: string; age: number; weight: number; height: number; email: string; }
export interface OuraDataList<T> { data: T[]; next_token: string | null; }

export class OuraApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'OuraApiError'; this.statusCode = statusCode; }
}
