---
inclusion: always
---

# GitOps Conventions

Argo CD with a Kustomize base/overlay layout. These conventions apply to every app in
`<app-repo>`, regardless of where the workload was migrated from.

## Layout

```text
apps/<app>/
  base/
    kustomization.yaml
    namespace.yaml
    application.yaml
    manifests/                 # plain-manifest apps only
  overlays/dev-eks-1/
    kustomization.yaml
    application-patch.yaml
    manifests/
  overlays/prod-eks-1/         # same shape; both overlays are required
  iam.tf                       # IAM policy + Pod Identity association
  README.md
```

- **Base** holds what is identical across both clusters.
- **Overlays** hold cluster differences only — image digests, replica counts, secret
  paths, ingress hostnames. Keep them small; if an overlay grows, the value probably
  belongs in base.
- **`iam.tf`** holds the app's IAM. See the identity and secrets steering file.

Every app has both overlays. There is no such thing as a dev-only app here — a prod
overlay created at promotion time is an overlay whose first ever build happens during a
production deploy.

## Dev and prod differences

Keep the two overlays as close to identical as the environments allow. Where they
legitimately differ:

| Differs | Why |
| --- | --- |
| Image digest | Prod trails dev by however long verification takes |
| Replica count or scaling bounds | Prod carries real load |
| Resource requests and limits | Sized from observed usage per environment |
| Secret store paths | Separate secrets per environment (`secretproviderclass.yaml` per overlay) |
| Ingress hostname | Separate DNS per environment |
| ACM certificate ARN | Each account has its own cert (`alb.ingress.kubernetes.io/certificate-arn`) |
| WAFv2 Web ACL ARN | Each account has its own WAF (`alb.ingress.kubernetes.io/wafv2-acl-arn`) |

Anything else appearing in one overlay and not the other is usually drift. A setting
that is only exercised in prod is a setting that is only tested in prod.

### Account-specific annotations live in overlays

Any Ingress annotation containing an AWS account ID (ACM certificate ARN, WAFv2 Web ACL
ARN) must be set in each overlay's `ingress-patch.yaml`, not in base. Dev and prod are
separate AWS accounts so these values always differ.

Base `ingress.yaml` carries only account-neutral annotations:

- `kubernetes.io/ingress.allow-http: "false"`
- `alb.ingress.kubernetes.io/scheme`
- `alb.ingress.kubernetes.io/target-type`
- `alb.ingress.kubernetes.io/listen-ports`

Each overlay's `ingress-patch.yaml` adds:

- `alb.ingress.kubernetes.io/certificate-arn` — the ACM cert in that account
- `alb.ingress.kubernetes.io/wafv2-acl-arn` — the WAFv2 Web ACL in that account
- `spec.tls` with the environment-specific hostname
- `spec.rules[].host` with the environment-specific hostname

### Scaffold placeholders must be shape-valid

Never write bare tokens like `REPLACE_WITH_CERT_ID` or `REPLACE_WITH_ACTUAL_DIGEST`
into manifests. Gatekeeper validates ARN shape and image references at `gator test`
time, so placeholders that are not structurally valid cause false failures.

When the real value is unknown at scaffold time, use these shape-valid dummies:

| Value | Dev overlay (`111122223333`) | Prod overlay (`444455556666`) |
| --- | --- | --- |
| ACM certificate ARN | `arn:aws:acm:ap-southeast-2:111122223333:certificate/00000000-0000-0000-0000-000000000001` | `arn:aws:acm:ap-southeast-2:444455556666:certificate/00000000-0000-0000-0000-000000000002` |
| WAFv2 Web ACL ARN | `arn:aws:wafv2:ap-southeast-2:111122223333:regional/webacl/<app>/00000000-0000-0000-0000-000000000001` | `arn:aws:wafv2:ap-southeast-2:444455556666:regional/webacl/<app>/00000000-0000-0000-0000-000000000002` |
| Image digest | `sha256:0000000000000000000000000000000000000000000000000000000000000001` | `sha256:0000000000000000000000000000000000000000000000000000000000000002` |

