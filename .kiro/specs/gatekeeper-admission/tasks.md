# Implementation Plan: Gatekeeper Admission

## Overview

Add the full OPA Gatekeeper admission stack adapted from kube-infra. Bottom-up order:
vendor the Helm chart → operator base → ConstraintTemplates + Constraints → operator
overlays → `policies/` bundle → gator suites → CI → bootstrap docs → flip
`policy_engine`.

No apps, no live cluster apply, no kube-infra CI checkout.

## Tasks

- [x] 1. Vendor Helm chart and create operator base
  - [x] 1.1 Vendor Gatekeeper Helm chart 3.21.1
    - Create `infrastructure/gatekeeper/base/vendored/chart/gatekeeper/` with chart
      contents (`helm pull gatekeeper --repo https://open-policy-agent.github.io/gatekeeper/charts --version 3.21.1 --untar` or equivalent)
    - Create `infrastructure/gatekeeper/base/vendored/README.md` with upstream URL,
      pinned version `3.21.1`, and the exact pull command used
    - _Requirements: 1.4, 12.4_

  - [x] 1.2 Create operator base manifests
    - Create `infrastructure/gatekeeper/base/namespace.yaml`: `gatekeeper-system`,
      labels `name` + `owner: platform`, sync-wave `-1`
    - Create `infrastructure/gatekeeper/base/application.yaml`: Operator Application —
      `project: default`, `destination.name: in-cluster`, namespace
      `gatekeeper-system`, Git `repoURL` this repo, `targetRevision: main`, `path` to
      vendored chart, sync-wave `0`, automated prune+selfHeal, `CreateNamespace=true`,
      Helm values from design (webhook timeouts, `syncVAPEnforcementScope`,
      readiness/liveness timeouts, resources), CRD-only `ignoreDifferences`
    - Create `infrastructure/gatekeeper/base/kustomization.yaml` listing
      `namespace.yaml` and `application.yaml`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9, 11.1, 11.2_

- [x] 2. Create ConstraintTemplates
  - [x] 2.1 Add all 14 ConstraintTemplate YAML files under
        `infrastructure/gatekeeper/constraint-templates/`
    - Adapt from kube-infra (do not invent Rego): `containerlimits`, `requiredlabels`,
      `disallow-default-namespace`, `allow-privilege-escalation`,
      `networkpolicy-egress-defined`, `ingress-wafv2-public-alb`, `httpsonly`,
      `disallowedtags`, `block-nodeport-services`, `privileged-containers`,
      `host-namespaces`, `host-filesystem`, `disallowanonymous`, `verifydeprecatedapi`
    - Each: `apiVersion: templates.gatekeeper.sh/v1`, unique
      `spec.crd.spec.names.kind`, Rego in `spec.targets`
    - _Requirements: 2.1, 2.2, 2.4, 12.1_

  - [x] 2.2 Add `constraint-templates/kustomization.yaml` listing all 14 files
    - Verify: `kustomize build infrastructure/gatekeeper/constraint-templates/` exits 0
      and emits 14 ConstraintTemplates
    - _Requirements: 2.3, 2.5_

- [x] 3. Create Constraints
  - [x] 3.1 Add all 14 `constraints/<name>/` dirs (same names as templates)
    - Each: `constraint.yaml` + `kustomization.yaml` (local `constraint.yaml` only)
    - `containerlimits` → `deny`; all others → `dryrun`
    - `ingress-wafv2-public-alb` stays dryrun with comment: deny gated on real WAFv2 ACL
      ARNs
    - Kind must match template CRD kind; `owner: platform` on every Constraint
    - Pod/Namespace matchers: `excludedNamespaces` for `kube-system`,
      `gatekeeper-system`, `argocd`, plus common EKS add-on namespaces used here
      (no Kyverno/KEDA — not installed in this repo)
    - `requiredlabels`: require key `owner` with regex accepting `platform` (not
      hard-coded `devops`)
    - _Requirements: 3.1–3.8, 11.5, 11.6, 12.1_

