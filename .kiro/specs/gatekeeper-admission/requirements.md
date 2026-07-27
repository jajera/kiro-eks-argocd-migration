# Requirements Document

## Introduction

Add the full OPA Gatekeeper admission policy stack to this standalone repo so admission
constraints are defined, locally validatable with `gator`, and ready to enforce on both
clusters before any application scaffolds land under `apps/`. The stack is adapted from
`kube-infra/infrastructure/gatekeeper` and must be self-contained in this repository.

## Glossary

- **Gatekeeper**: The OPA Gatekeeper admission controller, deployed via Helm into the
  `gatekeeper-system` namespace.
- **Operator_Application**: The Argo CD Application that installs the Gatekeeper Helm
  chart (or vendored chart path) on a cluster.
- **Policies_Application**: The Argo CD Application that syncs ConstraintTemplates and
  Constraints after the operator is ready.
- **ConstraintTemplate**: A Gatekeeper CRD defining a reusable Rego policy.
- **Constraint**: A Gatekeeper CRD instantiating a ConstraintTemplate with match rules
  and an Enforcement_Action.
- **Enforcement_Action**: `deny` (reject) or `dryrun` (audit only).
- **Policy_Bundle**: A Kustomize root under repo-root `policies/` that aggregates
  ConstraintTemplates and Constraints for `gator` and for the Policies_Application.
- **Gator**: Gatekeeper CLI (`gator verify`, `gator test`) for offline validation.
- **Sync_Wave**: Argo CD `argocd.argoproj.io/sync-wave` ordering annotation.
- **Bootstrap**: Out-of-band install of Argo CD and root Applications (not synced by
  Argo CD installing itself).
- **Infrastructure_Directory**: `infrastructure/gatekeeper/` holding operator manifests,
  constraint-templates, constraints, tests, and operator overlays.
- **Cluster_Overlay**: Kustomize overlay under `overlays/<cluster>` for a specific
  cluster (`dev-eks-1` or `prod-eks-1`).

## Out of scope

- Provisioning live EKS clusters or applying Gatekeeper to a live cluster in this work
- Scaffolding any `apps/<app>/`
- Creating ECR repositories
- Real WAFv2 ACL ARNs / Shield Advanced configuration (WAF constraint stays dryrun)
- Kyverno
- Runtime dependency on a sibling or CI checkout of `kube-infra`
- Installing AWS Load Balancer Controller, EBS CSI, or node lifecycle add-ons (EKS Auto
  Mode owns those)

## Requirements

### Requirement 1: Gatekeeper Operator Manifests

**User Story:** As a platform engineer, I want Gatekeeper operator manifests stored
in-repo with base and per-cluster overlays, so that each cluster installs a consistent,
versioned Gatekeeper instance via Argo CD.

#### Acceptance Criteria

1. THE Infrastructure_Directory SHALL contain a `base/` directory with `namespace.yaml`
   defining the `gatekeeper-system` Namespace (labels `name: gatekeeper-system`,
   `owner: platform`) and an Application manifest for the Operator_Application.
2. THE Infrastructure_Directory SHALL contain `overlays/dev-eks-1/` and
   `overlays/prod-eks-1/`, each with `kustomization.yaml` referencing base and an
   `application-patch.yaml` (and nested Policies_Application) for that cluster.
3. THE Operator_Application SHALL use `spec.project: default` and
   `spec.destination.name: in-cluster`, with destination namespace `gatekeeper-system`.
4. THE Operator_Application SHALL install Gatekeeper chart version **3.21.1** by
   vendoring the chart under `infrastructure/gatekeeper/base/vendored/chart/gatekeeper/`
   with a `vendored/README.md` recording upstream Helm repo URL, pinned version, and the
   `helm pull` command. THE Application SHALL use this Git repo as `repoURL`,
   `targetRevision: main`, and `path` pointing at the vendored chart (not a floating
   remote chart tag).
5. WHEN the Operator_Application is synced, THE `gatekeeper-system` Namespace SHALL use
   Sync_Wave `-1` and the operator Application SHALL use Sync_Wave `0`.
6. EACH Cluster_Overlay SHALL include a nested Policies_Application whose
   `spec.source.path` is `policies/overlays/<cluster>` in this repository,
   `repoURL` is `https://github.com/jajera/kiro-eks-argocd-migration.git`,
   `targetRevision: main`, Sync_Wave `2`.
