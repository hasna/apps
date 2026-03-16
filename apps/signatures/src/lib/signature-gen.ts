import { writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { nanoid } from "nanoid";
import { getSignatureImagesDir } from "./files.js";

export interface TextSignatureResult {
  svg_path: string;
  width: number;
  height: number;
}

export interface DrawingSignatureResult {
  image_path: string;
  width: number;
  height: number;
}

/**
 * Generate a text signature as SVG using a Google Fonts font.
 * Embeds a CSS @import for the font so it renders correctly.
 */
export async function generateTextSignature(
  text: string,
  fontFamily: string = "Dancing Script",
  fontSize: number = 48,
  color: string = "#000000"
): Promise<TextSignatureResult> {
  const width = Math.max(200, text.length * fontSize * 0.6);
  const height = fontSize * 2;

  // URL-encode font family for Google Fonts API
  const fontParam = fontFamily.replace(/ /g, "+");
  const fontUrl = `https://fonts.googleapis.com/css2?family=${fontParam}&display=swap`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      @import url('${fontUrl}');
    </style>
  </defs>
  <rect width="100%" height="100%" fill="transparent"/>
  <text
    x="${width / 2}"
    y="${height * 0.7}"
    font-family="'${fontFamily}', cursive"
    font-size="${fontSize}"
    fill="${color}"
    text-anchor="middle"
    dominant-baseline="middle"
  >${escapeXml(text)}</text>
</svg>`;

  const dir = getSignatureImagesDir();
  mkdirSync(dir, { recursive: true });
  const filename = `sig-text-${nanoid(8)}.svg`;
  const filePath = join(dir, filename);
  writeFileSync(filePath, svg, "utf-8");

  return {
    svg_path: filePath,
    width,
    height,
  };
}

/**
 * Generate a signature image using OpenAI's image generation API.
 * Requires OPENAI_API_KEY environment variable.
 */
export async function generateDrawingSignature(
  description: string
): Promise<DrawingSignatureResult> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY environment variable is required for drawing signature generation"
    );
  }

  const prompt = `A handwritten signature that looks exactly like: ${description}. Clean white background, black ink, realistic handwriting style, simple elegant cursive signature, no decorations, just the signature, isolated on white`;

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "b64_json",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${error}`);
  }

  const data = (await response.json()) as {
    data: Array<{ b64_json: string }>;
  };

  const b64 = data.data[0]?.b64_json;
  if (!b64) {
    throw new Error("No image data returned from OpenAI");
  }

  const imageBuffer = Buffer.from(b64, "base64");
  const dir = getSignatureImagesDir();
  mkdirSync(dir, { recursive: true });
  const filename = `sig-drawing-${nanoid(8)}.png`;
  const filePath = join(dir, filename);
  writeFileSync(filePath, imageBuffer);

  return {
    image_path: filePath,
    width: 1024,
    height: 1024,
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
