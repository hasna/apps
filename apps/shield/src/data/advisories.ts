/**
 * Seed data for known supply chain attacks.
 * Sources: BleepingComputer, Snyk, Sonatype, Wiz, Datadog, Microsoft, Sysdig, Arctic Wolf, Kaspersky.
 */

import {
  Severity,
  Ecosystem,
  AttackType,
  IOCType,
} from "../types/index.js";
import {
  createAdvisory,
  createAdvisoryIOC,
  listAdvisories,
} from "../db/advisories.js";

interface SeedAdvisory {
  package_name: string;
  ecosystem: Ecosystem;
  affected_versions: string[];
  safe_versions: string[];
  attack_type: AttackType;
  severity: Severity;
  title: string;
  description: string;
  source: string;
  cve_id: string | null;
  threat_actor: string | null;
  detected_at: string;
  resolved_at: string | null;
  iocs: Array<{
    type: IOCType;
    value: string;
    context: string | null;
    platform: string | null;
  }>;
}

const SEED_ADVISORIES: SeedAdvisory[] = [
  // --- axios (March 31, 2026) ---
  {
    package_name: "axios",
    ecosystem: Ecosystem.Npm,
    affected_versions: ["1.14.1", "0.30.4"],
    safe_versions: ["1.14.0", "1.13.6", "0.30.3"],
    attack_type: AttackType.MaintainerHijack,
    severity: Severity.Critical,
    title: "axios npm supply chain attack — maintainer account hijacked",
    description:
      "Malicious versions axios@1.14.1 and axios@0.30.4 were published to npm via a hijacked maintainer account (jasonsaayman). " +
      "They inject a fake dependency plain-crypto-js@4.2.1 that deploys a cross-platform RAT via a postinstall script. " +
      "The dropper contacts C2 server at sfrclak.com (142.11.206.73) and deploys platform-specific RAT binaries. " +
      "The RAT self-erases after deployment. No malicious code in axios itself — attack is entirely via the injected dependency.",
    source: "https://www.bleepingcomputer.com/news/security/popular-litellm-pypi-package-compromised-in-teampcp-supply-chain-attack/",
    cve_id: null,
    threat_actor: null,
    detected_at: "2026-03-31T00:21:00.000Z",
    resolved_at: "2026-03-31T04:00:00.000Z",
    iocs: [
      { type: IOCType.Domain, value: "sfrclak.com", context: "C2 server for axios RAT dropper", platform: null },
      { type: IOCType.IP, value: "142.11.206.73", context: "C2 IP for sfrclak.com", platform: null },
      { type: IOCType.FilePath, value: "/Library/Caches/com.apple.act.mond", context: "macOS RAT binary dropped by plain-crypto-js postinstall", platform: "macos" },
      { type: IOCType.FilePath, value: "%PROGRAMDATA%\\wt.exe", context: "Windows RAT binary dropped by plain-crypto-js postinstall", platform: "windows" },
      { type: IOCType.FilePath, value: "/tmp/ld.py", context: "Linux RAT script dropped by plain-crypto-js postinstall", platform: "linux" },
      { type: IOCType.ProcessName, value: "com.apple.act.mond", context: "macOS RAT process name", platform: "macos" },
      { type: IOCType.ProcessName, value: "wt.exe", context: "Windows RAT process name", platform: "windows" },
    ],
  },
  {
    package_name: "plain-crypto-js",
    ecosystem: Ecosystem.Npm,
    affected_versions: ["4.2.1"],
    safe_versions: [],
    attack_type: AttackType.MaliciousPackage,
    severity: Severity.Critical,
    title: "plain-crypto-js — malicious npm package used as axios RAT dropper",
    description:
      "Fake npm package published solely as a dropper for the axios supply chain attack. " +
      "Contains a postinstall script that downloads and executes platform-specific RAT binaries from sfrclak.com. " +
      "This package should never be installed — it has no legitimate use.",
    source: "https://www.bleepingcomputer.com/news/security/popular-litellm-pypi-package-compromised-in-teampcp-supply-chain-attack/",
    cve_id: null,
    threat_actor: null,
    detected_at: "2026-03-31T00:21:00.000Z",
    resolved_at: "2026-03-31T04:00:00.000Z",
    iocs: [
      { type: IOCType.Domain, value: "sfrclak.com", context: "C2 server — RAT binary download source", platform: null },
      { type: IOCType.IP, value: "142.11.206.73", context: "C2 IP for sfrclak.com", platform: null },
    ],
  },

  // --- litellm (March 24, 2026) ---
  {
    package_name: "litellm",
    ecosystem: Ecosystem.PyPI,
    affected_versions: ["1.82.7", "1.82.8"],
    safe_versions: ["1.82.6"],
    attack_type: AttackType.CiCdCompromise,
    severity: Severity.Critical,
    title: "litellm PyPI supply chain attack — TeamPCP credential stealer via poisoned Trivy",
    description:
      "TeamPCP compromised LiteLLM's PyPI publishing tokens by first poisoning the Trivy security scanner used in LiteLLM's CI/CD pipeline. " +
      "v1.82.7 contained malicious code in proxy_server.py. v1.82.8 is more dangerous: it installs a .pth file (litellm_init.pth) that " +
      "executes on EVERY Python interpreter startup, not just when litellm is imported. The payload: 3-stage attack — " +
      "1) harvests credentials (SSH keys, cloud tokens, K8s secrets, crypto wallets, .env files), " +
      "2) attempts lateral movement via privileged K8s pods on every node, " +
      "3) installs persistent systemd backdoor polling for additional binaries. " +
      "A fork-bomb bug in the .pth file (child process re-triggers .pth startup) crashed machines, leading to discovery. " +
      "The attacker also tried to suppress discovery by closing the GitHub issue and flooding with bot comments. " +
      "3.4M daily downloads — massive exposure in the ~3 hour window before PyPI quarantined the package.",
    source: "https://www.sonatype.com/blog/compromised-litellm-pypi-package-delivers-multi-stage-credential-stealer",
    cve_id: null,
    threat_actor: "TeamPCP",
    detected_at: "2026-03-24T10:39:00.000Z",
    resolved_at: "2026-03-24T13:38:00.000Z",
    iocs: [
      { type: IOCType.Domain, value: "models.litellm.cloud", context: "C2 domain for litellm credential exfiltration", platform: null },
      { type: IOCType.FilePath, value: "litellm_init.pth", context: ".pth file in site-packages that executes on every Python startup", platform: null },
      { type: IOCType.FilePath, value: "litellm/proxy/proxy_server.py", context: "Injected payload location in v1.82.7", platform: null },
      { type: IOCType.ProcessName, value: "litellm_init", context: "Spawned child process from .pth launcher", platform: null },
    ],
  },

  // --- Trivy (March 19, 2026) ---
  {
    package_name: "trivy",
    ecosystem: Ecosystem.GitHubActions,
    affected_versions: ["0.69.4"],
    safe_versions: ["0.69.3"],
    attack_type: AttackType.TagHijack,
    severity: Severity.Critical,
    title: "Trivy supply chain compromise — TeamPCP force-pushed 76 version tags",
    description:
      "TeamPCP exploited a misconfiguration in Trivy's GitHub Actions to extract a privileged access token. " +
      "They force-pushed 76 of 77 version tags in aquasecurity/trivy-action and all 7 tags in aquasecurity/setup-trivy, " +
      "redirecting trusted references to malicious commits. Published malicious Trivy binary v0.69.4 that exfiltrates " +
      "CI/CD secrets and environment variables. This was the root cause that enabled the downstream litellm and Checkmarx attacks. " +
      "The malware (TeamPCP Cloud Stealer) dumps Runner.Worker process memory, harvests SSH/cloud/K8s secrets, " +
      "encrypts with AES-256+RSA-4096, and exfiltrates to C2. Fallback: creates a 'tpcp-docs' repo with stolen GITHUB_TOKEN. " +
      "First observed use of ICP (Internet Computer Protocol) blockchain as C2 dead-drop. CVE-2026-33634.",
    source: "https://www.aquasec.com/blog/trivy-supply-chain-attack-what-you-need-to-know/",
    cve_id: "CVE-2026-33634",
    threat_actor: "TeamPCP",
    detected_at: "2026-03-19T17:43:00.000Z",
    resolved_at: "2026-03-19T20:38:00.000Z",
    iocs: [
      { type: IOCType.Domain, value: "scan.aquasecurtiy.org", context: "Typosquatted domain (note misspelling) used as C2", platform: null },
      { type: IOCType.IP, value: "45.148.10.212", context: "C2 IP for scan.aquasecurtiy.org", platform: null },
      { type: IOCType.Domain, value: "plug-tab-protective-relay.trycloudflare.com", context: "Cloudflare Tunnel used as C2 channel", platform: null },
      { type: IOCType.FilePath, value: "tpcp.tar.gz", context: "Exfiltration archive containing stolen secrets", platform: null },
      { type: IOCType.FilePath, value: "tpcp-docs", context: "Fallback exfiltration: repo created with stolen GITHUB_TOKEN", platform: null },
    ],
  },

  // --- Checkmarx KICS (March 23, 2026) ---
  {
    package_name: "kics-github-action",
    ecosystem: Ecosystem.GitHubActions,
    affected_versions: ["*"],
    safe_versions: [],
    attack_type: AttackType.TagHijack,
    severity: Severity.Critical,
    title: "Checkmarx KICS GitHub Action compromised — TeamPCP tag hijack",
    description:
      "TeamPCP used CI/CD secrets stolen from the Trivy compromise to hijack Checkmarx's GitHub Actions. " +
      "Between 12:58 and 16:50 UTC on March 23, all 35 tags of Checkmarx/kics-github-action were hijacked " +
      "using the compromised cx-plugins-releases service account. " +
      "The payload is identical to the Trivy stealer — same RSA public key for encryption, same exfiltration pattern. " +
      "Exfiltrates secrets to checkmarx.zone. Fallback creates 'docs-tpcp' repo.",
    source: "https://www.sysdig.com/blog/teampcp-expands-supply-chain-compromise-spreads-from-trivy-to-checkmarx-github-actions",
    cve_id: null,
    threat_actor: "TeamPCP",
    detected_at: "2026-03-23T12:58:00.000Z",
    resolved_at: "2026-03-23T16:50:00.000Z",
    iocs: [
      { type: IOCType.Domain, value: "checkmarx.zone", context: "C2 domain for Checkmarx attack wave exfiltration", platform: null },
      { type: IOCType.IP, value: "83.142.209.11", context: "C2 IP for checkmarx.zone", platform: null },
      { type: IOCType.FilePath, value: "tpcp.tar.gz", context: "Exfiltration archive (same pattern as Trivy attack)", platform: null },
      { type: IOCType.FilePath, value: "docs-tpcp", context: "Fallback exfiltration repo (renamed from tpcp-docs)", platform: null },
    ],
  },
  {
    package_name: "ast-github-action",
    ecosystem: Ecosystem.GitHubActions,
    affected_versions: ["*"],
    safe_versions: [],
    attack_type: AttackType.TagHijack,
    severity: Severity.Critical,
    title: "Checkmarx AST GitHub Action compromised — TeamPCP tag hijack",
    description:
      "Part of the same Checkmarx compromise as KICS. Checkmarx/ast-github-action tags were also hijacked " +
      "using the same stolen credentials. Identical payload and exfiltration mechanism.",
    source: "https://www.sysdig.com/blog/teampcp-expands-supply-chain-compromise-spreads-from-trivy-to-checkmarx-github-actions",
    cve_id: null,
    threat_actor: "TeamPCP",
    detected_at: "2026-03-23T12:58:00.000Z",
    resolved_at: "2026-03-23T16:50:00.000Z",
    iocs: [
      { type: IOCType.Domain, value: "checkmarx.zone", context: "C2 domain for Checkmarx attack wave exfiltration", platform: null },
      { type: IOCType.IP, value: "83.142.209.11", context: "C2 IP for checkmarx.zone", platform: null },
    ],
  },
];

