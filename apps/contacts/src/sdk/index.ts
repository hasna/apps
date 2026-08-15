/**
 * @hasna/contacts SDK — typed `/v1` cloud client.
 *
 * Generated from the serve OpenAPI document (src/server/openapi.ts).
 * Regenerate with `bun run scripts/generate-sdk.ts`.
 *
 *   import { ContactsV1Client } from "@hasna/contacts/sdk";
 *   const client = new ContactsV1Client({
 *     baseUrl: process.env.CONTACTS_API_URL!,   // self_hosted service URL
 *     apiKey: process.env.CONTACTS_API_KEY!,     // contracts-issued key
 *   });
 *   const { contacts } = await client.listContacts({ limit: 20 });
 */
export { ContactsV1Client, ApiError as ContactsV1ApiError } from "./v1.generated.js";
export type {
  ContactsV1ClientOptions,
  Contact as ContactsV1Contact,
  Company as ContactsV1Company,
  Tag as ContactsV1Tag,
  CreateContactInput as ContactsV1CreateContactInput,
  UpdateContactInput as ContactsV1UpdateContactInput,
  CreateCompanyInput as ContactsV1CreateCompanyInput,
  UpdateCompanyInput as ContactsV1UpdateCompanyInput,
  CreateTagInput as ContactsV1CreateTagInput,
  UpdateTagInput as ContactsV1UpdateTagInput,
  ProjectIdsInput as ContactsV1ProjectIdsInput,
  ContactProjectMembershipSnapshot as ContactsV1ProjectMembershipSnapshot,
  ContactProjectMembershipMutationInput as ContactsV1ProjectMembershipMutationInput,
  ContactProjectMembershipMutationResult as ContactsV1ProjectMembershipMutationResult,
  ContactProjectMembershipListResult as ContactsV1ProjectMembershipListResult,
} from "./v1.generated.js";
