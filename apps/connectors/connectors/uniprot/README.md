# @hasna/connect-uniprot

UniProt protein and proteome search connector for the open-connectors monorepo.

## Features

- Search UniProtKB proteins by query
- Get protein entries by accession
- Search proteomes
- JSON and pretty CLI output

## Installation

```bash
bun install
bun run build
```

## CLI Usage

```bash
# Search proteins
bun run dev search-proteins "insulin"
bun run dev search-proteins "gene:INS AND organism_id:9606" -n 5

# Get protein by accession
bun run dev get-protein P01308

# Search proteomes
bun run dev search-proteomes "human"

# JSON output
bun run dev search-proteins insulin -f json

# Configuration
bun run dev config show
bun run dev config set-size 50
```

## Library Usage

```typescript
import { UniProt } from '@hasna/connect-uniprot';

const uniprot = new UniProt();
const results = await uniprot.searchProteins({ query: 'insulin', size: 10 });
const protein = await uniprot.getProtein('P01308');
const proteomes = await uniprot.searchProteomes({ query: 'human' });
```

## API

Uses the public [UniProt REST API](https://www.uniprot.org/help/api) at `https://rest.uniprot.org`. No authentication required.

## License

Apache-2.0