- [x] 4. Checkpoint — templates and constraints
  - `kustomize build infrastructure/gatekeeper/constraint-templates/` exits 0
  - Spot-check one Constraint `kind` against its template
  - Ask the user if questions arise

- [x] 5. Create operator overlays (both clusters)
  - [x] 5.1 `infrastructure/gatekeeper/overlays/dev-eks-1/`
    - `kustomization.yaml` → `../../base` + `application-policies.yaml`
    - `application-patch.yaml` if needed (cluster-specific operator tweaks)
    - `application-policies.yaml`: Policies Application — path
      `policies/overlays/dev-eks-1`, this repo URL, `targetRevision: main`, sync-wave
      `2`, `project: default`, `destination.name: in-cluster`,
      `destination.namespace: ""`, prune+selfHeal, `owner: platform`,
      `ignoreDifferences` for each Constraint kind + ConstraintTemplate `.status`
      (not `kind: "*"`)
    - _Requirements: 1.2, 1.6, 1.7, 6.3, 11.2–11.4_

  - [x] 5.2 `infrastructure/gatekeeper/overlays/prod-eks-1/`
    - Same shape as 5.1 with `policies/overlays/prod-eks-1`
    - _Requirements: 1.2, 1.6, 7.4_

- [x] 6. Create policy bundle
  - [x] 6.1 `policies/base/kustomization.yaml`
    - Aggregate via relative dir refs:
      `../../infrastructure/gatekeeper/constraint-templates` and each
      `../../infrastructure/gatekeeper/constraints/<name>`
    - Verify: `kustomize build policies/base` → 14 templates + 14 constraints
    - _Requirements: 4.1, 4.3, 4.5, 12.5_

  - [x] 6.2 `policies/overlays/dev-eks-1/kustomization.yaml`
    - Ref `../../base`; patches: templates wave `1`; constraints wave `2` +
      `SkipDryRunOnMissingResource=true`; promote `namespaces-must-have-owner` and
      `disallow-default-namespace` to `deny`; do **not** promote WAF
    - Verify build exits 0
    - _Requirements: 4.2, 4.6, 4.7, 6.4, 6.5_

  - [x] 6.3 `policies/overlays/prod-eks-1/kustomization.yaml`
    - Same promotions and waves as the dev-eks-1 overlay
    - Verify build exits 0
    - _Requirements: 4.2, 4.6, 4.7_

- [x] 7. Checkpoint — policy bundle
  - Build `policies/base`, both overlays
  - Confirm promoted Constraints are `deny`; WAF remains `dryrun`
  - Confirm `scripts/gatekeeper-gator-test.sh` default `$repo_root/policies` resolves
  - Ask the user if questions arise

- [x] 8. Create gator verify suites
  - [x] 8.1 Suites for all 14 constraints under
        `infrastructure/gatekeeper/tests/<name>/`
    - `suite.yaml`, `pass.yaml`, `fail.yaml` (adapt from kube-infra)
    - Pod-matching constraints: bare `kind: Pod` objects
    - _Requirements: 5.1, 5.2, 5.5, 12.1_

  - [x] 8.2 Run `gator verify infrastructure/gatekeeper/tests/...`
    - Required when `gator` is on PATH; if missing, record skip and continue (CI will
      enforce)
    - Fix failing suites until exit 0
    - _Requirements: 5.3, 5.4, 5.6_

- [x] 9. Create CI workflow
  - [x] 9.1 `.github/workflows/policy-validate.yml`
    - PR paths: `infrastructure/gatekeeper/**`, `policies/**`,
      `scripts/gatekeeper-gator-test.sh`, `scripts/expand-pod-templates.py`,
      `.github/workflows/policy-validate.yml`
    - `permissions: contents: read`; pin `actions/checkout` by SHA (like
      `kustomize-build.yml`)
    - Install **gator CLI** pin separate from chart (e.g. `3.22.0` to match kube-infra),
      checksum-verified; fail if install fails
    - `gator verify infrastructure/gatekeeper/tests/...`; skip exit 0 if tests missing
    - Comment: add `gator test` on `apps/**` once apps exist
    - Do not replace `markdown-lint.yml` / `commitmsg-conform.yml`
    - _Requirements: 10.1–10.8_

