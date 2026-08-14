# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-adobe is a TypeScript connector for the Adobe PDF Services API. It provides PDF compression, export, creation, combining, splitting, OCR, protection, extraction, watermarking, linearization, and document merge through a clean CLI and programmatic interface.

## API Reference

- **Base URL (US)**: `https://pdf-services.adobe.io`
- **Base URL (EU)**: `https://pdf-services-eu.adobe.io`
- **Auth**: OAuth2 Client Credentials (client_id + client_secret → access_token)
- **Token URL**: `https://ims-na1.adobelogin.com/ims/token/v3`
- **Headers**: `Authorization: Bearer <token>` + `x-api-key: <client_id>`
- **Rate Limit**: 250 requests/minute
- **API Docs**: https://developer.adobe.com/document-services/docs/overview/

## API Modules

| Module | Description | Key Methods |
|--------|-------------|-------------|
| Assets | Upload/delete PDF assets | upload, getUploadUri, delete |
| Operations | PDF operations | compress, exportPdf, createPdf, combine, split, ocr, protect, removeProtection, extract, watermark, deletePages, reorderPages, rotatePages, linearize, getProperties, documentMerge |
| Jobs | Job status polling | poll, getStatus |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ADOBE_CLIENT_ID` | OAuth2 client_id (required) |
| `ADOBE_CLIENT_SECRET` | OAuth2 client_secret (required) |
| `ADOBE_REGION` | API region: us or eu (default: us) |

## Key Patterns

- OAuth2 Client Credentials flow: POST /token with client_id/client_secret as form data
- Every request requires both Authorization: Bearer and x-api-key headers
- Async job pattern: upload asset → start operation → poll status → download result
- Token auto-refresh: client handles token caching and renewal (24h expiry)
- Region support: US (default) and EU base URLs

## CLI Commands

```bash
connect-adobe pdf compress <file> [-l LOW|MEDIUM|HIGH] [-o output]
connect-adobe pdf export <file> -t <docx|xlsx|pptx|rtf|jpeg|png> [-o output]
connect-adobe pdf create <file> [-o output] [--media-type <mime>]
connect-adobe pdf combine -i <file1> <file2> ... [-o output]
connect-adobe pdf split <file> [-c pageCount] [-o outputDir]
connect-adobe pdf ocr <file> [-l locale] [-t type] [-o output]
connect-adobe pdf protect <file> --password <pwd> [--owner-password <pwd>] [-o output]
connect-adobe pdf extract <file> [-e text tables]
connect-adobe pdf watermark <file> [-t text] [--font-size N] [--opacity N] [-o output]
connect-adobe pdf linearize <file> [-o output]
connect-adobe pdf properties <file>
connect-adobe profile list|use|create|delete|show
connect-adobe config set-key|set-secret|show|clear
```

## Build & Run

```bash
bun install
bun run dev              # Run CLI in development
bun run build            # Build for distribution
bun run typecheck        # Type check
```
