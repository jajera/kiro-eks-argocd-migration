#!/usr/bin/env node
/**
 * Capture walkthrough stills with Playwright where automation is possible.
 *
 * Usage (from docs/media/walkthrough):
 *   node capture.mjs
 *
 * Writes: 01 (repo tree), 09 (gator), 13 (PR checks).
 * Lab B panels: capture-kiro-configs.mjs.
 * Lab C stills: from recording (skipped if files already exist).
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const REPO = join(__dirname, "../../..");
const GH = "https://github.com/jajera/kiro-eks-argocd-migration";

mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "_render"), { recursive: true });

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...opts,
  });
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function terminalHtml({ title, cwd, lines, compact = false }) {
  const body = lines
    .map((l) => {
      const cls = l.startsWith("$ ")
        ? "cmd"
        : /\bok\b|\bPASS\b|OK|success/i.test(l)
          ? "ok"
          : /\berror\b|\bFAIL\b/i.test(l)
            ? "err"
            : "";
      return `<div class="line ${cls}">${escapeHtml(l)}</div>`;
    })
    .join("\n");
  const termMin = compact ? "" : "min-height:520px;";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><style>
  html,body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .bar{display:flex;gap:8px;align-items:center;padding:10px 14px;background:#161b22;border-bottom:1px solid #30363d}
  .dot{width:10px;height:10px;border-radius:50%}
  .r{background:#ff5f56}.y{background:#ffbd2e}.g{background:#27c93f}
  .title{color:#8b949e;font-size:12px;margin-left:8px}
  .term{padding:16px 18px;${termMin}}
  .cwd{color:#8b949e;margin-bottom:10px}
  .cmd{color:#79c0ff}
  .ok{color:#3fb950}
  .err{color:#ff7b72}
  .line{white-space:pre-wrap;word-break:break-word}
</style></head><body>
  <div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
  <span class="title">${escapeHtml(title)}</span></div>
  <div class="term"><div class="cwd">${escapeHtml(cwd)}</div>${body}</div>
</body></html>`;
}

async function shotLocal(page, html, outName, size = { width: 1280, height: 720 }, opts = {}) {
  const file = join(OUT, "_render", outName.replace(/\.png$/, ".html"));
  writeFileSync(file, html);
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto("file://" + file, { waitUntil: "load" });
  if (opts.fullPage) {
    const contentH = await page.evaluate(() => {
      const body = document.body;
      return Math.ceil(Math.max(body.scrollHeight, body.offsetHeight));
    });
    await page.setViewportSize({
      width: size.width,
      height: Math.max(contentH, 100),
    });
    await page.screenshot({ path: join(OUT, outName), type: "png" });
  } else {
    await page.screenshot({ path: join(OUT, outName), type: "png" });
  }
  console.log("wrote", outName);
}

async function dismissGithubChrome(page) {
  for (const sel of [
    'button:has-text("Accept")',
    'button:has-text("Accept all")',
    '[data-testid="cookie-banner-accept"]',
  ]) {
    try {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 1500 })) await b.click();
    } catch {
      /* ignore */
    }
  }
}

async function shotGithub(page, url, outName, opts = {}) {
  await page.setViewportSize(opts.size || { width: 1400, height: 900 });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await dismissGithubChrome(page);
  await page.waitForTimeout(1500);
  if (opts.clickTab) {
    try {
      await page.locator(opts.clickTab).first().click({ timeout: 5000 });
      await page.waitForTimeout(1200);
    } catch {
      console.warn("tab click missed for", outName);
    }
  }
  // Prefer the code blob / main content if present
  const clipSel = opts.clip || null;
  if (clipSel) {
    const loc = page.locator(clipSel).first();
    if (await loc.count()) {
      await loc.screenshot({ path: join(OUT, outName), type: "png" });
      console.log("wrote", outName, "(element)");
      return;
    }
  }
  await page.screenshot({ path: join(OUT, outName), type: "png", fullPage: false });
  console.log("wrote", outName, "(viewport)");
}

