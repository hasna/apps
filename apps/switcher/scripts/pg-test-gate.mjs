#!/usr/bin/env bun
if (!process.env.SWITCHER_TEST_DATABASE_URL) {
  console.error("Set SWITCHER_TEST_DATABASE_URL to a disposable PostgreSQL database. Tests create and remove their own unique schema.");
  process.exit(1);
}
const child = Bun.spawn([process.execPath,"test","tests/service.test.ts"],{stdout:"inherit",stderr:"inherit",env:process.env});
process.exitCode=await child.exited;