export function seedAdvisories(): { created: number; skipped: number } {
  let created = 0;
  let skipped = 0;

  for (const seed of SEED_ADVISORIES) {
    // Check if advisory already exists for this package+ecosystem
    const existing = listAdvisories({ ecosystem: seed.ecosystem });
    const alreadyExists = existing.some(
      (a) =>
        a.package_name === seed.package_name &&
        JSON.stringify(a.affected_versions.sort()) === JSON.stringify(seed.affected_versions.sort()),
    );

    if (alreadyExists) {
      skipped++;
      continue;
    }

    const advisory = createAdvisory({
      package_name: seed.package_name,
      ecosystem: seed.ecosystem,
      affected_versions: seed.affected_versions,
      safe_versions: seed.safe_versions,
      attack_type: seed.attack_type,
      severity: seed.severity,
      title: seed.title,
      description: seed.description,
      source: seed.source,
      cve_id: seed.cve_id ?? undefined,
      threat_actor: seed.threat_actor ?? undefined,
      detected_at: seed.detected_at,
      resolved_at: seed.resolved_at ?? undefined,
    });

    for (const ioc of seed.iocs) {
      createAdvisoryIOC({
        advisory_id: advisory.id,
        type: ioc.type,
        value: ioc.value,
        context: ioc.context ?? undefined,
        platform: ioc.platform ?? undefined,
      });
    }

    created++;
  }

  return { created, skipped };
}

export { SEED_ADVISORIES };
