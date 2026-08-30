export type EmailType = "work" | "personal" | "other";
export type PhoneType = "mobile" | "work" | "home" | "fax" | "whatsapp" | "other";
export type AddressType = "physical" | "mailing" | "billing" | "virtual" | "other";
export type SocialPlatform =
  | "twitter" | "linkedin" | "github" | "instagram" | "telegram"
  | "discord" | "youtube" | "tiktok" | "bluesky" | "facebook"
  | "whatsapp" | "snapchat" | "reddit" | "other";

export interface Email {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  address: string;
  type: EmailType;
  is_primary: boolean;
  created_at: string;
}

export interface Phone {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  number: string;
  country_code: string | null;
  type: PhoneType;
  is_primary: boolean;
  created_at: string;
}

export interface Address {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  type: AddressType;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface SocialProfile {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  platform: SocialPlatform;
  handle: string | null;
  url: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  description: string | null;
  created_at: string;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  logo_url: string | null;
  description: string | null;
  industry: string | null;
  size: string | null;
  founded_year: number | null;
  notes: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CompanyWithDetails extends Company {
  emails: Email[];
  phones: Phone[];
  addresses: Address[];
  social_profiles: SocialProfile[];
  tags: Tag[];
  employee_count: number;
}

export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  nickname: string | null;
  avatar_url: string | null;
  notes: string | null;
  birthday: string | null;
  company_id: string | null;
  job_title: string | null;
  source: string;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ContactWithDetails extends Contact {
  emails: Email[];
  phones: Phone[];
  addresses: Address[];
  social_profiles: SocialProfile[];
  tags: Tag[];
  company: Company | null;
}

export interface Stats {
  contacts: number;
  companies: number;
  tags: number;
}
