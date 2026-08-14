# @hasna/connect-zoominfo

TypeScript and CLI connector for the ZoomInfo B2B sales intelligence API.

## Install

```bash
bun add @hasna/connect-zoominfo
```

## Configure

```bash
export ZOOMINFO_USERNAME=your_zoominfo_username
export ZOOMINFO_PASSWORD=your_zoominfo_password
export ZOOMINFO_JWT=your_zoominfo_jwt
export ZOOMINFO_BASE_URL=https://api.zoominfo.com
```

The CLI can also store local configuration:

```bash
connect-zoominfo config set-username your_zoominfo_username
connect-zoominfo config set-password your_zoominfo_password
connect-zoominfo config set-jwt your_zoominfo_jwt
connect-zoominfo config show
```

## CLI Examples

```bash
connect-zoominfo authenticate
connect-zoominfo search-contacts --body '{"jobTitle":["VP of Sales"],"rpp":25,"page":1}'
connect-zoominfo search-companies --body '{"companyName":"Example Corp"}'
connect-zoominfo enrich-contact --body '{"matchPersonInput":[{"emailAddress":"person@example.com"}],"outputFields":["email","jobTitle"]}'
connect-zoominfo enrich-company --body '{"matchCompanyInput":[{"companyName":"Example Corp"}]}'
connect-zoominfo lookup-contact 123456789
connect-zoominfo contact-search-output-fields
connect-zoominfo raw-request POST /search/contact --body '{"jobTitle":["CTO"]}'
```

## TypeScript

```ts
import { ZoomInfo } from "@hasna/connect-zoominfo";

const zoominfo = new ZoomInfo({
  username: process.env.ZOOMINFO_USERNAME,
  password: process.env.ZOOMINFO_PASSWORD,
});

await zoominfo.authenticate();
const contacts = await zoominfo.searchContacts({ jobTitle: ["VP of Sales"], rpp: 25, page: 1 });
const enriched = await zoominfo.enrichContact({
  matchPersonInput: [{ emailAddress: "person@example.com" }],
  outputFields: ["email", "jobTitle"],
});
```

## API Coverage

- Username/password authentication (`POST /authenticate`) with JWT caching per client instance
- Contact and company search
- Contact and company enrichment
- Contact lookup by ID
- Search output field discovery
- Relative raw requests

JWT tokens are valid for approximately 60 minutes. Long-running processes may need to re-authenticate or provide a fresh `ZOOMINFO_JWT`.
