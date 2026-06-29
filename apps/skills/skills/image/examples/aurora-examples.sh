#!/bin/bash

# xAI Aurora Examples

# Creative interpretation
bun run ../src/index.ts generate \
  --provider xai \
  --prompt "the concept of time as abstract art" \
  --output ./aurora-time.png

# Sci-fi scene
bun run ../src/index.ts generate \
  --provider xai \
  --prompt "a robot sitting on a park bench reading a newspaper in a cyberpunk city" \
  --output ./aurora-robot.png

# Fantasy landscape
bun run ../src/index.ts generate \
  --provider xai \
  --prompt "a floating island with a castle and waterfalls, surrounded by clouds" \
  --output ./aurora-floating-island.png

# Surreal art
bun run ../src/index.ts generate \
  --provider xai \
  --prompt "a door opening into different seasons simultaneously" \
  --output ./aurora-surreal-door.png

# Character design
bun run ../src/index.ts generate \
  --provider xai \
  --prompt "a friendly dragon character design, colorful scales, cartoon style" \
  --output ./aurora-dragon.png
