/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.ts');

function runCli(args: string[]) {
  return Bun.spawnSync(['bun', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe'
  });
}

describe('open-knowledge cli', () => {
  test('help and subcommand help work', () => {
    const result = runCli(['--help']);
    expect(result.exitCode).toBe(0);
    const out = new TextDecoder().decode(result.stdout);
    expect(out).toContain('open-knowledge');
    expect(out).toContain('Commands:');

    const sub = runCli(['help', 'list']);
    expect(sub.exitCode).toBe(0);
    const subOut = new TextDecoder().decode(sub.stdout);
    expect(subOut).toContain('--sort created|title');
  });

  test('version flag works', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
    const result = runCli(['--version']);
    expect(result.exitCode).toBe(0);
    const out = new TextDecoder().decode(result.stdout);
    expect(out.trim()).toBe(pkg.version);
  });

  test('unknown command includes suggestion', () => {
    const result = runCli(['lits']);
    expect(result.exitCode).toBe(1);
    const err = new TextDecoder().decode(result.stderr);
    expect(err).toContain("Did you mean 'list'");
  });

  test('add/list/get/delete flow with json and confirmation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-cli-'));
    const store = join(dir, 'db.json');

    const addA = runCli(['add', 'TitleB', 'BodyA', '--store', store, '--json']);
    expect(addA.exitCode).toBe(0);
    const addAOut = JSON.parse(new TextDecoder().decode(addA.stdout));

    const addB = runCli(['add', 'TitleA', 'BodyB', '--store', store, '--json']);
    expect(addB.exitCode).toBe(0);
    const addBOut = JSON.parse(new TextDecoder().decode(addB.stdout));

    const list = runCli(['ls', '--store', store, '--json', '-p', '1', '-l', '10', '--sort', 'title']);
    expect(list.exitCode).toBe(0);
    const listOut = JSON.parse(new TextDecoder().decode(list.stdout));
    expect(listOut.total).toBe(2);
    expect(listOut.total_pages).toBe(1);
    expect(listOut.items[0].title).toBe('TitleA');

    const get = runCli(['get', '--id', addAOut.item.id, '--store', store, '--json']);
    expect(get.exitCode).toBe(0);
    const getOut = JSON.parse(new TextDecoder().decode(get.stdout));
    expect(getOut.item.content).toBe('BodyA');

    const delNoYes = runCli(['rm', '--id', addAOut.item.id, '--store', store, '--json']);
    expect(delNoYes.exitCode).toBe(1);
    const delErr = new TextDecoder().decode(delNoYes.stderr);
    expect(delErr).toContain('Refusing delete without --yes');

    const del = runCli(['delete', '--id', addAOut.item.id, '--store', store, '--json', '--yes']);
    expect(del.exitCode).toBe(0);
    const delOut = JSON.parse(new TextDecoder().decode(del.stdout));
    expect(delOut.ok).toBe(true);

    const del2 = runCli(['delete', '--id', addBOut.item.id, '--store', store, '--json', '--yes']);
    expect(del2.exitCode).toBe(0);

    const db = JSON.parse(readFileSync(store, 'utf8'));
    expect(db.items.length).toBe(0);
  });
});