7. THE Operator_Application SHALL include `ignoreDifferences` for CRD drift
   (`preserveUnknownFields`, `managedFields`, `status`) as in the kube-infra operator
   Application. Constraint and ConstraintTemplate `.status` ignoreDifferences SHALL live
   on the Policies_Application, not the Operator_Application.
8. THE Operator_Application SHALL use `syncPolicy.automated` with `prune: true` and
   `selfHeal: true`, and `syncOptions` including `CreateNamespace=true`.
9. THE Operator_Application Helm values SHALL retain the operational defaults adapted
   from kube-infra where applicable (webhook timeouts, `syncVAPEnforcementScope: true`,
   readiness/liveness timeouts, resource requests/limits) so admission is stable on EKS.

### Requirement 2: ConstraintTemplates

**User Story:** As a platform engineer, I want all ConstraintTemplates defined in-repo
under a dedicated directory, so that policy rules are version-controlled and reviewable.

#### Acceptance Criteria

1. THE Infrastructure_Directory SHALL contain `constraint-templates/` with one YAML file
   per ConstraintTemplate, named `<template-name>.yaml` in lowercase.
2. THE Infrastructure_Directory SHALL include these 14 ConstraintTemplates, adapted from
   kube-infra: `containerlimits`, `requiredlabels`, `disallow-default-namespace`,
   `allow-privilege-escalation`, `networkpolicy-egress-defined`,
   `ingress-wafv2-public-alb`, `httpsonly`, `disallowedtags`, `block-nodeport-services`,
   `privileged-containers`, `host-namespaces`, `host-filesystem`, `disallowanonymous`,
   and `verifydeprecatedapi`.
3. THE `constraint-templates/` directory SHALL contain a `kustomization.yaml` listing
   all ConstraintTemplate YAML files as resources.
4. EACH ConstraintTemplate SHALL declare `apiVersion: templates.gatekeeper.sh/v1`,
   `kind: ConstraintTemplate`, a unique `spec.crd.spec.names.kind`, and at least one
   `spec.targets` entry with a Rego body.
5. WHEN `kustomize build` is run against `constraint-templates/`, THE build SHALL exit 0
   and emit all 14 ConstraintTemplates.
6. WHEN a ConstraintTemplate is added or modified, THE corresponding suite under
   `infrastructure/gatekeeper/tests/` SHALL pass under `gator verify`.

### Requirement 3: Constraints

**User Story:** As a platform engineer, I want Constraints defined per template with a
configurable enforcement action, so that policies can be promoted from dryrun to deny
independently.

#### Acceptance Criteria

1. THE Infrastructure_Directory SHALL contain `constraints/` with one subdirectory per
   Constraint (lowercase name), each containing `constraint.yaml` and
   `kustomization.yaml` listing that file.
2. THE `containerlimits` Constraint SHALL use `spec.enforcementAction: deny` in base.
3. ALL other Constraints SHALL use `spec.enforcementAction: dryrun` in base.
4. THE `ingress-wafv2-public-alb` Constraint SHALL remain `dryrun` in base and in both
   cluster overlays until real regional WAFv2 ACL ARNs are available; a YAML comment
   SHALL state that promotion to `deny` is gated on those ARNs.
5. EACH Constraint `kind` SHALL match the corresponding ConstraintTemplate
   `spec.crd.spec.names.kind`.
6. EACH Constraint subdirectory `kustomization.yaml` SHALL list only local
   `constraint.yaml`.
7. Constraints that match Pods or Namespaces SHALL include `spec.match.excludedNamespaces`
   for platform namespaces at minimum: `kube-system`, `gatekeeper-system`, `argocd`, and
   common EKS add-on namespaces used by this platform. THEY SHALL NOT list `kyverno` or
   `keda` unless those add-ons are installed in this repository.
8. THE `requiredlabels` Constraint SHALL require label key `owner` with a regex that
   accepts `platform` (and other non-empty owners); it SHALL NOT hard-code the value
   `devops`.

### Requirement 4: Policy Bundle (Kustomize)

