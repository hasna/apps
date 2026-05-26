import chalk from 'chalk';
import type { OutputFormat, ParseResult, ExtractResult, SplitResult, EditResult, JobStatus, Document } from '../types';

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function error(message: string): void {
  console.error(chalk.red('✗'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed':
      return chalk.green(status);
    case 'processing':
    case 'pending':
      return chalk.yellow(status);
    case 'failed':
      return chalk.red(status);
    default:
      return status;
  }
}

export function printParseResult(result: ParseResult, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  success(`Parse Job: ${result.jobId}`);
  console.log(`  Status: ${getStatusColor(result.status)}`);

  if (result.documentId) {
    console.log(`  Document ID: ${chalk.gray(result.documentId)}`);
  }

  if (result.pageCount !== undefined) {
    console.log(`  Pages: ${result.pageCount}`);
  }

  if (result.chunks) {
    console.log(`  Chunks: ${result.chunks.length}`);
    for (const chunk of result.chunks.slice(0, 3)) {
      const preview = chunk.content.substring(0, 100).replace(/\n/g, ' ');
      console.log(`    [${chunk.pageNumber}:${chunk.chunkIndex}] ${chalk.gray(preview)}...`);
    }
    if (result.chunks.length > 3) {
      console.log(`    ... and ${result.chunks.length - 3} more chunks`);
    }
  }

  if (result.tables && result.tables.length > 0) {
    console.log(`  Tables: ${result.tables.length}`);
  }

  if (result.images && result.images.length > 0) {
    console.log(`  Images: ${result.images.length}`);
  }

  if (result.processingTime) {
    console.log(`  Processing Time: ${chalk.gray(`${result.processingTime}ms`)}`);
  }

  if (result.error) {
    console.log(`  Error: ${chalk.red(result.error)}`);
  }
}

export function printExtractResult(result: ExtractResult, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  success(`Extract Job: ${result.jobId}`);
  console.log(`  Status: ${getStatusColor(result.status)}`);

  if (result.documentId) {
    console.log(`  Document ID: ${chalk.gray(result.documentId)}`);
  }

  if (result.data) {
    console.log(`  Extracted Fields:`);
    for (const [key, value] of Object.entries(result.data)) {
      const confidence = result.confidence?.[key];
      const confidenceStr = confidence ? chalk.gray(` (${(confidence * 100).toFixed(1)}%)`) : '';
      const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
      console.log(`    ${chalk.cyan(key)}: ${valueStr}${confidenceStr}`);
    }
  }

  if (result.processingTime) {
    console.log(`  Processing Time: ${chalk.gray(`${result.processingTime}ms`)}`);
  }

  if (result.error) {
    console.log(`  Error: ${chalk.red(result.error)}`);
  }
}

export function printSplitResult(result: SplitResult, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  success(`Split Job: ${result.jobId}`);
  console.log(`  Status: ${getStatusColor(result.status)}`);

  if (result.documentId) {
    console.log(`  Document ID: ${chalk.gray(result.documentId)}`);
  }

  if (result.segmentCount !== undefined) {
    console.log(`  Segments: ${result.segmentCount}`);
  }

  if (result.segments) {
    for (const segment of result.segments.slice(0, 5)) {
      const preview = segment.content.substring(0, 80).replace(/\n/g, ' ');
      console.log(`    [${segment.segmentIndex}] Pages ${segment.startPage}-${segment.endPage}: ${chalk.gray(preview)}...`);
    }
    if (result.segments.length > 5) {
      console.log(`    ... and ${result.segments.length - 5} more segments`);
    }
  }

  if (result.processingTime) {
    console.log(`  Processing Time: ${chalk.gray(`${result.processingTime}ms`)}`);
  }

  if (result.error) {
    console.log(`  Error: ${chalk.red(result.error)}`);
  }
}

export function printEditResult(result: EditResult, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  success(`Edit Job: ${result.jobId}`);
  console.log(`  Status: ${getStatusColor(result.status)}`);

  if (result.documentId) {
    console.log(`  Document ID: ${chalk.gray(result.documentId)}`);
  }

  if (result.outputUrl) {
    console.log(`  Output URL: ${chalk.cyan(result.outputUrl)}`);
  }

  if (result.processingTime) {
    console.log(`  Processing Time: ${chalk.gray(`${result.processingTime}ms`)}`);
  }

  if (result.error) {
    console.log(`  Error: ${chalk.red(result.error)}`);
  }
}

export function printJobStatus(job: JobStatus, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(job, null, 2));
    return;
  }

  success(`Job: ${job.jobId}`);
  console.log(`  Status: ${getStatusColor(job.status)}`);

  if (job.progress !== undefined) {
    console.log(`  Progress: ${job.progress}%`);
  }

  console.log(`  Created: ${chalk.gray(formatDate(job.createdAt))}`);
  console.log(`  Updated: ${chalk.gray(formatDate(job.updatedAt))}`);

  if (job.error) {
    console.log(`  Error: ${chalk.red(job.error)}`);
  }
}

export function printDocument(doc: Document, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  success(`Document: ${doc.filename}`);
  console.log(`  ID: ${chalk.gray(doc.documentId)}`);
  console.log(`  Type: ${doc.mimeType}`);
  console.log(`  Size: ${formatSize(doc.size)}`);

  if (doc.pageCount) {
    console.log(`  Pages: ${doc.pageCount}`);
  }

  console.log(`  Created: ${chalk.gray(formatDate(doc.createdAt))}`);
}

export function printDocuments(docs: Document[], format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(docs, null, 2));
    return;
  }

  if (docs.length === 0) {
    info('No documents found');
    return;
  }

  success(`Documents (${docs.length}):`);
  for (const doc of docs) {
    console.log(`  ${chalk.bold(doc.filename)}`);
    console.log(`    ID: ${chalk.gray(doc.documentId)}`);
    console.log(`    Size: ${formatSize(doc.size)} | Type: ${doc.mimeType}`);
    console.log();
  }
}
