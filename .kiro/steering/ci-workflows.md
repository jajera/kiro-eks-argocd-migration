---
inclusion: fileMatch
fileMatchPattern: [".github/workflows/**", ".github/*.json"]
---

# CI Workflows

## In this repo

| Workflow | Purpose |
| --- | --- |
| `markdown-lint.yml` | Markdown lint on pull requests |
| `commitmsg-conform.yml` | Commit message conformance on pull requests |
| `kustomize-build.yml` | Builds every `apps/*/base` and `apps/*/overlays/*` kustomization root; excludes `vendored/`; skips cleanly when `apps/` is empty |

## Recommended as the repo grows

| Workflow | Purpose |
| --- | --- |
| `yaml-lint` | `yamllint` against a checked-in `.yamllint` config |
| `policy-validate` | Run the same policy checks the agent runs locally |
| `renovate-config-validate` | Validate `.github/renovate.json` and any per-app `renovate.json` |

Keep CI and the local hooks running the *same* scripts. When they drift, the local check
passes and CI fails, and people stop trusting the local check.

## Policy validation in CI

The policy bundle usually lives outside this repo. If it is in a private repo, check it
out with a token scoped to read-only access on that one repository, and pass the token
only to that checkout step — never to the whole job.

Prefer a per-cluster policy bundle when one exists, falling back to a base bundle, so
that a cluster with stricter enforcement is validated against its own rules.

## Image digest updates

When overlays pin digests, configure Renovate to bump them. Keep the pin in one file per
app so the bump is a one-line diff, and give each app its own `renovate.json` extended
from the root config rather than accumulating rules in a single file.

## Branch hygiene

If a workflow rewrites `targetRevision` after merge to keep committed manifests pointing
at the default branch, treat it as a safety net rather than a licence to commit feature
branch names. Argo CD will happily sync from whatever ref is committed.
