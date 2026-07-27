# Requirements Document

## Introduction

This document captures the requirements for the initial project scaffolding of the
kiro-eks-argocd-migration repository. The project provides a foundational platform that
enables future workload migrations onto Amazon EKS managed by Argo CD. It is not itself
a migration of any specific application. Instead, it establishes the directory
conventions, cluster configuration, CI pipelines, validation tooling, and agent-assisted
workflows that every future migrated workload relies on.

## Glossary

- **Platform**: The foundational repository scaffolding (directory layout, CI workflows,
  validation scripts, Kiro configuration) that enables workload migrations onto EKS via
  Argo CD.
- **Cluster**: An Amazon EKS cluster managed in Auto Mode. The platform targets two
  clusters: `dev-eks-1` and `prod-eks-1`.
- **ApplicationSet**: An Argo CD resource that discovers app overlays per cluster and
  generates one Application per match.
- **Kustomize_Overlay**: A directory containing cluster-specific patches that layer on
  top of a shared base.
- **Bootstrap_Configuration**: The Argo CD installation manifests and root-level
  resources that bring up Argo CD on each cluster.
- **CI_Pipeline**: A GitHub Actions workflow that validates repository content on pull
  requests.
- **Validation_Script**: A shell or Python script in `scripts/` that performs local
  manifest or policy checks.
- **Steering_File**: A Markdown document in `.kiro/steering/` that provides conventions
  and constraints to the Kiro agent.
- **Skill**: A Kiro workflow definition at `.kiro/skills/<name>/SKILL.md` that encodes a
  repeatable multi-phase process with validation gates.
- **Hook**: A Kiro automation in `.kiro/hooks/` that runs checks when files change.
- **MCP_Server**: A Model Context Protocol server configured in `.kiro/settings/mcp.json`
  that gives the Kiro agent live access to external systems.
- **Pod_Identity**: EKS Pod Identity association binding an IAM role to a namespace and
  ServiceAccount without annotating the ServiceAccount with a role ARN.
- **SecretProviderClass**: A Secrets Store CSI resource that maps AWS Secrets Manager
  objects into a CSI volume and optional Kubernetes Secret.

## Requirements

### Requirement 1: Repository Directory Layout

**User Story:** As a platform engineer, I want a standardised directory layout, so that
every future application follows the same conventions and can be discovered
automatically by Argo CD.

#### Acceptance Criteria

1. THE Platform SHALL provide an `apps/` directory as the root for all application
   manifests.
2. THE Platform SHALL provide a `bootstrap/` directory containing Argo CD installation
   and root manifests organised per cluster.
3. THE Platform SHALL provide a `clusters/` directory with one subdirectory per cluster,
   each containing an ApplicationSet that discovers `apps/*/overlays/<cluster>`.
4. THE Platform SHALL provide a `scripts/` directory containing validation helper
   scripts.
5. WHEN a new application is added, THE Platform SHALL expect the structure
   `apps/<app>/base/`, `apps/<app>/overlays/dev-eks-1/`,
   `apps/<app>/overlays/prod-eks-1/`, and `apps/<app>/iam.tf` when the app calls AWS APIs
   or uses Secrets Manager.
6. THE Platform SHALL name Kubernetes manifest files after their Kind in lowercase
   (for example `application.yaml`, `deployment.yaml`, `networkpolicy.yaml`,
   `secretproviderclass.yaml`, `poddisruptionbudget.yaml`).
7. IF a file for that Kind already exists in the same directory, THEN THE Platform SHALL
   require a disambiguating suffix (for example `deployment-<role>.yaml`).
8. THE Platform SHALL name overlay strategic-merge patches `{kind}-patch.yaml` (for
   example `application-patch.yaml`, `deployment-patch.yaml`).

### Requirement 2: Multi-Cluster Support

**User Story:** As a platform engineer, I want the platform to target two distinct EKS
clusters in separate AWS accounts, so that workloads can be verified in dev before
promotion to prod.

#### Acceptance Criteria

1. THE Platform SHALL define cluster `dev-eks-1` in AWS account `111122223333` in region
   `ap-southeast-2`.
2. THE Platform SHALL define cluster `prod-eks-1` in AWS account `444455556666` in region
   `ap-southeast-2`.
3. THE Platform SHALL require every application to have overlays for both `dev-eks-1` and
   `prod-eks-1` at creation time — a prod overlay SHALL NOT be created only at promotion.
4. THE Platform SHALL use EKS Auto Mode as the compute mode for both clusters, meaning
   the AWS Load Balancer Controller, EBS CSI driver, and node lifecycle are managed by
   EKS and not scaffolded as add-ons.
