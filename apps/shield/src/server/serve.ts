import express from "express";
import type { Request, Response, NextFunction } from "express";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

import {
  createProject,
  getProject,
  getProjectByPath,
  listProjects,
  createScan,
  getScan,
  listScans,
  updateScanStatus,
  completeScan,
  createFinding,
  getFinding,
  listFindings,
  updateFinding,
  suppressFinding,
  countFindings,
  getSecurityScore,
  createRule,
  getRule,
  listRules,
  updateRule,
  toggleRule,
  createPolicy,
  getPolicy,
  listPolicies,
  updatePolicy,
  getActivePolicy,
  createBaseline,
  listBaselines,
  seedBuiltinRules,
} from "../db/index.js";
import {
  runAllScanners,
  runScanner,
} from "../scanners/index.js";
import {
  explainFinding as llmExplain,
  suggestFix as llmSuggestFix,
  analyzeFinding as llmAnalyze,
  isLLMAvailable,
} from "../llm/index.js";
import { ScannerType, ScanStatus, Severity } from "../types/index.js";
import type { FindingInput } from "../types/index.js";

// Seed builtin rules on startup
seedBuiltinRules();

function getCodeContext(filePath: string, line: number, contextLines = 10): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, line - contextLines - 1);
    const end = Math.min(lines.length, line + contextLines);
    return lines
      .slice(start, end)
      .map((l, i) => `${start + i + 1}: ${l}`)
      .join("\n");
  } catch {
    return "";
  }
}

