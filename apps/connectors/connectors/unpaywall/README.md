# @hasna/connect-unpaywall

TypeScript connector for the [Unpaywall](https://unpaywall.org/) REST API — open-access DOI lookup and title search.

## Install

```bash
bun install
```

## Configuration

Unpaywall requires your email as an API query parameter (free, 100k calls/day):

```bash
export UNPAYWALL_EMAIL=your_email@example.com
# or
connect-unpaywall config set-email your_email@example.com
```

## Usage

```bash
# Look up a DOI
connect-unpaywall get 10.1038/nature12373

# Search by title
connect-unpaywall search "cell thermometry" --oa true --page 1

# JSON output
connect-unpaywall get 10.1038/nature12373 -f json
```

## API

```typescript
import { Unpaywall } from '@hasna/connect-unpaywall';

const unpaywall = new Unpaywall('your_email@example.com');
const doi = await unpaywall.getDoi('10.1038/nature12373');
const results = await unpaywall.search('cell thermometry', { isOa: true, page: 1 });
```

## License

Apache-2.0