5. THE Platform SHALL set `metadata.labels.owner` to `platform` on Namespaces and
   workload resources.

### Requirement 3: GitOps Delivery via Argo CD

**User Story:** As a platform engineer, I want Argo CD to be the sole delivery mechanism
for workloads, so that the cluster state always matches what is committed in Git.

#### Acceptance Criteria

1. THE Platform SHALL use Argo CD ApplicationSets to discover and deploy applications
   from the `apps/*/overlays/<cluster>` path pattern.
2. THE Platform SHALL name each generated Application `<app>-<cluster>`.
3. THE Platform SHALL configure Applications with automated sync, prune enabled, and
   self-heal enabled.
4. THE Platform SHALL set `spec.destination.name` to `in-cluster` for all generated
   Applications.
5. THE Platform SHALL set `spec.source.targetRevision` to `main` for all Git-sourced
   Applications.
6. THE Platform SHALL use the `default` Argo CD AppProject for all generated
   Applications.
7. THE Platform SHALL deliver workload changes by writing YAML to Git; THE Kiro agent
   SHALL NOT apply manifests directly to the cluster as the primary delivery path.

### Requirement 4: Kustomize Base and Overlay Pattern

**User Story:** As a platform engineer, I want a Kustomize base/overlay pattern, so that
shared manifests are defined once and cluster-specific differences are isolated to
overlays.

#### Acceptance Criteria

1. THE Platform SHALL use Kustomize as the manifest templating tool for plain-manifest
   applications.
2. THE Platform SHALL keep base manifests identical across clusters, with overlays
   providing only cluster-specific differences such as image digests, replica counts,
   secret paths, and ingress hostnames.
3. WHEN an overlay grows beyond cluster-specific values, THE Platform SHALL indicate
   that the value belongs in base.
4. FOR plain-manifest applications, THE Platform SHALL use a two-layer Argo CD pattern
   where the overlay directory syncs Namespace plus child Application, and the child
   Application path points at the overlay `manifests/` directory.

### Requirement 5: Per-Application IAM with Pod Identity

**User Story:** As a platform engineer, I want each application to declare its own IAM
policy and Pod Identity association, so that workloads have least-privilege access and
no app inherits another's credentials.

#### Acceptance Criteria

1. WHEN an application calls AWS APIs or reads Secrets Manager, THE Platform SHALL
   require `apps/<app>/iam.tf` containing an IAM policy document, an IAM role trusted by
   `pods.eks.amazonaws.com`, a role policy attachment, and an
   `aws_eks_pod_identity_association`.
2. THE Platform SHALL use EKS Pod Identity as the identity binding mechanism, so that
   ServiceAccount manifests contain no IAM annotations or role ARNs.
3. THE Platform SHALL scope IAM policies to explicit actions and specific resource ARNs
   rather than wildcard permissions.
4. THE Platform SHALL define one Pod Identity association per cluster per application,
   binding the IAM role to the app namespace and ServiceAccount.
5. THE Platform SHALL treat `iam.tf` as a snippet declaring only those resources — not a
   full Terraform root with providers, backends, or modules inside this repository's
   conventions.
6. THE Platform SHALL apply each application's `iam.tf` independently from the manifests
   that Argo CD syncs, applying Terraform before a sync that depends on new permissions.

### Requirement 6: Container Image Management

**User Story:** As a platform engineer, I want a single ECR registry strategy, so that
image promotion between environments is a digest copy rather than a cross-account image
transfer.

#### Acceptance Criteria

1. THE Platform SHALL reference every workload image as
   `111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>`, where `<app>` is the
   application name and the ECR repository name.
2. THE Platform SHALL assume the ECR repository already exists and is managed outside
   this repository; scaffolding SHALL NOT create ECR repositories.
3. WHEN a source image lives on Docker Hub, GHCR, or another registry, THE Platform
   SHALL require retagging and pushing into the project ECR repository before writing
   manifests; manifests SHALL NEVER reference the upstream registry.
4. THE Platform SHALL require base manifests to reference images with a floating tag and
   overlay manifests to pin images by digest
   (`...<app>:<tag>@sha256:<digest>`).
5. THE Platform SHALL define image promotion as copying the verified digest from the
   `dev-eks-1` overlay to the `prod-eks-1` overlay without rebuilding.
6. THE Platform SHALL grant the prod account (`444455556666`) pull access to the dev
   account ECR repositories via repository policy.

### Requirement 7: Secrets Management via Secrets Store CSI

