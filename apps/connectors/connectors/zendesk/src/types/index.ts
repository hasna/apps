// Zendesk API Types

// ============================================
// Configuration
// ============================================

export interface ZendeskConfig {
  email: string;
  apiToken: string;
  baseUrl?: string; // e.g., https://your-subdomain.zendesk.com/api/v2
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'xml';

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  hasMore: boolean;
}

// ============================================
// API Response Types
// ============================================

// Ticket Types
export interface ZendeskTicket {
  id: number;
  url: string;
  external_id?: string;
  type?: 'problem' | 'incident' | 'question' | 'task';
  subject?: string;
  raw_subject?: string;
  description?: string;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  status: 'new' | 'open' | 'pending' | 'hold' | 'solved' | 'closed';
  recipient?: string;
  requester_id?: number;
  submitter_id?: number;
  assignee_id?: number;
  organization_id?: number;
  group_id?: number;
  collaborator_ids?: number[];
  follower_ids?: number[];
  email_cc_ids?: number[];
  forum_topic_id?: number;
  problem_id?: number;
  has_incidents?: boolean;
  is_public?: boolean;
  due_at?: string;
  tags?: string[];
  custom_fields?: Array<{ id: number; value: unknown }>;
  satisfaction_rating?: {
    id: number;
    score: 'offered' | 'unoffered' | 'good' | 'bad';
    comment?: string;
  };
  sharing_agreement_ids?: number[];
  fields?: Array<{ id: number; value: unknown }>;
  followup_ids?: number[];
  ticket_form_id?: number;
  brand_id?: number;
  allow_channelback?: boolean;
  allow_attachments?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ZendeskTicketComment {
  type?: 'Comment' | 'VoiceComment';
  body: string;
  html_body?: string;
  public?: boolean;
  author_id?: number;
  attachments?: Array<{
    id: number;
    name: string;
    content_type: string;
    size: number;
    url: string;
  }>;
}

export interface CreateTicketRequest {
  ticket: {
    subject?: string;
    comment: ZendeskTicketComment;
    requester_id?: number;
    submitter_id?: number;
    assignee_id?: number;
    group_id?: number;
    collaborator_ids?: number[];
    type?: 'problem' | 'incident' | 'question' | 'task';
    priority?: 'urgent' | 'high' | 'normal' | 'low';
    status?: 'new' | 'open' | 'pending' | 'hold' | 'solved' | 'closed';
    tags?: string[];
    external_id?: string;
    custom_fields?: Array<{ id: number; value: unknown }>;
  };
}

export interface UpdateTicketRequest {
  ticket: Partial<Omit<ZendeskTicket, 'id' | 'url' | 'created_at' | 'updated_at'>> & {
    comment?: ZendeskTicketComment;
  };
}

export interface TicketListParams {
  page?: number;
  per_page?: number;
  sort_by?: 'created_at' | 'updated_at' | 'priority' | 'status' | 'ticket_type';
  sort_order?: 'asc' | 'desc';
}

// User Types
export interface ZendeskUser {
  id: number;
  url: string;
  name: string;
  email?: string;
  created_at: string;
  updated_at: string;
  time_zone?: string;
  iana_time_zone?: string;
  phone?: string;
  shared_phone_number?: string;
  photo?: {
    id: number;
    url: string;
    file_name: string;
    content_url: string;
    content_type: string;
    size: number;
  };
  locale_id?: number;
  locale?: string;
  organization_id?: number;
  role: 'end-user' | 'agent' | 'admin';
  verified?: boolean;
  external_id?: string;
  tags?: string[];
  alias?: string;
  active?: boolean;
  shared?: boolean;
  shared_agent?: boolean;
  last_login_at?: string;
  two_factor_auth_enabled?: boolean;
  signature?: string;
  details?: string;
  notes?: string;
  role_type?: number;
  custom_role_id?: number;
  moderator?: boolean;
  ticket_restriction?: 'assigned' | 'requested' | 'groups' | 'organization' | null;
  only_private_comments?: boolean;
  restricted_agent?: boolean;
  suspended?: boolean;
  default_group_id?: number;
  user_fields?: Record<string, unknown>;
}

export interface CreateUserRequest {
  user: {
    name: string;
    email?: string;
    role?: 'end-user' | 'agent' | 'admin';
    verified?: boolean;
    external_id?: string;
    alias?: string;
    phone?: string;
    time_zone?: string;
    organization_id?: number;
    tags?: string[];
    user_fields?: Record<string, unknown>;
  };
}

export interface UpdateUserRequest {
  user: Partial<Omit<ZendeskUser, 'id' | 'url' | 'created_at' | 'updated_at'>>;
}

export interface UserListParams {
  page?: number;
  per_page?: number;
  role?: 'end-user' | 'agent' | 'admin';
}

// Organization Types
export interface ZendeskOrganization {
  id: number;
  url: string;
  external_id?: string;
  name: string;
  created_at: string;
  updated_at: string;
  domain_names?: string[];
  details?: string;
  notes?: string;
  group_id?: number;
  shared_tickets?: boolean;
  shared_comments?: boolean;
  tags?: string[];
  organization_fields?: Record<string, unknown>;
}

export interface CreateOrganizationRequest {
  organization: {
    name: string;
    external_id?: string;
    domain_names?: string[];
    details?: string;
    notes?: string;
    group_id?: number;
    shared_tickets?: boolean;
    shared_comments?: boolean;
    tags?: string[];
    organization_fields?: Record<string, unknown>;
  };
}

export interface OrganizationListParams {
  page?: number;
  per_page?: number;
}

// Group Types
export interface ZendeskGroup {
  id: number;
  url: string;
  name: string;
  description?: string;
  default?: boolean;
  deleted?: boolean;
  created_at: string;
  updated_at: string;
  is_public?: boolean;
}

export interface GroupListParams {
  page?: number;
  per_page?: number;
}

// Zendesk API Response Wrappers
export interface ZendeskTicketResponse {
  ticket: ZendeskTicket;
}

export interface ZendeskTicketsResponse {
  tickets: ZendeskTicket[];
  next_page?: string;
  previous_page?: string;
  count?: number;
}

export interface ZendeskUserResponse {
  user: ZendeskUser;
}

export interface ZendeskUsersResponse {
  users: ZendeskUser[];
  next_page?: string;
  previous_page?: string;
  count?: number;
}

export interface ZendeskOrganizationResponse {
  organization: ZendeskOrganization;
}

export interface ZendeskOrganizationsResponse {
  organizations: ZendeskOrganization[];
  next_page?: string;
  previous_page?: string;
  count?: number;
}

export interface ZendeskGroupResponse {
  group: ZendeskGroup;
}

export interface ZendeskGroupsResponse {
  groups: ZendeskGroup[];
  next_page?: string;
  previous_page?: string;
  count?: number;
}

// ============================================
// API Error Types
// ============================================

export interface ZendeskError {
  code: number;
  message: string;
  field?: string;
}

export class ZendeskApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ZendeskError[];