Rules for dummy values:

- UUIDs use the zero-padded format (`00000000-0000-0000-0000-00000000000N`) with a
  different trailing digit per overlay so dev and prod stay visually distinct.
- The WAFv2 `webacl` name segment is the app name (e.g. `regional/webacl/demo-nginx/...`).
- Image digests are 64 hex characters (`sha256:` prefix + 64 zeros with a trailing
  digit).
- These dummies exist only to pass `kustomize build` and `gator test --deny-only` in
  Git. They are **not** deployable. Replace every dummy with a real ARN or digest before
  the app reaches a live cluster.

## Two-layer Argo CD pattern

For plain-manifest apps, the `ApplicationSet` syncs the *overlay directory* (Namespace
plus a child Application), and the child Application's `source.path` points at the
overlay's `manifests/` directory holding the real workloads.

This exists so the Namespace is created and labelled by a separate sync wave before any
workload lands in it, which matters when admission policies gate on Namespace labels.
Apps deploying a Helm chart do not need the second layer.

## Application defaults

| Field | Value | Why |
| --- | --- | --- |
| `spec.project` | `<argocd_project>` | From the project profile |
| `spec.destination.name` | `in-cluster` | EKS-managed Argo CD rejects `https://kubernetes.default.svc` |
| `spec.destination.namespace` | `<app>` | One namespace per app |
| `spec.source.targetRevision` | `<default_branch>` | Never commit a feature branch name |
| `spec.syncPolicy.automated` | `prune: true`, `selfHeal: true` | |
| `spec.syncPolicy.syncOptions` | `CreateNamespace=true` | |

Do not set `targetRevision` to a branch for Helm *chart repo* sources (those with a
`chart:` field) — they are versioned by chart version, not Git ref.

## Naming

Manifest files are named after the Kubernetes `kind`, lowercased:

| Kind | File |
| --- | --- |
| `Namespace` | `namespace.yaml` |
| `Application` | `application.yaml` |
| `ServiceAccount` | `serviceaccount.yaml` |
| `Deployment` | `deployment.yaml` |
| `CronJob` | `cronjob.yaml` |
| `Service` | `service.yaml` |
| `Ingress` | `ingress.yaml` |
| `NetworkPolicy` | `networkpolicy.yaml` |
| `ConfigMap` | `configmap.yaml` |
| `SecretProviderClass` | `secretproviderclass.yaml` |
| `ScaledObject` | `scaledobject.yaml` |
| `TriggerAuthentication` | `triggerauthentication.yaml` |
| `PodDisruptionBudget` | `poddisruptionbudget.yaml` |

If a file for that Kind already exists in the same directory, disambiguate with a
suffix: `deployment-<role>.yaml`, `configmap-passwd.yaml`. Never invent unrelated names
(`creds.yaml`, `netpol.yaml`, `app.yaml`).

Several objects of the same Kind may share one file when they belong together (for
example all NetworkPolicies in `networkpolicy.yaml`).

Overlay strategic-merge patches follow the same rule with a `-patch` suffix:
`application-patch.yaml`, `deployment-patch.yaml`, `cronjob-patch.yaml`.

| File | Purpose |
| --- | --- |
| `kustomization.yaml` | Kustomize entrypoint (not a Kubernetes Kind) |
| `{kind}.yaml` | Resource(s) of that Kind |
| `{kind}-patch.yaml` | Overlay patch targeting that Kind |

## Labels

| Resource | Required labels |
| --- | --- |
| Namespace | `name: <app>`, `owner: platform` |
| Workloads, ServiceAccount, NetworkPolicy, ConfigMap, Secret, etc. | `app.kubernetes.io/name: <app>`, `owner: platform` |
| Pod template | Same as the workload: `app.kubernetes.io/name`, `owner` |
| Deployment / Service selector | `app.kubernetes.io/name: <app>` |
| NetworkPolicy `podSelector` | `app.kubernetes.io/name: <app>` |