export function startServer(port: number) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // CORS for dashboard
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // --- Scans ---

  // POST /api/scans — trigger new scan
  app.post("/api/scans", async (req: Request, res: Response) => {
    try {
      const { path: scanPath, scanners, llm_analyze } = req.body;
      if (!scanPath) {
        res.status(400).json({ error: "path is required" });
        return;
      }

      const absPath = resolve(scanPath);

      // Find or create project
      let project = getProjectByPath(absPath);
      if (!project) {
        const name = absPath.split("/").pop() || "unknown";
        project = createProject(name, absPath);
      }

      // Determine scanner types
      const scannerTypes: ScannerType[] = scanners
        ? (scanners as string[]).filter((s: string) => Object.values(ScannerType).includes(s as ScannerType)) as ScannerType[]
        : Object.values(ScannerType);

      // Create scan record
      const scan = createScan(project.id, scannerTypes);
      updateScanStatus(scan.id, ScanStatus.Running);

      // Return scan immediately, run async
      res.status(202).json(scan);

      // Run scan in background
      (async () => {
        try {
          let findingInputs: FindingInput[];
          if (scanners && scanners.length > 0) {
            const results = await Promise.allSettled(
              scannerTypes.map((t) => runScanner(t, absPath)),
            );
            findingInputs = results
              .filter((r) => r.status === "fulfilled")
              .flatMap((r) => (r as PromiseFulfilledResult<FindingInput[]>).value);
          } else {
            findingInputs = await runAllScanners(absPath);
          }

          // Store findings
          const findings = findingInputs.map((input) => createFinding(scan.id, input));

          // LLM analysis if requested
          if (llm_analyze && isLLMAvailable()) {
            for (const finding of findings) {
              const context = getCodeContext(finding.file, finding.line);
              if (context) {
                const analysis = await llmAnalyze(finding, context);
                if (analysis) {
                  updateFinding(finding.id, {
                    llm_exploitability: analysis.exploitability,
                  });
                }
              }
            }
          }

          completeScan(scan.id, findings.length);
        } catch (error) {
          updateScanStatus(scan.id, ScanStatus.Failed, undefined, String(error));
        }
      })();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/scans — list scans
  app.get("/api/scans", (req: Request, res: Response) => {
    try {
      const project_id = req.query.project_id as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const scans = listScans(project_id, limit);
      res.json({ scans, count: scans.length });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/scans/:id — get scan details
  app.get("/api/scans/:id", (req: Request, res: Response) => {
    try {
      const scan = getScan(req.params.id);
      if (!scan) {
        res.status(404).json({ error: "Scan not found" });
        return;
      }
      const score = getSecurityScore(scan.id);
      res.json({ ...scan, score });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // --- Findings ---

  // GET /api/findings — list findings
  app.get("/api/findings", (req: Request, res: Response) => {
    try {
      const options = {
        scan_id: req.query.scan_id as string | undefined,
        severity: req.query.severity as Severity | undefined,
        scanner_type: req.query.scanner_type as ScannerType | undefined,
        file: req.query.file as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };
      const findings = listFindings(options);
      res.json({ findings, count: findings.length });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/findings/:id — get finding detail
  app.get("/api/findings/:id", (req: Request, res: Response) => {
    try {
      const finding = getFinding(req.params.id);
      if (!finding) {
        res.status(404).json({ error: "Finding not found" });
        return;
      }
      res.json(finding);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PATCH /api/findings/:id — update finding
  app.patch("/api/findings/:id", (req: Request, res: Response) => {
    try {
      const finding = getFinding(req.params.id);
      if (!finding) {
        res.status(404).json({ error: "Finding not found" });
        return;
      }

      const updates: Record<string, unknown> = {};
      if (req.body.suppressed !== undefined) updates.suppressed = req.body.suppressed;
      if (req.body.suppressed_reason !== undefined) updates.suppressed_reason = req.body.suppressed_reason;
      if (req.body.llm_explanation !== undefined) updates.llm_explanation = req.body.llm_explanation;
      if (req.body.llm_fix !== undefined) updates.llm_fix = req.body.llm_fix;
      if (req.body.llm_exploitability !== undefined) updates.llm_exploitability = req.body.llm_exploitability;

      updateFinding(req.params.id, updates);
      const updated = getFinding(req.params.id);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/findings/:id/explain — trigger LLM explanation
  app.post("/api/findings/:id/explain", async (req: Request, res: Response) => {
    try {
      const finding = getFinding(req.params.id);
      if (!finding) {
        res.status(404).json({ error: "Finding not found" });
        return;
      }

      if (finding.llm_explanation) {
        res.json({ finding_id: finding.id, explanation: finding.llm_explanation });
        return;
      }

      if (!isLLMAvailable()) {
        res.status(503).json({ error: "LLM not available. Set CEREBRAS_API_KEY." });
        return;
      }

      const context = getCodeContext(finding.file, finding.line);
      const explanation = await llmExplain(finding, context);

      if (explanation) {
        updateFinding(finding.id, { llm_explanation: explanation });
      }

      res.json({
        finding_id: finding.id,
        explanation: explanation || "Unable to generate explanation",
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/findings/:id/fix — trigger LLM fix suggestion
  app.post("/api/findings/:id/fix", async (req: Request, res: Response) => {
    try {
      const finding = getFinding(req.params.id);
      if (!finding) {
        res.status(404).json({ error: "Finding not found" });
        return;
      }

      if (finding.llm_fix) {
        res.json({ finding_id: finding.id, fix: finding.llm_fix });
        return;
      }

      if (!isLLMAvailable()) {
        res.status(503).json({ error: "LLM not available. Set CEREBRAS_API_KEY." });
        return;
      }

      const context = getCodeContext(finding.file, finding.line);
      const fix = await llmSuggestFix(finding, context);

      if (fix) {
        updateFinding(finding.id, { llm_fix: fix });
      }

      res.json({
        finding_id: finding.id,
        fix: fix || "Unable to generate fix suggestion",
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // --- Rules ---

  // GET /api/rules — list rules
  app.get("/api/rules", (req: Request, res: Response) => {
    try {
      const scanner_type = req.query.scanner_type as ScannerType | undefined;
      const enabled = req.query.enabled !== undefined
        ? req.query.enabled === "true"
        : undefined;
      const rules = listRules(scanner_type, enabled);
      res.json({ rules, count: rules.length });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/rules — create rule
  app.post("/api/rules", (req: Request, res: Response) => {
    try {
      const { name, scanner_type, severity, pattern, description } = req.body;
      if (!name || !scanner_type || !severity) {
        res.status(400).json({ error: "name, scanner_type, and severity are required" });
        return;
      }

      const rule = createRule({
        name,
        scanner_type: scanner_type as ScannerType,
        severity: severity as Severity,
        pattern: pattern || null,
        description: description || "",
        enabled: true,
        builtin: false,
        metadata: req.body.metadata || {},
      });
      res.status(201).json(rule);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PATCH /api/rules/:id — update rule
  app.patch("/api/rules/:id", (req: Request, res: Response) => {
    try {
      const rule = getRule(req.params.id);
      if (!rule) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }

      if (req.body.enabled !== undefined) {
        toggleRule(req.params.id, req.body.enabled);
      }

      const updates: Record<string, unknown> = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.severity !== undefined) updates.severity = req.body.severity;
      if (req.body.pattern !== undefined) updates.pattern = req.body.pattern;

      if (Object.keys(updates).length > 0) {
        updateRule(req.params.id, updates);
      }

      const updated = getRule(req.params.id);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // --- Policies ---

  // GET /api/policies — list policies
  app.get("/api/policies", (req: Request, res: Response) => {
    try {
      const policies = listPolicies();
      res.json({ policies, count: policies.length });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/policies — create policy
  app.post("/api/policies", (req: Request, res: Response) => {
    try {
      const { name, description, block_on_severity, auto_fix, notify } = req.body;
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }

      const policy = createPolicy({
        name,
        description: description || "",
        block_on_severity: (block_on_severity as Severity) ?? null,
        auto_fix: auto_fix ?? false,
        notify: notify ?? false,
        enabled: true,
      });
      res.status(201).json(policy);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PATCH /api/policies/:id — update policy
  app.patch("/api/policies/:id", (req: Request, res: Response) => {
    try {
      const policy = getPolicy(req.params.id);
      if (!policy) {
        res.status(404).json({ error: "Policy not found" });
        return;
      }

      const updates: Record<string, unknown> = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.block_on_severity !== undefined) updates.block_on_severity = req.body.block_on_severity;
      if (req.body.auto_fix !== undefined) updates.auto_fix = req.body.auto_fix;
      if (req.body.notify !== undefined) updates.notify = req.body.notify;
      if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;

      updatePolicy(req.params.id, updates);
      const updated = getPolicy(req.params.id);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // --- Projects ---

  // GET /api/projects — list projects
  app.get("/api/projects", (req: Request, res: Response) => {
    try {
      const projects = listProjects();
      res.json({ projects, count: projects.length });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/projects — create project
  app.post("/api/projects", (req: Request, res: Response) => {
    try {
      const { name, path: projectPath } = req.body;
      if (!name || !projectPath) {
        res.status(400).json({ error: "name and path are required" });
        return;
      }

      const absPath = resolve(projectPath);
      const existing = getProjectByPath(absPath);
      if (existing) {
        res.json(existing);
        return;
      }

      const project = createProject(name, absPath);
      res.status(201).json(project);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // --- Stats ---

  // GET /api/stats — dashboard stats
  app.get("/api/stats", (req: Request, res: Response) => {
    try {
      const recentScans = listScans(undefined, 10);
      const latestScan = recentScans.length > 0 ? recentScans[0] : null;

      let score = null;
      let bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      let byScanner: Record<string, number> = {};
      let totalFindings = 0;

      if (latestScan) {
        const secScore = getSecurityScore(latestScan.id);
        score = secScore.score;
        totalFindings = secScore.total_findings;
        bySeverity = {
          critical: secScore.critical,
          high: secScore.high,
          medium: secScore.medium,
          low: secScore.low,
          info: secScore.info,
        };

        // Count findings by scanner type
        const findings = listFindings({ scan_id: latestScan.id, limit: 10000 });
        for (const f of findings) {
          byScanner[f.scanner_type] = (byScanner[f.scanner_type] || 0) + 1;
        }
      }

      res.json({
        total_findings: totalFindings,
        by_severity: bySeverity,
        by_scanner: byScanner,
        recent_scans: recentScans,
        score,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // --- Serve dashboard static files ---
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dashboardPath = join(__dirname, "../../dashboard/dist");
  app.use(express.static(dashboardPath));
  app.get("*", (req: Request, res: Response) => {
    if (!req.path.startsWith("/api")) {
      res.sendFile(join(dashboardPath, "index.html"), (err) => {
        if (err) {
          res.status(404).json({ error: "Dashboard not built. Run: bun run build:dashboard" });
        }
      });
    }
  });

  app.listen(port, () => {
    console.log(`open-security dashboard: http://localhost:${port}`);
  });

  return app;
}