**User Story:** As a platform engineer, I want a Kustomize policy bundle under
`policies/` with base and per-cluster overlays, so that `gatekeeper-gator-test.sh` and
the Policies_Application use the same enforceable set.

#### Acceptance Criteria

1. THE repo SHALL contain `policies/base/kustomization.yaml` that aggregates all
   ConstraintTemplates and Constraints via in-repo relative paths into
   `infrastructure/gatekeeper/` (directory references preferred, matching kube-infra
   style: e.g. `../../infrastructure/gatekeeper/constraint-templates` and
   `../../infrastructure/gatekeeper/constraints/<name>`).
2. THE repo SHALL contain `policies/overlays/dev-eks-1/kustomization.yaml` and
   `policies/overlays/prod-eks-1/kustomization.yaml`, each referencing `../../base` and
   applying patches that: (a) set Sync_Wave `1` on ConstraintTemplates and Sync_Wave `2`
   plus `SkipDryRunOnMissingResource=true` on Constraints; (b) set
   `spec.enforcementAction: deny` on Constraints promoted for that cluster (at minimum
   `namespaces-must-have-owner` and `disallow-default-namespace`, matching kube-infra
   overlay practice). WAF SHALL NOT be promoted to deny in these overlays.
3. WHEN `gatekeeper-gator-test.sh` runs without `POLICY_DIR`, THE default
   `$repo_root/policies` SHALL contain `base/kustomization.yaml`.
4. WHEN the script detects a cluster in the target path and
   `policies/overlays/<cluster>/kustomization.yaml` exists, THE script SHALL use that
   overlay; OTHERWISE it SHALL fall back to `policies/base`.
5. WHEN `kustomize build policies/base` runs, THE command SHALL exit 0 and emit at least
   one ConstraintTemplate and one Constraint.
6. WHEN `kustomize build policies/overlays/<cluster>` runs for `dev-eks-1` and
   `prod-eks-1`, THE command SHALL exit 0 and include the same templates/constraints as
   base with promoted Constraints showing `enforcementAction: deny`.
7. EACH overlay patch SHALL target a Constraint that exists in the base by kind,
   apiVersion, and metadata.name.

### Requirement 5: Gator Verify Test Suites

**User Story:** As a platform engineer, I want gator verify suites for each Constraint,
so that policy correctness is validated offline without a live cluster.

#### Acceptance Criteria

1. THE Infrastructure_Directory SHALL contain `tests/` with one subdirectory per
   Constraint (lowercase), adapted from kube-infra suites where applicable.
2. EACH suite subdirectory SHALL contain `suite.yaml` referencing the ConstraintTemplate
   and Constraint, with at least one expected-pass and one expected-fail case
   (`pass.yaml` / `fail.yaml` or equivalent).
3. WHEN `gator verify infrastructure/gatekeeper/tests/...` (or equivalent from that
   tests root) runs with tooling present, THE command SHALL exit 0 when all cases match.
4. IF `gator verify` fails, THEN THE output SHALL identify the failing suite/case.
5. IF a Constraint matches `kind: Pod`, THEN test objects SHALL be bare Pods (not only
   Deployment/CronJob wrappers), because verify evaluates the matched Kind.
6. WHEN a template or Constraint changes such that an existing case no longer matches
   its expected result, THE re-run SHALL exit non-zero.

### Requirement 6: Sync Wave Ordering

**User Story:** As a platform engineer, I want Gatekeeper resources applied in a defined
order via sync waves, so that the operator is healthy before Constraints land.

#### Acceptance Criteria

1. THE `gatekeeper-system` Namespace SHALL use Sync_Wave `-1`.
2. THE Operator_Application SHALL use Sync_Wave `0`.
3. THE Policies_Application SHALL use Sync_Wave `2`.
4. WITHIN the Policies_Application sync, ConstraintTemplates SHALL use Sync_Wave `1`
   and Constraints SHALL use Sync_Wave `2`.
5. Constraints SHALL include
   `argocd.argoproj.io/sync-options: SkipDryRunOnMissingResource=true`.
6. THE design and steering docs SHALL state that Argo CD does not advance to later waves
   while earlier waves are unhealthy (operator before policies).

### Requirement 7: Bootstrap and Cluster Integration

**User Story:** As a platform engineer, I want Gatekeeper wired into bootstrap so it is
installed after Argo CD on each cluster.

