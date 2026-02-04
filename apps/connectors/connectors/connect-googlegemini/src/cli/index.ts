#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Gemini } from '../api';
import {
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  clearConfig,
  getApiKey,
  setApiKey,
  setBaseUrl,
  hasApiKey,
} from '../utils/config';
import {
  output,
  setOutputFormat,
  success,
  error,
  info,
  table,
  type OutputFormat,
} from '../utils/output';
import type { GeminiModel, VeoModel, VoiceName, EmbeddingTaskType, ImageConfig } from '../types';

const CONNECTOR_NAME = 'connect-googlegemini';

// Create program
const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Google Gemini API connector CLI - Text, image, video generation')
  .version('0.0.1')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();
    if (options.format) {
      setOutputFormat(options.format as OutputFormat);
    }
  });

// Helper to get client
function getClient(options: { profile?: string; apiKey?: string }): Gemini {
  let apiKey = options.apiKey;

  if (!apiKey && options.profile) {
    const config = loadProfile(options.profile);
    apiKey = config.apiKey;
  }

  if (!apiKey) {
    apiKey = getApiKey();
  }

  if (!apiKey) {
    throw new Error('API key not configured. Run: connect-googlegemini config set api-key <key>');
  }

  return new Gemini({ apiKey });
}

// ============ Profile Commands ============
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();
    if (profiles.length === 0) {
      info('No profiles found. Create one with: connect-googlegemini profile create <name>');
      return;
    }
    console.log(chalk.bold('\nProfiles:'));
    for (const p of profiles) {
      const marker = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${marker}`);
    }
    console.log();
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    try {
      setCurrentProfile(name);
      success(`Switched to profile: ${name}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, options: { use?: boolean }) => {
    try {
      createProfile(name);
      success(`Created profile: ${name}`);
      if (options.use) {
        setCurrentProfile(name);
        success(`Switched to profile: ${name}`);
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    try {
      deleteProfile(name);
      success(`Deleted profile: ${name}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Config Commands ============
const configCmd = program.command('config').description('Manage configuration');

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value (api-key, base-url)')
  .action((key: string, value: string) => {
    try {
      switch (key) {
        case 'api-key':
          setApiKey(value);
          success('API key set');
          break;
        case 'base-url':
          setBaseUrl(value);
          success('Base URL set');
          break;
        default:
          error(`Unknown config key: ${key}`);
          process.exit(1);
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const config = loadProfile();
    console.log(chalk.bold('\nCurrent Configuration'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Profile: ${profile}`);
    console.log(`  API Key: ${config.apiKey ? config.apiKey.slice(0, 10) + '...' : chalk.red('not set')}`);
    console.log(`  Base URL: ${config.baseUrl || chalk.gray('default')}`);
    console.log();
  });

configCmd
  .command('clear')
  .description('Clear all configuration for current profile')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ============ Generate Commands ============
const generateCmd = program.command('generate').alias('gen').description('Text generation');

generateCmd
  .command('text <prompt>')
  .description('Generate text from prompt')
  .option('-m, --model <model>', 'Model to use', 'gemini-2.5-flash')
  .option('-t, --temperature <temp>', 'Temperature (0-2)', '1')
  .option('--max-tokens <tokens>', 'Maximum output tokens')
  .option('-s, --system <instruction>', 'System instruction')
  .option('--stream', 'Stream output')
  .action(async (prompt: string, options) => {
    try {
      const client = getClient(program.opts());

      if (options.stream) {
        process.stdout.write('\n');
        for await (const chunk of client.generate.streamGenerateContent(
          options.model as GeminiModel,
          prompt,
          {
            generationConfig: {
              temperature: parseFloat(options.temperature),
              maxOutputTokens: options.maxTokens ? parseInt(options.maxTokens) : undefined,
            },
            systemInstruction: options.system,
          }
        )) {
          process.stdout.write(chunk);
        }
        process.stdout.write('\n\n');
      } else {
        const result = await client.generate.text(prompt, {
          model: options.model as GeminiModel,
          temperature: parseFloat(options.temperature),
          maxTokens: options.maxTokens ? parseInt(options.maxTokens) : undefined,
          systemInstruction: options.system,
        });
        console.log('\n' + result + '\n');
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

generateCmd
  .command('json <prompt>')
  .description('Generate structured JSON from prompt')
  .option('-m, --model <model>', 'Model to use', 'gemini-2.5-flash')
  .option('-t, --temperature <temp>', 'Temperature (0-2)', '1')
  .option('-s, --system <instruction>', 'System instruction')
  .action(async (prompt: string, options) => {
    try {
      const client = getClient(program.opts());
      const result = await client.generate.json(prompt, {
        model: options.model as GeminiModel,
        temperature: parseFloat(options.temperature),
        systemInstruction: options.system,
      });
      output(result);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

generateCmd
  .command('tokens <text>')
  .description('Count tokens in text')
  .option('-m, --model <model>', 'Model to use', 'gemini-2.5-flash')
  .action(async (text: string, options) => {
    try {
      const client = getClient(program.opts());
      const result = await client.generate.countTokens(options.model as GeminiModel, text);
      console.log(`\nTotal tokens: ${chalk.yellow(result.totalTokens)}\n`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Image Commands ============
const imageCmd = program.command('image').alias('img').description('Image generation (Nano Banana)');

imageCmd
  .command('generate <prompt>')
  .alias('gen')
  .description('Generate image from text prompt')
  .option('-m, --model <model>', 'Model to use', 'gemini-2.5-flash-preview-image-generation')
  .option('-a, --aspect-ratio <ratio>', 'Aspect ratio (16:9, 9:16, 1:1, etc.)', '16:9')
  .option('-s, --size <size>', 'Image size (1K, 2K, 4K)', '2K')
  .option('-o, --output <path>', 'Output file path')
  .option('-n, --number <count>', 'Number of images', '1')
  .action(async (prompt: string, options) => {
    try {
      const client = getClient(program.opts());

      info(`Generating image with ${options.model}...`);

      if (options.output) {
        const fs = await import('fs');
        const path = await import('path');
        const outputDir = path.dirname(options.output);
        const outputName = path.basename(options.output, path.extname(options.output));

        const paths = await client.images.generateToFiles(prompt, outputDir, {
          model: options.model,
          aspectRatio: options.aspectRatio as ImageConfig['aspectRatio'],
          imageSize: options.imageSize as ImageConfig['imageSize'],
          numberOfImages: parseInt(options.number),
          filenamePrefix: outputName,
        });

        success(`Saved ${paths.length} image(s):`);
        paths.forEach((p) => console.log(`  ${p}`));
      } else {
        const images = await client.images.generate(prompt, {
          model: options.model,
          aspectRatio: options.aspectRatio as ImageConfig['aspectRatio'],
          imageSize: options.size as ImageConfig['imageSize'],
          numberOfImages: parseInt(options.number),
        });

        success(`Generated ${images.length} image(s)`);
        images.forEach((img, i) => {
          console.log(`\n${chalk.cyan(`Image ${i + 1}:`)} ${img.mimeType}`);
          console.log(`  Data: ${img.data.slice(0, 50)}... (${img.data.length} chars base64)`);
        });
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

imageCmd
  .command('edit <image> <instruction>')
  .description('Edit an existing image')
  .option('-m, --model <model>', 'Model to use', 'gemini-2.5-flash-preview-image-generation')
  .option('-o, --output <path>', 'Output file path')
  .action(async (imagePath: string, instruction: string, options) => {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const client = getClient(program.opts());

      // Read image
      const imageContent = fs.readFileSync(imagePath);
      const base64 = imageContent.toString('base64');
      const ext = path.extname(imagePath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

      info('Editing image...');
      const images = await client.images.edit(base64, mimeType, instruction, {
        model: options.model,
      });

      if (options.output && images.length > 0) {
        const imgExt = images[0].mimeType === 'image/png' ? '.png' : '.jpg';
        const outputPath = options.output.endsWith(imgExt) ? options.output : options.output + imgExt;
        const buffer = Buffer.from(images[0].data, 'base64');
        fs.writeFileSync(outputPath, buffer);
        success(`Saved edited image to: ${outputPath}`);
      } else {
        success(`Generated ${images.length} edited image(s)`);
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

imageCmd
  .command('describe <image>')
  .description('Describe an image')
  .option('-m, --model <model>', 'Model to use', 'gemini-2.5-flash')
  .option('--prompt <prompt>', 'Custom prompt', 'Describe this image in detail.')
  .action(async (imagePath: string, options) => {
    try {
      const client = getClient(program.opts());
      info('Analyzing image...');
      const description = await client.images.analyzeFile(imagePath, options.prompt, options.model);
      console.log('\n' + description + '\n');
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Video Commands ============
const videoCmd = program.command('video').alias('vid').description('Video generation (Veo)');

videoCmd
  .command('generate <prompt>')
  .alias('gen')
  .description('Generate video from text prompt')
  .option('-m, --model <model>', 'Model to use', 'veo-3.1-generate-preview')
  .option('-a, --aspect-ratio <ratio>', 'Aspect ratio (16:9, 9:16)', '16:9')
  .option('-r, --resolution <res>', 'Resolution (720p, 1080p, 4k)', '720p')
  .option('-d, --duration <seconds>', 'Duration (4, 6, 8)', '8')
  .option('-o, --output <path>', 'Output file path')
  .option('--no-audio', 'Disable audio generation')
  .option('--no-wait', 'Do not wait for completion')
  .action(async (prompt: string, options) => {
    try {
      const client = getClient(program.opts());

      info(`Generating video with ${options.model}...`);
      info('This may take several minutes...');

      const operation = await client.video.generate(prompt, {
        model: options.model as VeoModel,
        aspectRatio: options.aspectRatio,
        resolution: options.resolution,
        durationSeconds: parseInt(options.duration) as 4 | 6 | 8,
        generateAudio: options.audio !== false,
      });

      console.log(`Operation: ${operation.name}`);

      if (options.wait !== false) {
        info('Waiting for video generation to complete...');
        const completed = await client.video.waitForCompletion(operation.name);

        if (options.output && completed.response?.generatedVideos?.[0]) {
          const fs = await import('fs');
          const video = completed.response.generatedVideos[0];

          if (video.video.bytesBase64Encoded) {
            const buffer = Buffer.from(video.video.bytesBase64Encoded, 'base64');
            fs.writeFileSync(options.output, buffer);
            success(`Saved video to: ${options.output}`);
          } else if (video.video.gcsUri) {
            info(`Video available at: ${video.video.gcsUri}`);
          }
        } else {
          success('Video generation complete');
          output(completed.response);
        }
      } else {
        info('Video generation started. Check status with:');
        console.log(`  connect-googlegemini video status ${operation.name}`);
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

videoCmd
  .command('status <operation>')
  .description('Check video generation status')
  .action(async (operationName: string) => {
    try {
      const client = getClient(program.opts());
      const operation = await client.video.getOperation(operationName);
      output(operation, { title: 'Video Generation Status' });
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

videoCmd
  .command('models')
  .description('List available Veo models')
  .action(() => {
    const models = [
      { id: 'veo-3.1-generate-preview', description: 'Latest Veo model with audio' },
      { id: 'veo-3.1-fast-generate-preview', description: 'Faster Veo 3.1 variant' },
      { id: 'veo-2.0-generate-001', description: 'Stable Veo 2 model' },
    ];
    table(
      ['Model ID', 'Description'],
      models.map((m) => [m.id, m.description])
    );
  });

// ============ Speech Commands ============
const speechCmd = program.command('speech').alias('tts').description('Text-to-speech generation');

speechCmd
  .command('generate <text>')
  .alias('gen')
  .description('Generate speech from text')
  .option('-m, --model <model>', 'Model to use', 'gemini-2.5-flash-preview-tts')
  .option('-v, --voice <voice>', 'Voice name', 'Kore')
  .option('-o, --output <path>', 'Output WAV file path')
  .action(async (text: string, options) => {
    try {
      const client = getClient(program.opts());

      info(`Generating speech with voice: ${options.voice}`);

      if (options.output) {
        await client.speech.generateToFile(text, options.output, {
          model: options.model,
          voice: options.voice as VoiceName,
        });
        success(`Saved audio to: ${options.output}`);
      } else {
        const audio = await client.speech.generate(text, {
          model: options.model,
          voice: options.voice as VoiceName,
        });
        success('Generated audio');
        console.log(`  MIME Type: ${audio.mimeType}`);
        console.log(`  Sample Rate: ${audio.sampleRate} Hz`);
        console.log(`  Data: ${audio.data.slice(0, 50)}... (${audio.data.length} chars base64)`);
        info('Use -o flag to save to a WAV file');
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

speechCmd
  .command('voices')
  .description('List available voices')
  .action(() => {
    const client = new Gemini({ apiKey: 'dummy' }); // Just to access static voices
    const voices = client.speech.getVoices();
    console.log(chalk.bold('\nAvailable Voices:'));
    console.log(chalk.gray('─'.repeat(40)));
    voices.forEach((v) => console.log(`  ${v}`));
    console.log();
  });

// ============ Embedding Commands ============
const embedCmd = program.command('embed').description('Generate embeddings');

embedCmd
  .command('text <text>')
  .description('Generate embedding for text')
  .option('-t, --task <type>', 'Task type (SEMANTIC_SIMILARITY, RETRIEVAL_QUERY, etc.)')
  .option('-d, --dimensions <dims>', 'Output dimensions (768, 1536, 3072)')
  .action(async (text: string, options) => {
    try {
      const client = getClient(program.opts());
      const embedding = await client.embeddings.embed(text, {
        taskType: options.task as EmbeddingTaskType,
        outputDimensionality: options.dimensions ? parseInt(options.dimensions) : undefined,
      });
      console.log(chalk.bold(`\nEmbedding (${embedding.length} dimensions):`));
      console.log(`  [${embedding.slice(0, 5).map((v) => v.toFixed(4)).join(', ')}, ...]\n`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

embedCmd
  .command('similarity <text1> <text2>')
  .description('Calculate similarity between two texts')
  .action(async (text1: string, text2: string) => {
    try {
      const client = getClient(program.opts());
      const [emb1, emb2] = await client.embeddings.batchEmbed([text1, text2], {
        taskType: 'SEMANTIC_SIMILARITY',
      });
      const similarity = client.embeddings.cosineSimilarity(emb1, emb2);
      console.log(`\nCosine Similarity: ${chalk.yellow(similarity.toFixed(4))}\n`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Files Commands ============
const filesCmd = program.command('files').description('Manage uploaded files');

filesCmd
  .command('list')
  .description('List uploaded files')
  .action(async () => {
    try {
      const client = getClient(program.opts());
      const result = await client.files.list();
      if (!result.files || result.files.length === 0) {
        info('No files found');
        return;
      }
      table(
        ['Name', 'Display Name', 'MIME Type', 'State', 'Size'],
        result.files.map((f) => [
          f.name,
          f.displayName,
          f.mimeType,
          f.state,
          f.sizeBytes,
        ])
      );
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

filesCmd
  .command('upload <path>')
  .description('Upload a file')
  .option('-n, --name <name>', 'Display name for the file')
  .action(async (filePath: string, options) => {
    try {
      const client = getClient(program.opts());
      info(`Uploading ${filePath}...`);
      const file = await client.files.upload(filePath, {
        displayName: options.name,
      });
      success(`Uploaded: ${file.name}`);
      output(file);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

filesCmd
  .command('delete <name>')
  .description('Delete a file')
  .action(async (name: string) => {
    try {
      const client = getClient(program.opts());
      await client.files.delete(name);
      success(`Deleted: ${name}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Models Commands ============
const modelsCmd = program.command('models').description('List available models');

modelsCmd
  .command('list')
  .description('List all available models')
  .option('--category <cat>', 'Filter by category (text, image, video, tts, embedding)')
  .action(async (options) => {
    try {
      const client = getClient(program.opts());
      const allModels = client.models.getAllModels();

      if (options.category) {
        const models = allModels[options.category as keyof typeof allModels];
        if (!models) {
          error(`Unknown category: ${options.category}`);
          process.exit(1);
        }
        console.log(chalk.bold(`\n${options.category.charAt(0).toUpperCase() + options.category.slice(1)} Models:`));
        models.forEach((m) => console.log(`  ${m}`));
        console.log();
      } else {
        console.log(chalk.bold('\nText Generation Models:'));
        allModels.text.forEach((m) => console.log(`  ${m}`));

        console.log(chalk.bold('\nImage Generation Models (Nano Banana):'));
        allModels.image.forEach((m) => console.log(`  ${m}`));

        console.log(chalk.bold('\nVideo Generation Models (Veo):'));
        allModels.video.forEach((m) => console.log(`  ${m}`));

        console.log(chalk.bold('\nText-to-Speech Models:'));
        allModels.tts.forEach((m) => console.log(`  ${m}`));

        console.log(chalk.bold('\nEmbedding Models:'));
        allModels.embedding.forEach((m) => console.log(`  ${m}`));
        console.log();
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

modelsCmd
  .command('info <model>')
  .description('Get model information')
  .action(async (modelName: string) => {
    try {
      const client = getClient(program.opts());
      const modelInfo = await client.models.get(modelName);
      output(modelInfo, { title: 'Model Info' });
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Quick Commands ============
program
  .command('ask <prompt>')
  .description('Quick text generation')
  .option('-m, --model <model>', 'Model to use', 'gemini-2.5-flash')
  .option('--stream', 'Stream output')
  .action(async (prompt: string, options) => {
    try {
      const client = getClient(program.opts());

      if (options.stream) {
        for await (const chunk of client.generate.streamGenerateContent(
          options.model as GeminiModel,
          prompt
        )) {
          process.stdout.write(chunk);
        }
        process.stdout.write('\n');
      } else {
        const result = await client.text(prompt, { model: options.model });
        console.log(result);
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// Parse and run
program.parse();
