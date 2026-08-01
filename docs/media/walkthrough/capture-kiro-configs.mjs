#!/usr/bin/env node
/**
 * Capture Kiro-UI-style screenshots for the ".kiro/ config walkthrough" section.
 *
 * Renders dark-themed HTML that visually mimics Kiro's explorer, panels, and
 * config views, then screenshots them with Playwright.
 *
 * Usage (from repo root):
 *   node docs/media/walkthrough/capture-kiro-configs.mjs
 *
 * Requires: playwright chromium (same as capture.mjs)
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const REPO = join(__dirname, "../../..");

mkdirSync(join(OUT, "_render"), { recursive: true });

function readRepo(rel) {
  return readFileSync(join(REPO, rel), "utf8");
}

function escHtml(s) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// === Shared CSS theme (Kiro dark) ===
const THEME = `
  :root {
    --bg: #1e1e2e; --surface: #181825; --border: #313244;
    --text: #cdd6f4; --muted: #6c7086; --accent: #89b4fa;
    --green: #a6e3a1; --yellow: #f9e2af; --red: #f38ba8;
    --purple: #cba6f7; --peach: #fab387;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: var(--bg); color: var(--text);
    font: 13px/1.5 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
`;

const PANEL_CSS = `
  .panel {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; overflow: hidden; margin: 16px;
  }
  .panel-header {
    padding: 12px 16px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 8px;
    font: 600 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: var(--text);
  }
  .panel-header .icon { font-size: 16px; }
  .panel-body { padding: 12px 16px; }
`;

const BADGE_CSS = `
  .badge {
    display: inline-block; font-size: 10px; font-weight: 600;
    padding: 2px 6px; border-radius: 4px; text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .badge-always { background: #89b4fa33; color: var(--accent); }
  .badge-filematch { background: #a6e3a133; color: var(--green); }
  .badge-manual { background: #f9e2af33; color: var(--yellow); }
  .badge-enabled { background: #a6e3a133; color: var(--green); }
  .badge-disabled { background: #f38ba833; color: var(--red); }
`;

const TREE_CSS = `
  .tree { list-style: none; padding-left: 0; }
  .tree ul { list-style: none; padding-left: 20px; }
  .tree li { padding: 3px 0; display: flex; align-items: center; gap: 6px; }
  .tree .icon-folder { color: var(--accent); }
  .tree .icon-file { color: var(--muted); }
  .tree .fname { color: var(--text); }
  .tree .fmuted { color: var(--muted); font-style: italic; }
`;

// === HTML builders ===

function explorerTreeHtml({ title, items }) {
  // items: [{name, type:'folder'|'file', indent, badge?, badgeClass?}]
  function renderItem(it) {
    const icon = it.type === "folder"
      ? `<span class="icon-folder">📁</span>`
      : `<span class="icon-file">📄</span>`;
    const badge = it.badge
      ? ` <span class="badge ${it.badgeClass || ""}">${escHtml(it.badge)}</span>`
      : "";
    const cls = it.muted ? "fmuted" : "fname";
    return `<li style="padding-left:${it.indent * 20}px">${icon}<span class="${cls}">${escHtml(it.name)}</span>${badge}</li>`;
  }
  const listItems = items.map(renderItem).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
${THEME}${PANEL_CSS}${BADGE_CSS}${TREE_CSS}
body { padding: 24px; min-height: 100vh; }
</style></head><body>
<div class="panel">
  <div class="panel-header"><span class="icon">🗂️</span> ${escHtml(title)}</div>
  <div class="panel-body"><ul class="tree">${listItems}</ul></div>
</div>
</body></html>`;
}

function steeringDetailHtml({ filename, inclusion, pattern, description, keyPoints }) {
  const badgeCls = inclusion === "always" ? "badge-always"
    : inclusion === "fileMatch" ? "badge-filematch" : "badge-manual";
  const patternLine = pattern
    ? `<div class="meta-row"><span class="meta-label">Pattern:</span> <code>${escHtml(pattern)}</code></div>`
    : "";
  const points = keyPoints.map(p => `<li>${escHtml(p)}</li>`).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
${THEME}${PANEL_CSS}${BADGE_CSS}
body { padding: 24px; min-height: 100vh; }
.meta { margin-bottom: 16px; }
.meta-row { padding: 4px 0; color: var(--muted); font-size: 12px; }
.meta-row code { color: var(--peach); background: #45475a; padding: 2px 5px; border-radius: 3px; }
.meta-label { color: var(--text); font-weight: 600; }
.desc { color: var(--text); font-size: 13px; margin-bottom: 14px; line-height: 1.6; }
.points { padding-left: 18px; }
.points li { padding: 3px 0; color: var(--text); font-size: 12.5px; }
.filename { font-size: 14px; font-weight: 600; color: var(--accent); margin-bottom: 12px; }
</style></head><body>
<div class="panel">
  <div class="panel-header"><span class="icon">📐</span> Steering</div>
  <div class="panel-body">
    <div class="filename">${escHtml(filename)}</div>
    <div class="meta">
      <div class="meta-row"><span class="meta-label">Inclusion:</span> <span class="badge ${badgeCls}">${escHtml(inclusion)}</span></div>
      ${patternLine}
    </div>
    <div class="desc">${escHtml(description)}</div>
    <ul class="points">${points}</ul>
  </div>
</div>
</body></html>`;
}

function skillCardHtml({ name, description, phases, gateExample }) {
  const phaseItems = phases.map(p =>
    `<div class="phase"><span class="phase-num">${escHtml(p.num)}</span><span class="phase-name">${escHtml(p.name)}</span></div>`
  ).join("\n");
  const gateHtml = gateExample
    ? `<div class="gate"><span class="gate-icon">🚧</span> <span class="gate-text">${escHtml(gateExample)}</span></div>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
${THEME}${PANEL_CSS}
body { padding: 24px; min-height: 100vh; }
.skill-name { font-size: 16px; font-weight: 700; color: var(--accent); margin-bottom: 6px; }
.skill-desc { color: var(--muted); font-size: 12px; margin-bottom: 16px; line-height: 1.5; }
.phases { display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px; }
.phase { display: flex; align-items: center; gap: 10px; padding: 6px 10px;
  background: var(--bg); border-radius: 6px; border: 1px solid var(--border); }
.phase-num { font-weight: 700; color: var(--purple); min-width: 18px; }
.phase-name { color: var(--text); font-size: 12.5px; }
.gate { margin-top: 12px; padding: 10px 12px; background: #f38ba811;
  border: 1px solid #f38ba844; border-radius: 6px; }
.gate-icon { font-size: 14px; }
.gate-text { color: var(--yellow); font-size: 12px; }
</style></head><body>
<div class="panel">
  <div class="panel-header"><span class="icon">⚡</span> Skill</div>
  <div class="panel-body">
    <div class="skill-name">${escHtml(name)}</div>
    <div class="skill-desc">${escHtml(description)}</div>
    <div class="phases">${phaseItems}</div>
    ${gateHtml}
  </div>
</div>
</body></html>`;
}

function hooksGridHtml({ hooks }) {
  const cards = hooks.map(h => {
    const typeBadge = h.event === "preToolUse" ? "badge-always" : "badge-filematch";
    return `<div class="hook-card">
      <div class="hook-name">${escHtml(h.name)}</div>
      <div class="hook-meta">
        <span class="badge ${typeBadge}">${escHtml(h.event)}</span>
        <span class="hook-action">${escHtml(h.action)}</span>
      </div>
      <div class="hook-desc">${escHtml(h.desc)}</div>
      <div class="hook-pattern">${escHtml(h.pattern)}</div>
    </div>`;
  }).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
${THEME}${PANEL_CSS}${BADGE_CSS}
body { padding: 24px; min-height: 100vh; }
.hooks-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.hook-card { background: var(--bg); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px; }
.hook-name { font-weight: 600; color: var(--text); font-size: 12.5px; margin-bottom: 6px; }
.hook-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.hook-action { color: var(--purple); font-size: 11px; font-weight: 500; }
.hook-desc { color: var(--muted); font-size: 11px; line-height: 1.4; margin-bottom: 4px; }
.hook-pattern { color: var(--peach); font-size: 10.5px; font-family: monospace; }
</style></head><body>
<div class="panel">
  <div class="panel-header"><span class="icon">🪝</span> Agent Hooks</div>
  <div class="panel-body"><div class="hooks-grid">${cards}</div></div>
</div>
</body></html>`;
}

function agentCardHtml({ name, description, welcome, tools, resources }) {
  const resList = resources.map(r =>
    `<div class="res-item"><code>${escHtml(r)}</code></div>`
  ).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
${THEME}${PANEL_CSS}${BADGE_CSS}
body { padding: 24px; min-height: 100vh; }
.agent-name { font-size: 18px; font-weight: 700; color: var(--accent); margin-bottom: 4px; }
.agent-desc { color: var(--text); font-size: 13px; margin-bottom: 12px; }
.welcome { color: var(--muted); font-size: 12px; font-style: italic;
  padding: 10px 12px; background: var(--bg); border-radius: 6px;
  border-left: 3px solid var(--accent); margin-bottom: 16px; }
.section-title { font-weight: 600; color: var(--muted); font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
.tools-val { color: var(--green); font-size: 13px; margin-bottom: 16px; }
.res-item code { color: var(--peach); background: #45475a; padding: 3px 7px;
  border-radius: 4px; font-size: 12px; display: inline-block; margin: 2px 0; }
</style></head><body>
<div class="panel">
  <div class="panel-header"><span class="icon">🤖</span> Agent Configuration</div>
  <div class="panel-body">
    <div class="agent-name">${escHtml(name)}</div>
    <div class="agent-desc">${escHtml(description)}</div>
    <div class="welcome">${escHtml(welcome)}</div>
    <div class="section-title">Tools</div>
    <div class="tools-val">${escHtml(tools)}</div>
    <div class="section-title">Resources</div>
    ${resList}
  </div>
</div>
</body></html>`;
}

function mcpServersHtml({ servers }) {
  const rows = servers.map(s => {
    const statusCls = s.enabled ? "badge-enabled" : "badge-disabled";
    const statusText = s.enabled ? "enabled" : "disabled";
    return `<div class="mcp-row">
      <div class="mcp-name">${escHtml(s.name)}</div>
      <span class="badge ${statusCls}">${statusText}</span>
      <div class="mcp-type">${escHtml(s.type)}</div>
      <div class="mcp-purpose">${escHtml(s.purpose)}</div>
    </div>`;
  }).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
${THEME}${PANEL_CSS}${BADGE_CSS}
body { padding: 24px; min-height: 100vh; }
.mcp-row { display: grid; grid-template-columns: 140px 70px 90px 1fr;
  align-items: center; gap: 12px; padding: 10px 12px;
  border-bottom: 1px solid var(--border); }
.mcp-row:last-child { border-bottom: none; }
.mcp-name { font-weight: 600; color: var(--text); font-size: 13px; }
.mcp-type { color: var(--purple); font-size: 11.5px; }
.mcp-purpose { color: var(--muted); font-size: 12px; }
</style></head><body>
<div class="panel">
  <div class="panel-header"><span class="icon">🔌</span> MCP Servers</div>
  <div class="panel-body">${rows}</div>
</div>
</body></html>`;
}

function specsTimelineHtml({ specs }) {
  const items = specs.map(s => {
    const files = s.files.map(f =>
      `<span class="spec-file">${escHtml(f)}</span>`
    ).join(" ");
    return `<div class="spec-item">
      <div class="spec-dot"></div>
      <div class="spec-content">
        <div class="spec-name">${escHtml(s.name)}</div>
        <div class="spec-desc">${escHtml(s.desc)}</div>
        <div class="spec-files">${files}</div>
      </div>
    </div>`;
  }).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
${THEME}${PANEL_CSS}
body { padding: 24px; min-height: 100vh; }
.timeline { display: flex; flex-direction: column; gap: 0; padding-left: 16px;
  border-left: 2px solid var(--border); }
.spec-item { display: flex; align-items: flex-start; gap: 14px; padding: 14px 0;
  position: relative; }
.spec-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent);
  position: absolute; left: -22px; top: 18px; }
.spec-content { padding-left: 4px; }
.spec-name { font-weight: 600; color: var(--text); font-size: 13px; margin-bottom: 4px; }
.spec-desc { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
.spec-files { display: flex; flex-wrap: wrap; gap: 6px; }
.spec-file { background: #45475a; color: var(--peach); padding: 2px 7px;
  border-radius: 4px; font-size: 11px; font-family: monospace; }
</style></head><body>
<div class="panel">
  <div class="panel-header"><span class="icon">📋</span> Specs (build history)</div>
  <div class="panel-body"><div class="timeline">${items}</div></div>
</div>
</body></html>`;
}

function pdbScarHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
${THEME}${PANEL_CSS}${BADGE_CSS}
body { padding: 24px; min-height: 100vh; }
.hook-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
.hook-path { color: var(--muted); font-size: 11.5px; }
.rule-label { font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--muted); margin-bottom: 6px; }
.rule-title { font-size: 15px; font-weight: 700; color: var(--accent); margin-bottom: 10px; }
.strategy { color: var(--text); font-size: 12.5px; margin-bottom: 14px; line-height: 1.5; }
.strategy code { color: var(--peach); background: #45475a; padding: 1px 5px; border-radius: 3px; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.card { border-radius: 8px; padding: 12px; border: 1px solid var(--border); }
.card-ok { background: #a6e3a111; border-color: #a6e3a144; }
.card-bad { background: #f38ba811; border-color: #f38ba844; }
.card-h { font-weight: 700; font-size: 12.5px; margin-bottom: 6px; }
.card-ok .card-h { color: var(--green); }
.card-bad .card-h { color: var(--red); }
.card p { color: var(--text); font-size: 12px; line-height: 1.45; margin: 0; }
.card code { color: var(--peach); font-size: 11.5px; }
</style></head><body>
<div class="panel">
  <div class="panel-header"><span class="icon">🪝</span> Hook scar — PDB rule</div>
  <div class="panel-body">
    <div class="hook-meta">
      <span class="badge badge-filematch">fileEdited</span>
      <span class="badge badge-always">askAgent</span>
      <span class="hook-path">validate-app-scaffold.kiro.hook · rule 8</span>
    </div>
    <div class="rule-label">From Validate App Scaffold</div>
    <div class="rule-title">PDB &amp; rolling strategy</div>
    <div class="strategy">Deployments use <code>rollingUpdate</code>
      <code>maxUnavailable: 0</code> / <code>maxSurge: 1</code>. Then:</div>
    <div class="split">
      <div class="card card-ok">
        <div class="card-h">replicas ≥ 2</div>
        <p>Keep <code>poddisruptionbudget.yaml</code> with
        <code>minAvailable: 1</code>.</p>
      </div>
      <div class="card card-bad">
        <div class="card-h">replicas == 1</div>
        <p>Remove the PDB. <code>minAvailable: 1</code> with one replica
        blocks drains / node upgrades.</p>
      </div>
    </div>
  </div>
</div>
</body></html>`;
}

// === Screenshot helper ===
async function shot(page, html, outName, size = { width: 1280, height: 720 }, opts = {}) {
  const file = join(OUT, "_render", outName.replace(/\.png$/, ".html"));
  writeFileSync(file, html);
  // Tall viewport so content is never clipped before we measure / crop.
  const vpH = opts.fitPanel ? Math.max(size.height, 2400) : size.height;
  await page.setViewportSize({ width: size.width, height: vpH });
  await page.goto("file://" + file, { waitUntil: "load" });
  if (opts.fitPanel) {
    const panel = page.locator(".panel");
    await panel.screenshot({ path: join(OUT, outName), type: "png" });
  } else {
    await page.screenshot({ path: join(OUT, outName), type: "png" });
  }
  console.log("  wrote", outName);
}

// === Main ===
async function main() {
  console.log("Capturing .kiro/ config walkthrough stills...\n");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // --- 08: PDB scar (from validate-app-scaffold rule 8) ---
  await shot(page, pdbScarHtml(), "08-pdb-rule.png", { width: 780, height: 420 }, { fitPanel: true });

  // --- 14: .kiro/ explorer tree (full expanded tree, panel-fit) ---
  await shot(page, explorerTreeHtml({
    title: "KIRO-EKS-ARGOCD-MIGRATION / .kiro",
    items: [
      { name: ".kiro/", type: "folder", indent: 0 },
      { name: "steering/", type: "folder", indent: 1 },
      { name: "project-profile.md", type: "file", indent: 2, badge: "always", badgeClass: "badge-always" },
      { name: "gitops-conventions.md", type: "file", indent: 2, badge: "always", badgeClass: "badge-always" },
      { name: "workload-archetypes.md", type: "file", indent: 2, badge: "fileMatch", badgeClass: "badge-filematch" },
      { name: "identity-and-secrets.md", type: "file", indent: 2, badge: "fileMatch", badgeClass: "badge-filematch" },
      { name: "policy-validation.md", type: "file", indent: 2, badge: "fileMatch", badgeClass: "badge-filematch" },
      { name: "ci-workflows.md", type: "file", indent: 2, badge: "fileMatch", badgeClass: "badge-filematch" },
      { name: "skills/", type: "folder", indent: 1 },
      { name: "add-app/", type: "folder", indent: 2 },
      { name: "SKILL.md", type: "file", indent: 3 },
      { name: "migrate-workload/", type: "folder", indent: 2 },
      { name: "SKILL.md", type: "file", indent: 3 },
      { name: "references/", type: "folder", indent: 3 },
      { name: "discovery-checklist.md", type: "file", indent: 4 },
      { name: "iam-templates.md", type: "file", indent: 4 },
      { name: "manifest-patterns.md", type: "file", indent: 4 },
      { name: "promote-app/", type: "folder", indent: 2 },
      { name: "SKILL.md", type: "file", indent: 3 },
      { name: "manage-clusters/", type: "folder", indent: 2 },
      { name: "SKILL.md", type: "file", indent: 3 },
      { name: "hooks/", type: "folder", indent: 1 },
      { name: "block-infra-commands.kiro.hook", type: "file", indent: 2 },
      { name: "validate-app-scaffold.kiro.hook", type: "file", indent: 2 },
      { name: "validate-infra-scaffold.kiro.hook", type: "file", indent: 2 },
      { name: "kustomize-build-check.kiro.hook", type: "file", indent: 2 },
      { name: "kustomize-build-check-on-edit.kiro.hook", type: "file", indent: 2 },
      { name: "gator-test-on-create.kiro.hook", type: "file", indent: 2 },
      { name: "gator-test-on-edit.kiro.hook", type: "file", indent: 2 },
      { name: "policy-validate.kiro.hook", type: "file", indent: 2 },
      { name: "agents/", type: "folder", indent: 1 },
      { name: "eks-migration.json", type: "file", indent: 2 },
      { name: "settings/", type: "folder", indent: 1 },
      { name: "mcp.json", type: "file", indent: 2 },
      { name: "specs/", type: "folder", indent: 1 },
      { name: "initial-project-setup/", type: "folder", indent: 2 },
      { name: "requirements.md", type: "file", indent: 3 },
      { name: "design.md", type: "file", indent: 3 },
      { name: "tasks.md", type: "file", indent: 3 },
      { name: "gatekeeper-admission/", type: "folder", indent: 2 },
      { name: "requirements.md", type: "file", indent: 3 },
      { name: "design.md", type: "file", indent: 3 },
      { name: "tasks.md", type: "file", indent: 3 },
      { name: "README.md", type: "file", indent: 1 },
    ],
  }), "14-kiro-explorer-tree.png", { width: 760, height: 1400 }, { fitPanel: true });

  // --- 15: Steering overview (all 6 files with inclusion + purpose) ---
  await shot(page, steeringDetailHtml({
    filename: "project-profile.md",
    inclusion: "always",
    pattern: null,
    description: "Centralized values every other file references. Clusters, accounts, region, policy engine, identity mode, secrets backend. Change a value here, not in 40 places.",
    keyPoints: [
      "owner_label: platform — every Namespace and workload label",
      "aws_region: ap-southeast-2 — ECR, CSI, IAM ARNs",
      "policy_engine: gatekeeper — turns on policy hooks + gator path",
      "identity_mode: pod-identity — shape of iam.tf",
      "secrets_backend: secrets-store-csi — SPC vs External Secrets",
      "Clusters: dev-eks-1 (111122223333) / prod-eks-1 (444455556666)",
      "Placeholder accounts — grep before live IAM/image push",
    ],
  }), "15-steering-profile.png", { width: 800, height: 580 }, { fitPanel: true });

  // --- 16: Steering inclusion comparison ---
  await shot(page, steeringDetailHtml({
    filename: "workload-archetypes.md",
    inclusion: "fileMatch",
    pattern: "apps/**/*.yaml, apps/**/*.yml, apps/**/*.md",
    description: "Five archetypes (web-service, worker, queue-worker, scheduled-job, helm-chart) and what each requires. Loaded only when editing app files — not on cluster or CI work.",
    keyPoints: [
      "web-service: Deployment + Service + Ingress + probes",
      "worker: Deployment only, no inbound traffic",
      "queue-worker: Deployment + ScaledObject + TriggerAuthentication",
      "scheduled-job: CronJob, concurrencyPolicy: Forbid",
      "helm-chart: Application pointing at vendored chart",
      "Always required: app_name, archetype, source image",
      "Hardening: resources, NetworkPolicy deny-first, labels",
    ],
  }), "16-steering-archetypes.png", { width: 800, height: 580 }, { fitPanel: true });

  // --- 17: Skills overview (all 4) ---
  await shot(page, skillCardHtml({
    name: "add-app",
    description: "Scaffold a new application in this repo as Kustomize base and overlay plus an Argo CD Application. Use when the user wants to add a new app, create a new service, onboard a workload, add a cluster overlay to an existing app, or deploy something new through Argo CD.",
    phases: [
      { num: "1", name: "Gather inputs (archetype + required fields)" },
      { num: "2", name: "Resolve image into project ECR" },
      { num: "3", name: "Scaffold base (namespace, application, manifests)" },
      { num: "4", name: "Scaffold both overlays (dev-eks-1 + prod-eks-1)" },
      { num: "5", name: "Declare IAM (iam.tf) if app calls AWS" },
      { num: "6", name: "README + renovate.json" },
      { num: "7", name: "Validate (kustomize + gator + markdownlint)" },
    ],
    gateExample: "Gate: kustomize build + policy validation must pass before commit",
  }), "17-skill-add-app.png", { width: 740, height: 640 }, { fitPanel: true });

  // --- 18: migrate-workload skill ---
  await shot(page, skillCardHtml({
    name: "migrate-workload",
    description: "Migrate a workload running on EC2, ECS, Docker Compose, or a virtual machine onto EKS managed by Argo CD. Use when the user asks to migrate, move, port, containerise, or modernise an existing application.",
    phases: [
      { num: "0", name: "Discover — inventory runtime, ports, env, secrets, IAM" },
      { num: "1", name: "Containerise — Dockerfile, multi-stage, non-root" },
      { num: "2", name: "Publish — retag into project ECR, record digest" },
      { num: "3", name: "Cluster readiness — controllers, CRDs present" },
      { num: "4", name: "Identity & secrets — iam.tf + SecretProviderClass" },
      { num: "5", name: "Manifests — calls add-app with inventory in hand" },
      { num: "6", name: "Validate — kustomize + gator offline" },
      { num: "7", name: "Promote & cut over — DNS shift, keep rollback" },
    ],
    gateExample: "Gate: each phase blocks until previous gate passes. Source stays live until Phase 7.",
  }), "18-skill-migrate.png", { width: 740, height: 680 }, { fitPanel: true });

  // --- 19: Hooks grid ---
  await shot(page, hooksGridHtml({
    hooks: [
      { name: "Block Infrastructure Commands", event: "preToolUse", action: "askAgent",
        desc: "Fail-closed gate: refuse mutating cluster/cloud apply",
        pattern: "toolTypes: [shell]" },
      { name: "Validate App Scaffold", event: "fileEdited", action: "askAgent",
        desc: "Check complete tree: base, both overlays, labels, NetPol, probes, PDB",
        pattern: "apps/**/*.yaml, *.tf, *.md" },
      { name: "Validate Infra Scaffold", event: "fileEdited", action: "askAgent",
        desc: "Both clusters stay in step, ApplicationSets aligned",
        pattern: "bootstrap/**, clusters/**, infrastructure/**" },
      { name: "Kustomize Build Check", event: "fileCreated", action: "askAgent",
        desc: "Build kustomization directory on create",
        pattern: "apps/**/kustomization.yaml" },
      { name: "Kustomize Build Check on Edit", event: "fileEdited", action: "askAgent",
        desc: "Rebuild kustomization directory on edit",
        pattern: "apps/**/kustomization.yaml" },
      { name: "Gator Test on Create", event: "fileCreated", action: "askAgent",
        desc: "Run gator test on new workload manifests",
        pattern: "apps/**/manifests/**/*.yaml" },
      { name: "Gator Test on Edit", event: "fileEdited", action: "askAgent",
        desc: "Re-run gator test after manifest edits",
        pattern: "apps/**/manifests/**/*.yaml" },
      { name: "Policy Validate", event: "fileEdited", action: "askAgent",
        desc: "Validate resources, NetPol, probes, PDB, secrets wiring",
        pattern: "apps/**/manifests/**/*.yaml" },
    ],
  }), "19-hooks-grid.png", { width: 1100, height: 680 }, { fitPanel: true });

  // --- 20: Agent card ---
  await shot(page, agentCardHtml({
    name: "eks-migration",
    description: "Migrates workloads onto EKS managed by Argo CD, following the gated migration workflow.",
    welcome: "EKS migration agent. Tell me what to migrate, for example: migrate the app in ./src to EKS.",
    tools: '["*"]  (all tools — hooks constrain what is allowed)',
    resources: [
      "file://.kiro/steering/*.md",
      "skill://.kiro/skills/*/SKILL.md",
    ],
  }), "20-agent-config.png", { width: 740, height: 520 }, { fitPanel: true });

  // --- 21: MCP servers ---
  await shot(page, mcpServersHtml({
    servers: [
      { name: "aws-knowledge", enabled: true, type: "HTTP",
        purpose: "AWS docs and service behaviour (no cluster creds)" },
      { name: "eks", enabled: false, type: "uvx proxy",
        purpose: "Cluster inspect, read-only (needs AWS_PROFILE)" },
      { name: "kubernetes", enabled: false, type: "npx",
        purpose: "Live K8s state, non-destructive only" },
      { name: "filesystem", enabled: true, type: "npx",
        purpose: "Local file tree access" },
    ],
  }), "21-mcp-servers.png", { width: 820, height: 380 }, { fitPanel: true });

  // --- 22: Specs timeline ---
  await shot(page, specsTimelineHtml({
    specs: [
      { name: "initial-project-setup",
        desc: "Clusters, bootstrap, empty apps/, ApplicationSets, CI workflows",
        files: ["requirements.md", "design.md", "tasks.md"] },
      { name: "gatekeeper-admission",
        desc: "Vendor chart, policies bundle, gator pin, CI policy-validate job",
        files: ["requirements.md", "design.md", "tasks.md"] },
    ],
  }), "22-specs-timeline.png", { width: 740, height: 380 }, { fitPanel: true });

  await browser.close();
  console.log("\nDone. All .kiro config stills captured.");
}

main().catch((e) => { console.error(e); process.exit(1); });