#### Acceptance Criteria

1. EACH of `bootstrap/dev-eks-1/` and `bootstrap/prod-eks-1/` SHALL document (and, when
   install manifests exist, include) a root Application or equivalent entry that syncs
   `infrastructure/gatekeeper/overlays/<cluster>/`.
2. THE documented apply order SHALL be: Argo CD healthy → Gatekeeper operator overlay →
   nested Policies_Application (waves as above).
3. Integration SHALL use `destination.name: in-cluster`, `project: default`, and Git
   `targetRevision: main` for Git-sourced Applications.
4. BOTH clusters SHALL have matching overlay shapes under
   `infrastructure/gatekeeper/overlays/<cluster>/`.
5. Bootstrap documentation SHALL state that Gatekeeper MUST NOT be applied before Argo CD
   is available on the cluster; until clusters exist, manifests remain Git-only.

### Requirement 8: Steering and Profile Updates

**User Story:** As a platform engineer, I want the project profile and steering updated
so hooks and skills use Gatekeeper validation.

#### Acceptance Criteria

1. WHEN the Gatekeeper stack is scaffolded (`policies/base/kustomization.yaml` builds
   successfully), THE project profile SHALL set `policy_engine` to `gatekeeper`.
2. IF `policy_engine` is `gatekeeper`, THEN THE `policy-validate` hook SHALL invoke
   `scripts/gatekeeper-gator-test.sh` for the edited app overlay manifests (when apps
   exist later); it SHALL NOT invent a parallel checker.
3. IF `policy_engine` is `gatekeeper`, THEN THE `validate-infra-scaffold` hook SHALL
   confirm `policies/base` and both cluster policy overlays exist, and SHALL run
   `gator verify` against `infrastructure/gatekeeper/tests/` when tooling is present.
4. Steering (policy-validation and/or manage-clusters / project-profile constraints)
   SHALL document apply order: Argo CD → Gatekeeper operator → policies.
5. IF `gator` (or required tooling) is missing, THEN hooks SHALL skip gator steps with
   an explicit skip reason and SHALL NOT fail solely for missing tools.
6. Root and `.kiro` README references to `POLICY_DIR` / `policy_engine` SHALL match the
   in-repo `policies/` default.

### Requirement 9: Script Alignment

**User Story:** As a platform engineer, I want `scripts/gatekeeper-gator-test.sh` aligned
with the in-repo policy path so local validation matches cluster enforcement.

#### Acceptance Criteria

1. THE script SHALL default `POLICY_DIR` to `$repo_root/policies` and use
   `$POLICY_DIR/base` when no cluster overlay applies.
2. WHEN the target path contains `overlays/<cluster>/` and
   `$POLICY_DIR/overlays/<cluster>/kustomization.yaml` exists, THE script SHALL use that
   overlay; OTHERWISE base.
3. IF `gator`, `kustomize`, or `python3` is missing, OR `$POLICY_DIR` / base
   kustomization is missing, THEN THE script SHALL print a skip message to stderr and
   exit 0.
4. THE script SHALL pass `--deny-only` to `gator test` so dryrun Constraints do not fail
   the run.
5. WHEN a `deny` Constraint is violated, THE script SHALL exit non-zero with gator's
   exit code.
6. THE script SHALL continue expanding controller pod templates via
   `expand-pod-templates.py` before `gator test`.

### Requirement 10: CI Workflow for Gator Verify

**User Story:** As a platform engineer, I want CI to run `gator verify` on policy PRs so
policy changes are validated before merge.

#### Acceptance Criteria

1. THE repo SHALL contain `.github/workflows/policy-validate.yml` that runs `gator verify`
   against `infrastructure/gatekeeper/tests/`.
2. THE workflow SHALL trigger on pull requests that touch `infrastructure/gatekeeper/**`,
   `policies/**`, `scripts/gatekeeper-gator-test.sh`, `scripts/expand-pod-templates.py`,
   or `.github/workflows/policy-validate.yml`.
3. THE workflow SHALL install a pinned `gator` release from public Gatekeeper GitHub
   releases (checksum-verified preferred, matching kube-infra/devops-apps practice) with
   no private-repo checkout.
