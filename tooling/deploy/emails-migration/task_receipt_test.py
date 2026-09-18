#!/usr/bin/env python3
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
SCRIPT = (ROOT / "task_receipt.js").read_text()
MARKER = "EMAILS_MIGRATION_RECEIPT:"


class TaskReceiptTest(unittest.TestCase):
    def fixture(self, root):
        files = {
            "src/server/self-hosted/env.ts": '''
const initial=[{id:"0001",checksum:"sha256:one"}];
(globalThis as any).__rows=initial.map(row=>({...row}));
export function getSelfHostedPool(){return{client:{many:async()=>[...(globalThis as any).__rows],execute:async()=>{}}}};
export async function closeSelfHostedPool(){}
''',
            "src/server/self-hosted/migrations.ts": '''
export function emailsSelfHostedMigrations(){return[
{id:"0001",checksum:"sha256:one",sql:"SELECT 1"},
{id:"0002",checksum:"sha256:two",sql:"SELECT 2"},
]}
''',
            "src/storage-kit/index.ts": '''
export const migrationAcceptsChecksum=(migration:any,checksum:string)=>migration.checksum===checksum;
export class MigrationLedger{constructor(private client:any,private migrations:any[]){}async migrate(){const rows=(globalThis as any).__rows;for(const migration of this.migrations)if(!rows.some((row:any)=>row.id===migration.id))rows.push({id:migration.id,checksum:migration.checksum});rows.sort((a:any,b:any)=>a.id.localeCompare(b.id));return{}}}
''',
            "src/server/self-hosted/provider-root-kms.ts": '''
export function buildProviderRootKms(){return{
 generate:async()=>({plaintext:Buffer.alloc(32,7),ciphertext:Buffer.from("opaque")}),
 decrypt:async()=>Buffer.alloc(32,7),
}}
''',
        }
        for name, value in files.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value)

    def run_receipt(self, root, operation, extra=None):
        bun = shutil.which("bun")
        self.assertIsNotNone(bun)
        env = {"PATH": os.path.dirname(bun), "EMAILS_MIGRATION_OPERATION": operation, **(extra or {})}
        result = subprocess.run([bun, "--no-env-file", "-e", SCRIPT], cwd=root, env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = [line[len(MARKER):] for line in result.stdout.splitlines() if line.startswith(MARKER)]
        self.assertEqual(len(rows), 1)
        return json.loads(rows[0]), result

    def test_plan_and_single_apply_bind_exact_ledger_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            plan, _ = self.run_receipt(root, "plan")
            self.assertFalse(plan["databaseMutated"])
            self.assertEqual([row["state"] for row in plan["plan"]], ["already_applied", "pending"])
            applied, _ = self.run_receipt(root, "apply", {
                "EMAILS_MIGRATION_EXPECTED_LEDGER_SHA256": plan["ledgerSha256"],
                "EMAILS_MIGRATION_EXPECTED_PLAN_SHA256": plan["planSha256"],
                "EMAILS_MIGRATION_EXPECTED_AFTER_LEDGER_SHA256": plan["expectedAfterLedgerSha256"],
            })
            self.assertTrue(applied["databaseMutated"])
            self.assertEqual(applied["appliedMigrationIds"], ["0002"])
            self.assertEqual(applied["afterLedgerSha256"], plan["expectedAfterLedgerSha256"])
            self.assertFalse(applied["automaticRollback"])

    def test_apply_refuses_changed_review_binding_before_migration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            plan, _ = self.run_receipt(root, "plan")
            bun = shutil.which("bun")
            env = {
                "PATH": os.path.dirname(bun),
                "EMAILS_MIGRATION_OPERATION": "apply",
                "EMAILS_MIGRATION_EXPECTED_LEDGER_SHA256": "0" * 64,
                "EMAILS_MIGRATION_EXPECTED_PLAN_SHA256": plan["planSha256"],
                "EMAILS_MIGRATION_EXPECTED_AFTER_LEDGER_SHA256": plan["expectedAfterLedgerSha256"],
            }
            result = subprocess.run([bun, "--no-env-file", "-e", SCRIPT], cwd=root, env=env, capture_output=True, text=True, timeout=30)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(MARKER, result.stdout)

    def test_kms_round_trip_emits_no_key_material(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            value, result = self.run_receipt(root, "kms", {"EMAILS_MIGRATION_PROOF_ID": "a" * 64})
            self.assertEqual(value["schema"], "emails.migration-kms-proof.v1")
            self.assertTrue(value["roundTrip"])
            self.assertFalse(value["keyMaterialEmitted"])
            self.assertNotIn("opaque", result.stdout)
            self.assertNotIn("070707", result.stdout)


if __name__ == "__main__":
    unittest.main()