async function main() {
  const treeClean = sh("tree -a -L 2 -I '.git|node_modules|_render' --dirsfirst");

  let gatorOut;
  try {
    gatorOut = sh("gator verify infrastructure/gatekeeper/tests/...");
  } catch (e) {
    gatorOut = (e.stdout || "") + (e.stderr || "") + String(e);
  }
  const gatorVer = sh("gator version 2>&1 | head -20");

  // 08-pdb-rule.png + Lab B panels: capture-kiro-configs.mjs

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 01 tree — fullPage so L2 listing is never clipped
  await shotLocal(
    page,
    terminalHtml({
      title: "repo tree — kiro-eks-argocd-migration",
      cwd: "~/workspace/jajera/kiro-eks-argocd-migration",
      compact: true,
      lines: [
        "$ tree -a -L 2 -I '.git|node_modules' --dirsfirst",
        ...treeClean.trimEnd().split("\n"),
      ],
    }),
    "01-repo-tree.png",
    { width: 900, height: 720 },
    { fullPage: true },
  );

  // Lab C stills (07/10/10b/11/12-add-app-done) come from the recording —
  // do not regenerate placeholders over them unless FORCE_LAB_C_PLACEHOLDERS=1
  for (const [name, title, hint] of [
    [
      "10-vibe-mode.png",
      "PLACEHOLDER · 10-vibe-mode.png",
      "Kiro: Vibe vs Spec session picker",
    ],
    [
      "10-add-app-session.png",
      "PLACEHOLDER · 10-add-app-session.png",
      "Kiro: thin add-app prompt",
    ],
    [
      "10b-add-app-scaffolding.png",
      "PLACEHOLDER · 10b-add-app-scaffolding.png",
      "Kiro: scaffolding apps/demo-nginx",
    ],
    [
      "07-block-infra-denied.png",
      "PLACEHOLDER · 07-block-infra-denied.png",
      "Kiro: Block Infrastructure Commands hook",
    ],
    [
      "11-kustomize-build.png",
      "PLACEHOLDER · 11-kustomize-build.png",
      "Kiro: kustomize + markdownlint pass",
    ],
    [
      "12-add-app-done.png",
      "PLACEHOLDER · 12-add-app-done.png",
      "Kiro: dual overlays + summary",
    ],
  ]) {
    const outPath = join(OUT, name);
    if (existsSync(outPath) && !process.env.FORCE_LAB_C_PLACEHOLDERS) {
      console.log("skip", name, "(exists — FORCE_LAB_C_PLACEHOLDERS=1 to reset)");
      continue;
    }
    await shotLocal(
      page,
      `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
        html,body{margin:0;background:#0d1117;color:#e6edf3;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
        .box{max-width:40rem;padding:2rem;border:1px dashed #388bfd;border-radius:12px;background:#161b22}
        .tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#0d1117;background:#f0c14b;padding:3px 8px;border-radius:4px;margin-bottom:12px}
        h1{font-size:1.05rem;margin:0 0 .75rem;color:#79c0ff;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
        p{margin:0;color:#8b949e}
      </style></head><body><div class="box"><div class="tag">Replace this file</div><h1>${title}</h1><p>${hint}</p></div></body></html>`,
      name,
      { width: 1100, height: 480 },
    );
  }

  // 08-pdb-rule.png: capture-kiro-configs.mjs (do not overwrite with JSON dump)

  // 09 gator — content-height (no empty band under PASS)
  await shotLocal(
    page,
    terminalHtml({
      title: "gator verify — offline Gatekeeper suites",
      cwd: "~/…/kiro-eks-argocd-migration",
      compact: true,
      lines: [
        "$ gator version | head -5",
        ...gatorVer.trimEnd().split("\n").slice(0, 8),
        "",
        "$ gator verify infrastructure/gatekeeper/tests/...",
        ...gatorOut.trimEnd().split("\n"),
      ],
    }),
    "09-gator-verify.png",
    { width: 1100, height: 720 },
    { fullPage: true },
  );

  // GitHub: PR checks (13)
  try {
    // PR #2 is the initial-commit merge that ran all four required workflows.
    await shotGithub(
      page,
      `${GH}/pull/2/checks`,
      "13-pr-checks.png",
      { size: { width: 1440, height: 900 } },
    );
  } catch (e) {
    console.warn("13-pr-checks.png GitHub capture failed:", e.message);
    await shotLocal(
      page,
      terminalHtml({
        title: "CI workflows (from gh run list)",
        cwd: "jajera/kiro-eks-argocd-migration",
        lines: sh(
          "gh run list --repo jajera/kiro-eks-argocd-migration --limit 8",
        )
          .trimEnd()
          .split("\n")
          .flatMap((l, i) =>
            i === 0
              ? [
                  "$ gh run list --repo jajera/kiro-eks-argocd-migration --limit 8",
                  l,
                ]
              : [l],
          ),
      }),
      "13-pr-checks.png",
    );
  }

  await browser.close();

  console.log(
    "\nCaptured auto stills (01, 09, 13). Lab B: capture-kiro-configs.mjs. Lab C: recording stills.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