**User Story:** As a platform engineer, I want a standardised secrets integration
pattern, so that workloads can access AWS Secrets Manager values without baking secrets
into images or committing them to Git.

#### Acceptance Criteria

1. THE Platform SHALL use the Secrets Store CSI driver as the secrets backend.
2. WHEN an application requires secrets, THE Platform SHALL require
   `overlays/<cluster>/manifests/secretproviderclass.yaml` in both overlays, with
   `region: ap-southeast-2` and `usePodIdentity: "true"`.
3. THE Platform SHALL require secrets to be wired via CSI volume mount at
   `/mnt/secrets-store` plus `secretKeyRef` environment variables on the workload.
4. THE Platform SHALL require the corresponding `secretsmanager:GetSecretValue`
   permission (and `kms:Decrypt` when applicable) in the application's `iam.tf`, scoped
   to the secret ARNs in use.
5. THE Platform SHALL require Secrets Manager values used with `jmesPath` to be JSON
   objects.
6. WHEN an application needs an OpenSSH private key, THE Platform SHALL mount the key as
   a CSI file and prepare mode `0600` via initContainer; THE Platform SHALL NOT put the
   private key in CSI `secretObjects`.

### Requirement 8: CI Pipeline Validation

**User Story:** As a platform engineer, I want CI pipelines that validate manifests,
commit messages, and documentation on every pull request, so that broken changes are
caught before merge.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL run Kustomize build validation against all `apps/*/base` and
   `apps/*/overlays/*` paths (including nested `manifests/` roots, excluding
   `vendored/`) on pull requests that touch `apps/**`.
2. THE CI_Pipeline SHALL run Markdown linting on pull requests.
3. THE CI_Pipeline SHALL run commit message conformance checks on pull requests.
4. WHEN the `apps/` directory is empty or contains no matching kustomization roots, THE
   CI_Pipeline SHALL skip the Kustomize build step without failing.

### Requirement 9: Local Validation Scripts

**User Story:** As a platform engineer, I want local validation scripts, so that
manifest and policy issues are caught during development before pushing to CI.

#### Acceptance Criteria

1. THE Platform SHALL provide a script that expands pod templates from controller
   manifests (Deployment, CronJob, Job, StatefulSet, DaemonSet, ReplicaSet) into
   synthetic Pod documents for policy validation, emitting multi-document YAML with
   `---` separators.
2. THE Platform SHALL provide a script that runs Gatekeeper policy validation against
   expanded manifests when the policy engine is enabled.
3. IF `gator`, `kustomize`, or the policy directory is unavailable, THEN THE
   Validation_Script SHALL skip without error.
4. WHEN `policy_engine` is `none`, THE Platform SHALL still require Kustomize builds to
   succeed and SHALL NOT require Gatekeeper tooling.

### Requirement 10: Kiro Agent Configuration

**User Story:** As a platform engineer, I want Kiro agent workflows, hooks, and MCP
server integrations pre-configured, so that the agent can assist with migrations using
live cluster and AWS data without manual setup.

#### Acceptance Criteria

1. THE Platform SHALL configure MCP servers for AWS documentation search, EKS cluster
   access (read-only), Kubernetes resource access, and filesystem operations, with
   region `ap-southeast-2`.
2. THE Platform SHALL provide skills for migrating workloads (gated phases), adding
   applications, managing clusters, and promoting applications from `dev-eks-1` to
   `prod-eks-1`.
3. THE Platform SHALL provide steering files that encode project conventions for the
   project profile, GitOps layout, identity and secrets, policy validation, CI
   workflows, and workload archetypes.
4. THE Platform SHALL provide hooks that validate Kustomize builds, policy compliance,
   and application scaffold completeness when files change.
5. THE Platform SHALL store skills as `.kiro/skills/<name>/SKILL.md` with `name` and
   `description` frontmatter, and steering files with YAML inclusion frontmatter.

### Requirement 11: Networking and Security Defaults

**User Story:** As a platform engineer, I want mandatory networking and security
defaults, so that every workload starts with a deny-all posture and explicit allow
rules.

#### Acceptance Criteria

1. THE Platform SHALL require every plain-manifest application to include a
   `default-deny-all` NetworkPolicy in base that denies both Ingress and Egress.
2. THE Platform SHALL require one separate NetworkPolicy per allowed traffic flow rather
   than combining allows into a single policy.
3. THE Platform SHALL require `allow-dns-egress` (UDP/TCP 53 to `kube-system`) for every
   plain-manifest application.
4. WHEN the application uses Pod Identity or calls AWS APIs, THE Platform SHALL require
   `allow-https-egress` and `allow-pod-identity-egress` (`169.254.170.23:80`).
