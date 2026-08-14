# Google Photos Connector

A TypeScript CLI tool and library for interacting with the Google Photos Library API.

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev <command>

# Build for production
bun run build

# Type check
bun run typecheck
```

## Setup

1. Create a Google Cloud project and enable the Photos Library API
2. Create OAuth 2.0 credentials (Desktop app type)
3. Configure credentials:
   ```bash
   connect-googlephotos config set-credentials <client-id> <client-secret>
   ```
4. Login:
   ```bash
   connect-googlephotos auth login
   ```

## Multi-Profile Support

The connector supports multiple Google accounts via profiles:

```bash
# List profiles
connect-googlephotos profiles list

# Switch profile
connect-googlephotos profiles switch <name>

# Use profile for single command
connect-googlephotos -p <profile> media list
```

Profiles are stored in `~/.hasna/connectors/connect-googlephotos/profiles/`.

## Commands

### Authentication
- `auth login` - Login via OAuth2
- `auth status` - Check auth status
- `auth logout` - Clear tokens

### Configuration
- `config set-credentials <id> <secret>` - Set OAuth credentials
- `config show` - Show current config
- `config clear` - Clear all config

### Albums
- `albums list` - List all albums
- `albums get <id>` - Get album details
- `albums create <title>` - Create new album
- `albums share <id>` - Share an album
- `albums contents <id>` - List items in album

### Media
- `media list` - List media items
- `media get <id>` - Get item details
- `media search` - Search with filters
- `media download <id>` - Download item
- `media url <id>` - Get download URL

### Upload
- `upload file <path>` - Upload single file
- `upload dir <path>` - Upload directory
- `upload supported` - List supported file types

## API Usage

```typescript
import { GooglePhotos } from '@hasna/connect-googlephotos';

const photos = GooglePhotos.create();

// List albums
const albums = await photos.albums.listAll();

// Get media items
const items = await photos.media.list();

// Upload a file
const item = await photos.upload.uploadAndCreate('./photo.jpg');

// Search favorites
const favorites = await photos.media.getFavorites();
```

## Google Photos API Limitations

- Can only edit/delete items created by this app
- Upload quota: 75MB photos, 10GB videos
- API rate limits apply
- Some features require specific scopes