4. IF `gator` install fails, THEN THE workflow SHALL fail non-zero with a clear error.
5. IF `infrastructure/gatekeeper/tests/` is missing or empty, THEN THE workflow SHALL
   skip with exit 0 and a log message.
6. THE workflow SHALL use `permissions: contents: read` and SHALL NOT require secrets
   beyond `GITHUB_TOKEN`.
7. THE workflow SHALL include a comment that adding `gator test` against `apps/**` is
   recommended once applications exist.
8. Required PR hygiene workflows (`markdown-lint.yml`, `commitmsg-conform.yml`) SHALL
   remain separate and SHALL NOT be replaced by this workflow.

### Requirement 11: Labels and Naming Conventions

**User Story:** As a platform engineer, I want Gatekeeper resources to follow repo
labelling and naming conventions.

#### Acceptance Criteria

1. THE `gatekeeper-system` Namespace SHALL have labels `name: gatekeeper-system` and
   `owner: platform`.
2. Operator_Application and Policies_Application SHALL carry `metadata.labels.owner:
   platform`.
3. Standard Kind files SHALL use Kind-lowercase names (`namespace.yaml`,
   `application.yaml`, `kustomization.yaml`). Multiple Applications in one directory
   SHALL use suffixes (e.g. `application-policies.yaml`).
4. Overlay strategic-merge patches SHALL use `{kind}-patch.yaml` (e.g.
   `application-patch.yaml`).
5. ConstraintTemplate and Constraint files SHALL be named after the policy name in
   lowercase, not after Kind.
6. NO Gatekeeper resource SHALL use `owner: devops`.

### Requirement 12: Self-Contained Repo

**User Story:** As a platform engineer, I want the Gatekeeper stack fully self-contained
so there is no runtime dependency on kube-infra.

#### Acceptance Criteria

1. THE repo SHALL contain all ConstraintTemplates, Constraints, tests, operator
   manifests, overlays, and the `policies/` bundle needed to install and validate
   Gatekeeper.
2. CI SHALL use only `actions/checkout` of this repository and SHALL NOT clone kube-infra.
3. `gatekeeper-gator-test.sh` SHALL default to in-repo `policies/` without requiring
   `POLICY_DIR` outside the repo.
4. THE vendored Helm chart SHALL be present in Git so operator sync does not depend on
   fetching an unpinned chart range from the public Helm repo at apply time.
5. `policies/` Kustomize roots SHALL reference only in-repo relative paths (no absolute
   paths or URLs outside this repository).
6. kube-infra MAY be used as a human reference when authoring; it SHALL NOT be required
   at validate or sync time.

### Requirement 13: Reproducible Gator CLI

**User Story:** As a platform engineer, I want a pinned, checksum-verified `gator` CLI
install that matches CI, so offline policy checks are reproducible on any machine.

#### Acceptance Criteria

1. THE Platform SHALL pin the gator CLI to version **3.22.0** (Gatekeeper release tag
   `v3.22.0`) — distinct from the vendored Helm chart version **3.21.1**.
2. THE Platform SHALL keep version + platform SHA-256 digests in
   `scripts/install-gator.sh`; CI SHALL run that script (not duplicate checksums inline).
3. THE root README and `.kiro/steering/policy-validation.md` SHALL document the same
   version, the published SHA-256 table, and `scripts/install-gator.sh` as the install
   path (linux/darwin amd64/arm64).
4. THE documented local smoke commands SHALL be:
   `scripts/install-gator.sh`, then
   `gator verify infrastructure/gatekeeper/tests/...` and
   `scripts/gatekeeper-gator-test.sh` (with a kustomize root when apps exist).
5. THE `policy-validate` and `validate-infra-scaffold` hooks SHALL continue to invoke
   those same commands when `policy_engine` is `gatekeeper`; they SHALL NOT invent a
   different gator version or policy path.
6. Scripts and hooks MAY skip when `gator` is absent (exit 0 with a skip message) so
   clones without the binary do not hard-fail; CI SHALL remain the hard gate that
   always installs the pinned binary.
7. WHEN the pinned gator version is bumped, THE Platform SHALL update in one pass:
   `scripts/install-gator.sh` (version + SHA map), README, and `policy-validation.md`.
   CI SHALL invoke that script rather than duplicating checksums.
