    # Implementation Plan: Initial Project Setup

## Overview

Finish the foundational platform scaffolding. Agent config (`.kiro/`), CI workflows
(`.github/workflows/`), validation scripts (`scripts/`), and root docs already exist.
What remains is the in-repo GitOps surface: ApplicationSets under `clusters/`, Argo CD
bootstrap placeholders under `bootstrap/`, and an empty `apps/` tree so discovery and CI
have a stable root.

This plan does **not** scaffold a first application — that is `add-app` / Phase 5 of
`migrate-workload` after the platform dirs exist.

## Already complete (do not redo)

| Area | Status |
| --- | --- |
| `.kiro/steering/` (profile, gitops, identity, archetypes, policy, CI) | Done |
| `.kiro/skills/` (`migrate-workload`, `add-app`, `promote-app`, `manage-clusters`) | Done |
| `.kiro/hooks/` (kustomize, policy, scaffold) | Done |
| `.kiro/settings/mcp.json`, `.kiro/agents/eks-migration.json` | Done |
| Specs (`requirements.md`, `design.md`) | Done |
| `.github/workflows/` (`kustomize-build`, `markdown-lint`, `commitmsg-conform`) | Done |
| `scripts/expand-pod-templates.py`, `scripts/gatekeeper-gator-test.sh` | Done |
| Root `README.md`, `.markdownlint.json`, `LICENSE` | Done |

## Tasks

- [x] 1. Create cluster configuration with ApplicationSets
  - [x] 1.1 Create `clusters/dev-eks-1/applicationset.yaml`
    - `metadata.name: apps-dev-eks-1`, `metadata.namespace: argocd`
    - Git directory generator: `path: apps/*/overlays/dev-eks-1`, `revision: main`
    - Template Application name: `{{path.segments.[1]}}-dev-eks-1` (app name = path
      segment under `apps/`)
    - `spec.source.path: "{{path.path}}"` (discovered overlay directory)
    - `spec.project: default`, `destination.name: in-cluster`,
      `destination.namespace: "{{path.segments.[1]}}"`
    - `source.targetRevision: main`
    - Automated sync: `prune: true`, `selfHeal: true`
    - `syncOptions: [CreateNamespace=true]`
    - `repoURL: https://github.com/jajera/kiro-eks-argocd-migration.git` (both generator
      and template source)
    - Matches design ApplicationSet contract (Correctness P3)
    - _Requirements: 1.3, 2.1, 3.1–3.6, 14.1_

  - [x] 1.2 Create `clusters/prod-eks-1/applicationset.yaml`
    - Same shape as 1.1 with cluster `prod-eks-1`
    - Discover `apps/*/overlays/prod-eks-1`
    - Name generated Applications `<app>-prod-eks-1`
    - Same `repoURL` and sync policy as task 1.1
    - _Requirements: 1.3, 2.2, 3.1–3.6, 14.1_

- [x] 2. Create bootstrap configuration
  - [x] 2.1 Create `bootstrap/dev-eks-1/README.md`
    - Document that this directory holds Argo CD install manifests and root resources
      for `dev-eks-1`
    - Note bootstrap is applied manually (or via a separate process), not by Argo CD
      itself
    - Record cluster `dev-eks-1`, account `111122223333`, region `ap-southeast-2`
    - Leave room for install manifests when the cluster is provisioned; no fake Helm
      values required now
    - _Requirements: 1.2, 2.1, 14.1_

  - [x] 2.2 Create `bootstrap/prod-eks-1/README.md`
    - Same as 2.1 for `prod-eks-1`, account `444455556666`, region `ap-southeast-2`
    - _Requirements: 1.2, 2.2, 14.1_

- [x] 3. Create apps directory placeholder
  - [x] 3.1 Create `apps/.gitkeep`
    - Establishes `apps/` in version control so layout and CI have a stable root
    - Do **not** add a sample app; future apps use `add-app` with both overlays +
      optional `iam.tf`
    - Confirm `kustomize-build.yml` still skips cleanly when no `kustomization.yaml`
      roots exist (Correctness P13)
    - _Requirements: 1.1, 1.5, 8.4_

- [x] 4. Checkpoint — validate scaffolding completeness
  - Ensure all checks below pass; ask the user if questions arise
  - [x] 4.1 YAML: both ApplicationSets parse (`python3 -c 'import yaml; …'` or
        `kubectl apply --dry-run=client` if available)
  - [x] 4.2 Layout: `clusters/{dev,prod}-eks-1/applicationset.yaml`,
        `bootstrap/{dev,prod}-eks-1/README.md`, `apps/.gitkeep` exist
  - [x] 4.3 Contract: Application names are `<app>-<cluster>`; paths are overlay dirs;
        destination `in-cluster`; project `default`; revision `main`
  - [x] 4.4 CI: with empty `apps/` (only `.gitkeep`), kustomize job logic skips without
        failing (local dry-run of the workflow `find`/`skip` branch is enough)
  - [x] 4.5 Docs: root `README.md` layout section still matches the on-disk tree
  - _Requirements: 1.*, 3.*, 8.4, 14.1 — Correctness P3, P13_

## Notes

- Do not recreate or restructure `.kiro/`, `.github/workflows/`, or `scripts/` as part of
  these tasks unless a checkpoint finds a real defect
- No full Terraform root or `templates/app-terraform/` — IAM stays as per-app `iam.tf`
  snippets (see identity steering)
- No Kyverno; `policy_engine` defaults to `none` (Gatekeeper optional later)
- Account IDs `111122223333` / `444455556666` are documentation placeholders; replace
  when real accounts are known (project-profile + any committed ApplicationSet comments)
- ECR repos are assumed to exist outside this repo; do not add ECR creation tasks here
- Bootstrap READMEs are placeholders; real Argo CD install manifests land when clusters
  exist (`manage-clusters` skill)
- Property-based unit tests do not apply — structural validation and CI skip behaviour
  only

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.2", "3.1"] },
    { "id": 1, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5"], "needs": [0] }
  ]
}
```