Add via the manifests `kustomization.yaml`:

```yaml
labels:
  - pairs:
      app.kubernetes.io/part-of: <app>
```

`app.kubernetes.io/name` is the selector key. If it drifts between the Deployment and the
NetworkPolicy, the allow policies match nothing and traffic is silently denied.

## Images and promotion

Every workload image reference is the existing ECR repository named after the app, in
the dev account. Upstream sources (Docker Hub, GHCR, Quay, a local build) are mirrored
there first; manifests never point at the upstream registry. Do not create the ECR
repository from this repo — assume it already exists.

```text
# base (floating tag)
image: 111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>:<tag>

# overlay pin (real digest after push)
image: 111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>:<tag>@sha256:<64-hex-digest>

# overlay pin (scaffold dummy — passes gator, not deployable)
image: 111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>:<tag>@sha256:0000000000000000000000000000000000000000000000000000000000000001
```

- Base carries the floating tag (`:latest` or a release tag).
- Each overlay pins its own digest. Keep the pin in exactly one file per overlay so a
  bump is a one-line diff.
- Pin the digest even when no admission policy requires it. A tag can be re-pointed at
  different bytes; a digest cannot, so prod runs exactly what dev verified.
- When the real digest is not yet known (initial scaffold), use the 64-hex dummy
  (`000...0001` for dev, `000...0002` for prod). Never use a bare string like
  `REPLACE_WITH_ACTUAL_DIGEST` — it fails the disallowed-tags constraint.

Promotion is copying the digest from `overlays/dev-eks-1` to `overlays/prod-eks-1`.
Prod runs the exact bytes verified in dev, and the promotion diff shows precisely what
is changing.

## Terraform and manifest ordering

An app's IAM lives in `apps/<app>/iam.tf` and is applied separately from the manifests
Argo CD syncs. Two different systems means ordering is your responsibility:

- **Adding** a permission: apply Terraform first, then merge the manifest change.
- **Removing** one: merge the manifest change first, confirm the app no longer needs the
  permission, then apply Terraform.

A pod whose Pod Identity association does not exist yet starts normally and fails its
first AWS call. That surfaces as an application error, not as missing infrastructure, so
it costs more to diagnose than it should.

Always reach `dev-eks-1` before `prod-eks-1`, for both Terraform and manifests.

## Resources (mandatory)

Every container — including init containers and sidecars — must declare explicit CPU
and memory `requests` and `limits`. No defaults, no omissions.

```yaml
resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    cpu: 500m
    memory: 256Mi
```

Size from observed usage when available; otherwise start small and raise after the app
runs in `dev-eks-1`. Requests drive scheduling; limits cap the blast radius.

## NetworkPolicy (mandatory)

Every plain-manifest app ships `networkpolicy.yaml` in base:

1. `default-deny-all` — deny Ingress and Egress for every pod in the namespace.
2. One allow NetworkPolicy per required flow — DNS, HTTPS, Pod Identity, SSH, app
   ports — each as its own object.

Do not combine allows into one policy. Do not leave an app without the deny. See the
identity and secrets steering file for which allows are required when.

## Probes (mandatory for web-service)

Every `web-service` container that serves HTTP must declare readiness and liveness
probes. Prefer a shallow readiness path and a separate liveness path — do not point both
at a deep dependency check.

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: http
  initialDelaySeconds: 5
  periodSeconds: 10
livenessProbe:
  httpGet:
    path: /health
    port: http
  initialDelaySeconds: 30
  periodSeconds: 30