- [x] 10. Update bootstrap documentation
  - [x] 10.1 Update `bootstrap/dev-eks-1/README.md` and `bootstrap/prod-eks-1/README.md`
    - Document root Application syncing
      `infrastructure/gatekeeper/overlays/<cluster>/`
    - Apply order: Argo CD healthy → operator overlay → Policies Application
    - Gatekeeper must not be applied before Argo CD; Git-only until clusters exist
    - `in-cluster`, `project: default`, `targetRevision: main`
    - _Requirements: 7.1–7.5_

- [x] 11. Update steering and docs
  - [x] 11.1 Set `policy_engine: gatekeeper` in
        `.kiro/steering/project-profile.md` (and constraints blurb)
    - Only after `policies/base` builds successfully
    - _Requirements: 8.1, 8.6_

  - [x] 11.2 Align hooks / steering / READMEs
    - Confirm `policy-validate` and `validate-infra-scaffold` paths (no parallel checker)
    - Document apply order in policy-validation and/or manage-clusters steering
    - Update root / `.kiro` README so `POLICY_DIR` / `policy_engine` match in-repo
      `policies/`
    - _Requirements: 8.2–8.6_

- [x] 12. Final checkpoint
  - `kustomize build` on constraint-templates, `policies/base`, both policy overlays,
    and both operator overlays
  - `gator verify` if tooling present
  - No kube-infra paths in CI, scripts, or policy refs
  - Vendored chart present; WAF still dryrun; `owner: platform` only
  - Ask the user if questions arise
  - _Requirements: P1–P5 / 12.x_

- [x] 13. Reproducible gator CLI pin
  - [x] 13.1 Document gator **3.22.0** + SHA-256s; `scripts/install-gator.sh` is pin SOT
  - [x] 13.2 CI runs `scripts/install-gator.sh` then `gator verify` (no duplicated SHA)
  - [x] 13.3 Confirm hooks still call `gator verify` /
        `scripts/gatekeeper-gator-test.sh` (no parallel path)
  - [x] 13.4 Templates include `openAPIV3Schema` for parameters; `gator verify` PASS on pin
  - _Requirements: 13.1–13.7_

## Notes

- Adapt from `~/workspace/k8sforge/kube-infra/infrastructure/gatekeeper/` — do not copy
  `devops` owner, CodeConnections URLs, or `eks-*` overlay names
- `scripts/gatekeeper-gator-test.sh` needs no behavioural change once `policies/` exists
- Chart version **3.21.1** ≠ gator CLI version **3.22.0** — bump both docs + CI SHA together
- Task 8.2 is skippable locally without `gator`; CI must still run verify
- Checkpoints are mandatory gates before the next wave

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"], "needs": [0] },
    { "id": 2, "tasks": ["2.1", "3.1"], "needs": [1] },
    { "id": 3, "tasks": ["2.2", "4"], "needs": [2] },
    { "id": 4, "tasks": ["5.1", "5.2", "6.1"], "needs": [3] },
    { "id": 5, "tasks": ["6.2", "6.3"], "needs": [4] },
    { "id": 6, "tasks": ["7"], "needs": [5] },
    { "id": 7, "tasks": ["8.1", "9.1", "10.1"], "needs": [6] },
    { "id": 8, "tasks": ["8.2"], "needs": [7] },
    { "id": 9, "tasks": ["11.1", "11.2"], "needs": [6, 8] },
    { "id": 10, "tasks": ["12"], "needs": [9] },
    { "id": 11, "tasks": ["13.1", "13.2", "13.3"], "needs": [10] }
  ]
}
```