5. THE Platform SHALL require explicit CPU and memory requests and limits on every
   container, including init containers and sidecars.
6. THE Platform SHALL require the `alb` ingress class for applications that serve HTTP
   traffic via Ingress.
7. THE Platform SHALL require Namespace labels `name: <app>` and `owner: platform`.
8. THE Platform SHALL require workload, ServiceAccount, NetworkPolicy, and pod-template
   labels `app.kubernetes.io/name: <app>` and `owner: platform`.
9. THE Platform SHALL require Deployment/Service selectors and NetworkPolicy
   `podSelector` to use `app.kubernetes.io/name: <app>`.
10. THE Platform SHALL require manifests `kustomization.yaml` to apply common label
    `app.kubernetes.io/part-of: <app>`.

### Requirement 12: Workload Archetype Definitions

**User Story:** As a platform engineer, I want predefined workload archetypes, so that
each migrated application maps to a known pattern with clear manifest and input
requirements.

#### Acceptance Criteria

1. THE Platform SHALL define five workload archetypes: `web-service`, `worker`,
   `queue-worker`, `scheduled-job`, and `helm-chart`.
2. WHEN a workload is migrated or added, THE Platform SHALL require the archetype to be
   selected before manifest scaffolding begins.
3. THE Platform SHALL require readiness and liveness probes on every HTTP-serving
   container in the `web-service` archetype.
4. THE Platform SHALL require a PodDisruptionBudget (`poddisruptionbudget.yaml`,
   `minAvailable: 1`) when desired replicas (or autoscaler min) are greater than or
   equal to 2. THE Platform SHALL NOT leave that PDB on a single-replica app (it blocks
   voluntary eviction / node drain). THE Platform SHALL default Deployment
   `rollingUpdate` to `maxUnavailable: 0` and `maxSurge: 1` for rollout safety.
5. THE Platform SHALL require plain-manifest archetypes to include `serviceaccount.yaml`
   and `networkpolicy.yaml` in base.

### Requirement 13: Promotion Workflow

**User Story:** As a platform engineer, I want a defined promotion workflow, so that
verified workloads move from dev to prod by copying a digest rather than
rebuilding or redeploying.

#### Acceptance Criteria

1. THE Platform SHALL define promotion as updating the image digest in the `prod-eks-1`
   overlay to match the verified digest from `dev-eks-1` without rebuilding the image.
2. WHEN adding IAM permissions, THE Platform SHALL apply Terraform for `prod-eks-1`
   before merging the prod overlay manifest change.
3. THE Platform SHALL verify that the promoted Application reports Synced and Healthy on
   `prod-eks-1` after merge.
4. THE Platform SHALL provide a `promote-app` skill that encodes the promotion
   preconditions and steps.
5. WHILE cutover is in progress, THE Platform SHALL keep the source workload reachable
   so DNS weight can be reverted to the old endpoint without deleting EKS resources.
6. WHEN a promotion digest causes prod to become unhealthy, THE Platform SHALL require
   reverting the promote change (or restoring the previous prod digest) as the rollback
   path.
7. THE Platform SHALL NOT decommission source infrastructure until cutover has been
   stable for a full business cycle and an operator explicitly confirms.

### Requirement 14: Standalone Repository

**User Story:** As a platform engineer, I want the repository to be fully standalone, so
that manifests, cluster configuration, and per-app IAM all live in one place without
external dependencies.

#### Acceptance Criteria

1. THE Platform SHALL contain all application manifests, cluster configuration,
   bootstrap resources, and per-app IAM within a single repository.
2. THE Platform SHALL not reference or depend on an external Terraform repository or
   sibling platform repository.
3. THE Platform SHALL apply each application's `iam.tf` independently from the manifests
   that Argo CD syncs.

### Requirement 15: Migration Workflow Gates

**User Story:** As a platform engineer, I want a gated migration workflow, so that each
phase completes successfully before the next begins and results are repeatable.

#### Acceptance Criteria

1. THE Platform SHALL provide a `migrate-workload` skill with ordered phases: discover,
   containerise, publish image, cluster readiness, identity and secrets, generate
   manifests, sync and verify on dev-eks-1, promote and cut over, and decommission.
2. THE Platform SHALL require each phase gate to pass before the next phase starts.
3. THE Platform SHALL keep the source workload live through verification on `dev-eks-1`
   so a rollback path exists until decommission.
4. THE migrate-workload skill SHALL generate manifests by following the `add-app`
   conventions rather than inventing a parallel layout.