```

Use a `startupProbe` instead of a long `initialDelaySeconds` for slow-starting apps.
Workers and CronJobs do not need HTTP probes unless they expose an admin port.

## Deployment rolling update (single-replica safe)

For Deployments that must not go idle during an image/config rollout, use surge-first
rolling updates. This keeps a **replicas: 1** service up during Argo syncs. It does
**not** replace a PDB for node drains.

```yaml
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
```

Prefer this default for web-facing Deployments.

## PodDisruptionBudget (node drain / replacement)

PDBs govern **voluntary disruptions** (cordon/drain, EKS Auto Mode / Karpenter
replacement). They do **not** control Deployment rollouts.

When the Deployment (or KEDA/HPA floor) runs **at least 2 replicas**, add
`poddisruptionbudget.yaml` with `minAvailable: 1`:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: <app>
  labels:
    app.kubernetes.io/name: <app>
    owner: platform
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: <app>
```

That keeps at least one pod during a drain. It **requires** `replicas >= 2` (or
autoscaler min >= 2). With `replicas: 1`, the same PDB blocks every voluntary
eviction → `DisruptionBlocked` and stuck node replacement.

| replicas | RollingUpdate `maxUnavailable: 0` / `maxSurge: 1` | PDB `minAvailable: 1` |
| --- | --- | --- |
| 1 | Yes (rollout safety) | **No** — remove PDB or raise replicas |
| >= 2 | Yes | **Yes** |

Never set `minAvailable` >= replica count.

## Helm charts

Managed Argo CD installations often have a single Git credential (for example AWS
CodeConnections). That credential gets sent to non-Git HTTP endpoints, which reject it,
so chart fetches from an external Helm repo fail.

If you hit that, vendor the chart instead of fetching it:

1. `helm pull <repo>/<chart> --version <x.y.z> --untar -d apps/<app>/base/vendored/chart/`
2. Add `apps/<app>/base/vendored/README.md` recording the upstream URL, pinned version,
   and the upgrade command.
3. Point the Application at the in-repo path rather than the chart repo.

Vendoring is a workaround, not a default. Prefer a plain chart source when the Argo CD
installation can reach the chart repo.

## Replicas owned by an autoscaler

When KEDA or an HPA owns `spec.replicas`, set the manifest to the autoscaler's floor
(commonly `0` for KEDA, `1` for HPA) and add `ignoreDifferences` on
`/spec/replicas` to the Application. Without it Argo CD fights the autoscaler and the
app oscillates between synced and out-of-sync.

## App README

Every app **must** have `apps/<app>/README.md`. Create it with the scaffold; do not
defer it. Keep it short and factual. Match the **kube-devops-apps** style (see
`apps/fmp-polling/README.md` as the reference shape).

Required pieces:

1. Title (`# <app>`) and a short purpose paragraph
2. `## Inputs and outputs` — **required** Mermaid `flowchart LR` with:
   - `subgraph inputs [Inputs]` — queues, HTTP clients, schedules, secrets, upstream APIs
   - the app / workers in the middle (named Deployments or Jobs)
   - `subgraph outputs [Outputs]` — sinks, responses, downstream APIs, storage
   - **Labeled edges** that say *how* the link works (protocol, env var, Pod Identity,
     CSI -> env, etc.) — not bare arrows
3. Compact tables under the diagram for inputs / outputs (and settings when useful)
4. Image / ECR reference, IAM, networking / secrets sections as the app needs them

Do **not** substitute a shallow “Client -> ALB -> Pod” Architecture diagram for the
inputs/outputs Mermaid. Derive nodes from the real app config (env, queues, Ingress,
secrets, egress).

The README **must** pass repo markdown lint (`.markdownlint.json`). After writing or
editing it, run:

```bash
npx --yes markdownlint-cli2 "apps/<app>/README.md"
```

Fix any findings before finishing the scaffold. Prefer fenced `text` / `mermaid` code
blocks; blank line before/after fences and headings; no trailing spaces.

## Style

- Use ASCII `->` rather than Unicode arrows in docs and comments.
- Markdown tables: compact pipe style with a space either side of every `|`.
