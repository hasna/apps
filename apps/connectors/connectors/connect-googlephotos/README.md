# connect-googlephotos

A TypeScript CLI and library for the Google Photos Library API with OAuth2 authentication and multi-profile support.

## Installation

```bash
# Global install
bun install -g @hasna/connect-googlephotos

# Or use with bunx
bunx @hasna/connect-googlephotos
```

## Quick Start

### 1. Get Google Cloud Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project or select an existing one
3. Enable the **Photos Library API**
4. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
5. Select **Desktop app** as the application type
6. Download the credentials

### 2. Configure the CLI

```bash
# Set your OAuth credentials
connect-googlephotos config set-credentials <client-id> <client-secret>

# Login (opens browser)
connect-googlephotos auth login
```

### 3. Use the CLI

```bash
# List your albums
connect-googlephotos albums list

# List recent photos
connect-googlephotos media list

# Search for selfies
connect-googlephotos media search --category SELFIES

# Download a photo
connect-googlephotos media download <media-id> -o photo.jpg

# Upload a photo
connect-googlephotos upload file photo.jpg

# Upload a directory
connect-googlephotos upload dir ./vacation-photos --album <album-id>
```

## Multi-Profile Support

Manage multiple Google accounts:

```bash
# List all profiles
connect-googlephotos profiles list

# Show profile details
connect-googlephotos profiles show

# Switch to a different profile
connect-googlephotos profiles switch myprofile

# Use a specific profile for one command
connect-googlephotos -p work albums list
```

## Commands

### Authentication

| Command | Description |
|---------|-------------|
| `auth login` | Login via OAuth2 (opens browser) |
| `auth status` | Check authentication status |
| `auth logout` | Clear stored tokens |

### Configuration

| Command | Description |
|---------|-------------|
| `config set-credentials <id> <secret>` | Set OAuth credentials |
| `config show` | Show current configuration |
| `config clear` | Clear all configuration |

### Albums

| Command | Description |
|---------|-------------|
| `albums list` | List all albums |
| `albums get <id>` | Get album details |
| `albums create <title>` | Create a new album |
| `albums share <id>` | Share an album |
| `albums unshare <id>` | Unshare an album |
| `albums contents <id>` | List items in an album |

### Media

| Command | Description |
|---------|-------------|
| `media list` | List media items |
| `media get <id>` | Get media item details |
| `media search` | Search with filters |
| `media download <id>` | Download a media item |
| `media url <id>` | Get download URL |

### Upload

| Command | Description |
|---------|-------------|
| `upload file <path>` | Upload a single file |
| `upload dir <path>` | Upload all files from directory |
| `upload supported` | List supported file types |

## Programmatic Usage

```typescript
import { GooglePhotos } from '@hasna/connect-googlephotos';

const photos = GooglePhotos.create();

// List albums
const albums = await photos.albums.listAll();
console.log(`Found ${albums.length} albums`);

// Get media items in an album
const items = await photos.media.getInAlbum(albums[0].id);

// Search for photos by category
const selfies = await photos.media.searchByCategory(['SELFIES']);

// Search favorites
const favorites = await photos.media.getFavorites();

// Upload a photo
const uploaded = await photos.upload.uploadAndCreate('./photo.jpg', {
  description: 'My vacation photo',
  albumId: 'album-id',
});

// Download a photo
const buffer = await photos.media.download(items[0]);
```

## Configuration Storage

Configuration is stored in `~/.connect/connect-googlephotos/`:

```
~/.connect/connect-googlephotos/
├── credentials.json          # OAuth client credentials (shared)
├── current_profile           # Current active profile
└── profiles/
    ├── default/
    │   ├── config.json       # Profile config
    │   └── tokens.json       # OAuth tokens
    └── work/
        ├── config.json
        └── tokens.json
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_PHOTOS_CLIENT_ID` | OAuth client ID |
| `GOOGLE_PHOTOS_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_PHOTOS_ACCESS_TOKEN` | Access token (optional override) |
| `GOOGLE_PHOTOS_REFRESH_TOKEN` | Refresh token (optional override) |

## Supported File Types

**Images:** JPG, JPEG, PNG, GIF, WebP, HEIC, HEIF, BMP, TIFF, RAW, ICO

**Videos:** MP4, MOV, AVI, MKV, WebM, M4V, 3GP, MPG, MPEG, WMV

## API Limitations

- Can only edit/delete media items created by this app
- Maximum photo size: 75 MB
- Maximum video size: 10 GB
- API rate limits apply

## License

Apache-2.0