  constructor(message: string, statusCode: number, errors?: ZendeskError[]) {
    super(message);
    this.name = 'ZendeskApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// ============================================
// Ticket Field Types
// ============================================

export interface ZendeskTicketField {
  id: number;
  url: string;
  type: 'checkbox' | 'date' | 'decimal' | 'dropdown' | 'integer' | 'regexp' | 'text' | 'textarea' | 'tagger' | 'lookup' | 'multiselect';
  title: string;
  raw_title?: string;
  description?: string;
  raw_description?: string;
  position?: number;
  active?: boolean;
  required?: boolean;
  collapsed_for_agents?: boolean;
  regexp_for_validation?: string;
  title_in_portal?: string;
  raw_title_in_portal?: string;
  visible_in_portal?: boolean;
  editable_in_portal?: boolean;
  required_in_portal?: boolean;
  tag?: string;
  created_at: string;
  updated_at: string;
  removable?: boolean;
  agent_description?: string;
  custom_field_options?: Array<{ id: number; name: string; raw_name: string; value: string; default?: boolean }>;
  system_field_options?: Array<{ name: string; value: string }>;
  sub_type_id?: number;
  custom_statuses?: Array<{ id: number; status_category: string; agent_label: string; end_user_label: string }>;
}

export interface CreateTicketFieldRequest {
  ticket_field: {
    type: ZendeskTicketField['type'];
    title: string;
    description?: string;
    position?: number;
    active?: boolean;
    required?: boolean;
    collapsed_for_agents?: boolean;
    regexp_for_validation?: string;
    title_in_portal?: string;
    visible_in_portal?: boolean;
    editable_in_portal?: boolean;
    required_in_portal?: boolean;
    tag?: string;
    custom_field_options?: Array<{ name: string; value: string }>;
  };
}

export interface UpdateTicketFieldRequest {
  ticket_field: Partial<Omit<ZendeskTicketField, 'id' | 'url' | 'created_at' | 'updated_at'>>;
}

export interface TicketFieldListParams {
  page?: number;
  per_page?: number;
}

export interface ZendeskTicketFieldResponse {
  ticket_field: ZendeskTicketField;
}

export interface ZendeskTicketFieldsResponse {
  ticket_fields: ZendeskTicketField[];
  next_page?: string;
  previous_page?: string;
  count?: number;
}

// ============================================
// View Types
// ============================================

export interface ZendeskViewCondition {
  field: string;
  operator: string;
  value: string | number | boolean | string[];
}

export interface ZendeskView {
  id: number;
  url: string;
  title: string;
  active?: boolean;
  position?: number;
  description?: string;
  created_at: string;
  updated_at: string;
  restriction?: {
    type: 'Group' | 'User';
    id?: number;
    ids?: number[];
  };
  execution?: {
    group_by?: string;
    group_order?: 'asc' | 'desc';
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    group?: { id: string; title: string; order: string };
    sort?: { id: string; title: string; order: string };
    columns?: Array<{ id: string; title: string }>;
    fields?: Array<{ id: string; title: string }>;
    custom_fields?: Array<{ id: number; title: string }>;
  };
  conditions?: {
    all?: ZendeskViewCondition[];
    any?: ZendeskViewCondition[];
  };
  output?: {
    columns?: string[];
    group_by?: string;
    group_order?: 'asc' | 'desc';
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
  };
}

export interface CreateViewRequest {
  view: {
    title: string;
    active?: boolean;
    conditions?: {
      all?: ZendeskViewCondition[];
      any?: ZendeskViewCondition[];
    };
    output?: {
      columns?: string[];
      group_by?: string;
      group_order?: 'asc' | 'desc';
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
    };
    restriction?: {
      type: 'Group' | 'User';
      id?: number;
      ids?: number[];
    };
  };
}

export interface UpdateViewRequest {
  view: Partial<Omit<ZendeskView, 'id' | 'url' | 'created_at' | 'updated_at'>>;
}

export interface ViewListParams {
  page?: number;
  per_page?: number;
  active?: boolean;
  group_id?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface ZendeskViewResponse {
  view: ZendeskView;
}

export interface ZendeskViewsResponse {
  views: ZendeskView[];
  next_page?: string;
  previous_page?: string;
  count?: number;
}

export interface ZendeskViewCountResponse {
  view_count: {
    view_id: number;
    url: string;
    value: number;
    pretty: string;
    fresh: boolean;
  };
}

export interface ZendeskViewExecuteResponse {
  rows: Array<{
    ticket: ZendeskTicket;
    group?: ZendeskGroup;
    assignee?: ZendeskUser;
    requester?: ZendeskUser;
    organization?: ZendeskOrganization;
  }>;
  columns?: Array<{ id: string; title: string }>;
  groups?: Array<{ id: string; title: string }>;
  next_page?: string;
  previous_page?: string;
  count?: number;
}

// ============================================
// Trigger Types
// ============================================

export interface ZendeskTriggerAction {
  field: string;
  value: string | string[] | number | boolean;
}

export interface ZendeskTriggerCondition {
  field: string;
  operator: string;
  value: string | string[] | number | boolean;
}

export interface ZendeskTrigger {
  id: number;
  url: string;
  title: string;
  active?: boolean;
  position?: number;
  description?: string;
  category_id?: string;
  created_at: string;
  updated_at: string;
  actions: ZendeskTriggerAction[];
  conditions?: {
    all?: ZendeskTriggerCondition[];
    any?: ZendeskTriggerCondition[];
  };
}

export interface CreateTriggerRequest {
  trigger: {
    title: string;
    active?: boolean;
    category_id?: string;
    actions: ZendeskTriggerAction[];
    conditions?: {
      all?: ZendeskTriggerCondition[];
      any?: ZendeskTriggerCondition[];
    };
  };
}

export interface UpdateTriggerRequest {
  trigger: Partial<Omit<ZendeskTrigger, 'id' | 'url' | 'created_at' | 'updated_at'>>;
}

export interface TriggerListParams {
  page?: number;
  per_page?: number;
  active?: boolean;
  category_id?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface ZendeskTriggerResponse {
  trigger: ZendeskTrigger;
}

export interface ZendeskTriggersResponse {
  triggers: ZendeskTrigger[];
  next_page?: string;
  previous_page?: string;
  count?: number;
}

// ============================================
// Automation Types
// ============================================

export interface ZendeskAutomationAction {
  field: string;
  value: string | string[] | number | boolean;
}

export interface ZendeskAutomationCondition {
  field: string;
  operator: string;
  value: string | string[] | number | boolean;
}

export interface ZendeskAutomation {
  id: number;
  url: string;
  title: string;
  active?: boolean;
  position?: number;
  description?: string;
  created_at: string;
  updated_at: string;
  actions: ZendeskAutomationAction[];
  conditions?: {
    all?: ZendeskAutomationCondition[];
    any?: ZendeskAutomationCondition[];
  };
}

export interface CreateAutomationRequest {
  automation: {
    title: string;
    active?: boolean;
    actions: ZendeskAutomationAction[];
    conditions?: {
      all?: ZendeskAutomationCondition[];
      any?: ZendeskAutomationCondition[];
    };
  };
}

export interface UpdateAutomationRequest {
  automation: Partial<Omit<ZendeskAutomation, 'id' | 'url' | 'created_at' | 'updated_at'>>;
}

export interface AutomationListParams {
  page?: number;
  per_page?: number;
  active?: boolean;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface ZendeskAutomationResponse {
  automation: ZendeskAutomation;
}

export interface ZendeskAutomationsResponse {
  automations: ZendeskAutomation[];
  next_page?: string;
  previous_page?: string;
  count?: number;
}

// ============================================
// SLA Policy Types
// ============================================

export interface ZendeskSlaPolicyMetric {
  priority: 'urgent' | 'high' | 'normal' | 'low';
  metric: 'first_reply_time' | 'next_reply_time' | 'periodic_update_time' | 'requester_wait_time' | 'agent_work_time' | 'pausable_update_time';
  target: number;
  business_hours: boolean;
}

export interface ZendeskSlaPolicy {
  id: number;
  url: string;
  title: string;
  description?: string;
  position?: number;
  filter?: {
    all?: ZendeskViewCondition[];
    any?: ZendeskViewCondition[];
  };
  policy_metrics?: ZendeskSlaPolicyMetric[];
  created_at: string;
  updated_at: string;
}

export interface CreateSlaPolicyRequest {
  sla_policy: {
    title: string;
    description?: string;
    filter?: {
      all?: ZendeskViewCondition[];
      any?: ZendeskViewCondition[];
    };
    policy_metrics?: ZendeskSlaPolicyMetric[];
  };
}

export interface UpdateSlaPolicyRequest {
  sla_policy: Partial<Omit<ZendeskSlaPolicy, 'id' | 'url' | 'created_at' | 'updated_at'>>;
}

export interface SlaListParams {
  page?: number;
  per_page?: number;
}

export interface ZendeskSlaPolicyResponse {
  sla_policy: ZendeskSlaPolicy;
}

export interface ZendeskSlaPoliciesResponse {
  sla_policies: ZendeskSlaPolicy[];
  next_page?: string;
  previous_page?: string;
  count?: number;
}

// ============================================
// Webhook Types
// ============================================

export interface ZendeskWebhook {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  endpoint: string;
  http_method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  request_format: 'json' | 'xml' | 'form_encoded';
  subscriptions?: string[];
  signing_secret?: {
    algorithm: string;
    secret: string;
  };
  authentication?: {
    type: 'none' | 'basic' | 'bearer' | 'api_key';
    data?: Record<string, string>;
    add_position?: 'header' | 'query_string';
  };
  custom_headers?: Record<string, string>;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

export interface CreateWebhookRequest {
  webhook: {
    name: string;
    status?: 'active' | 'inactive';
    endpoint: string;
    http_method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    request_format: 'json' | 'xml' | 'form_encoded';
    subscriptions?: string[];
    authentication?: {
      type: 'none' | 'basic' | 'bearer' | 'api_key';
      data?: Record<string, string>;
      add_position?: 'header' | 'query_string';
    };
    custom_headers?: Record<string, string>;
  };
}

export interface UpdateWebhookRequest {
  webhook: Partial<Omit<ZendeskWebhook, 'id' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by' | 'signing_secret'>>;
}

export interface WebhookListParams {
  page?: number;
  per_page?: number;
  filter?: string;
  sort?: string;
}

export interface WebhookInvocation {
  id: string;
  webhook_id: string;
  status: 'success' | 'failure' | 'pending';
  request: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  };
  response?: {
    status_code: number;
    headers?: Record<string, string>;
    body?: string;
  };
  created_at: string;
  completed_at?: string;
}

export interface ZendeskWebhookResponse {
  webhook: ZendeskWebhook;
}

export interface ZendeskWebhooksResponse {
  webhooks: ZendeskWebhook[];
  next_page?: string;
  previous_page?: string;
  count?: number;
}

// ============================================
// Macro Types
// ============================================

export interface ZendeskMacroAction {
  field: string;
  value: string | string[] | number | boolean;
}

export interface ZendeskMacro {
  id: number;
  url: string;
  title: string;
  active?: boolean;
  position?: number;
  description?: string;
  created_at: string;
  updated_at: string;
  actions: ZendeskMacroAction[];
  restriction?: {
    type: 'Group' | 'User';
    id?: number;
    ids?: number[];
  };
}

export interface CreateMacroRequest {
  macro: {
    title: string;
    active?: boolean;
    actions: ZendeskMacroAction[];
    restriction?: {
      type: 'Group' | 'User';
      id?: number;
      ids?: number[];
    };
  };
}

export interface UpdateMacroRequest {
  macro: Partial<Omit<ZendeskMacro, 'id' | 'url' | 'created_at' | 'updated_at'>>;
}

export interface MacroListParams {
  page?: number;
  per_page?: number;
  active?: boolean;
  category?: string;
  group_id?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface ZendeskMacroResponse {
  macro: ZendeskMacro;
}

export interface ZendeskMacrosResponse {
  macros: ZendeskMacro[];
  next_page?: string;
  previous_page?: string;
  count?: number;
}

// ============================================
// Brand Types
// ============================================

export interface ZendeskBrand {
  id: number;
  url: string;
  name: string;
  brand_url?: string;
  has_help_center?: boolean;
  help_center_state?: 'enabled' | 'disabled' | 'restricted';
  active?: boolean;
  default?: boolean;
  is_deleted?: boolean;
  logo?: {
    id: number;
    url: string;
    file_name: string;
    content_url: string;
    content_type: string;
    size: number;
  };
  ticket_form_ids?: number[];
  subdomain: string;
  host_mapping?: string;
  signature_template?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateBrandRequest {
  brand: {
    name: string;
    subdomain: string;
    brand_url?: string;
    has_help_center?: boolean;
    help_center_state?: 'enabled' | 'disabled' | 'restricted';
    active?: boolean;
    host_mapping?: string;
    signature_template?: string;
  };
}

export interface UpdateBrandRequest {
  brand: Partial<Omit<ZendeskBrand, 'id' | 'url' | 'created_at' | 'updated_at'>>;
}

export interface BrandListParams {
  page?: number;
  per_page?: number;
}

export interface ZendeskBrandResponse {
  brand: ZendeskBrand;
}

export interface ZendeskBrandsResponse {
  brands: ZendeskBrand[];
  next_page?: string;
  previous_page?: string;
  count?: number;
}
