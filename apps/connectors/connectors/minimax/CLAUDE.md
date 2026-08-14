# connect-minimax

Minimax API connector for video, music, image, TTS, and sound effects generation.

## API Modules

- `VideoApi` — Text-to-video (T2V-01) and image-to-video (I2V-01) generation with async polling
- `MusicApi` — AI music generation (music-01) with lyrics, genre, mood, tempo control
- `TTSApi` — Text-to-speech (speech-02-hd) with voice selection, speed, emotion
- `ImageApi` — Image generation (image-01) with aspect ratio control
- `SoundEffectsApi` — Sound effect generation from text prompts

## Usage

```typescript
import { Minimax } from '@hasna/connect-minimax';

const client = Minimax.fromEnv(); // uses MINIMAX_API_KEY

// Generate video
const video = await client.video.generateAndWait('A cat playing piano');

// Generate music
const music = await client.music.generateAndWait('Upbeat jazz track');

// Generate speech
const audioBuffer = await client.tts.generateToBuffer('Hello world');

// Generate image
const image = await client.image.generateAndWait('A sunset over mountains');

// Generate sound effect
const sfx = await client.soundEffects.generateAndWait('Thunder rolling');
```

## Environment Variables

- `MINIMAX_API_KEY` — API key (required)
- `MINIMAX_GROUP_ID` — Group ID (optional, some endpoints)

## Development

```bash
bun run dev          # Run CLI
bun run build        # Build dist + bin
bun run typecheck    # Type check
```
