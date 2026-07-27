---
inclusion: always
---

# Project Profile

Values that vary per environment. Every other file in `.kiro/` refers to these keys
instead of hard-coding a name. When a skill or steering file writes `<app>`,
`<cluster>`, or `<owner>`, substitute the value from here. If a value is still a
placeholder, ask the user for it before generating files.

## Values

| Key | Value | Meaning |
| --- | --- | --- |
| `argocd_project` | `default` | Argo CD `AppProject` for generated Applications |
| `owner_label` | `platform` | Value written to `metadata.labels.owner` |
| `default_branch` | `main` | Git `targetRevision` for Application sources |
| `default_timezone` | `UTC` | `spec.timeZone` for CronJobs |
| `aws_region` | `ap-southeast-2` | Region for both clusters and all app resources |
| `compute_mode` | `auto` | EKS Auto Mode |
| `identity_mode` | `pod-identity` | Per-app IAM, declared in each app's `iam.tf` |
| `policy_engine` | `gatekeeper` | `gatekeeper` or `none` |
| `secrets_backend` | `secrets-store-csi` | `secrets-store-csi`, `external-secrets`, or `none` |
| `ingress_class` | `alb` | Ingress controller class |

## Clusters and accounts

Two clusters in two accounts. Use these exact values everywhere an account ID is needed;
never write a bare `<account>` placeholder.

| Cluster | Environment | Account | AWS profile |
| --- | --- | --- | --- |
| `dev-eks-1` | `dev` | `111122223333` | `dev` |
| `prod-eks-1` | `prod` | `444455556666` | `prod` |

These are placeholder account IDs from the AWS documentation convention. Replace both
with the real values in one pass — they appear in every app's `iam.tf`.

## Container images

Every app image lives in a single ECR registry in the dev account, with a repository
policy granting `444455556666` pull access. The ECR repository is created elsewhere —
assume it already exists and is named after the app:

```text
111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>
```

Source may be Docker Hub, GHCR, a local build, or anything else — that is only the
input. Manifests never reference the source registry. Retag and push into the existing
ECR repo as `<app>` before scaffolding, then write:

```text
111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>:<tag>
111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>:<tag>@sha256:<digest>
```

Base uses the floating tag; each overlay pins the digest. One registry means promoting
an image to prod is promoting a digest, with no cross-account copy that could change the
bytes.

## This repo is standalone

Everything an app needs lives here: manifests, cluster configuration, and the IAM that
grants it AWS access. There is no sibling platform repo and no external Terraform repo
to coordinate with. Do not reference one.

```text
apps/<app>/
  base/                  # Shared across both clusters
  overlays/dev-eks-1/    # Required
  overlays/prod-eks-1/   # Required
  iam.tf                 # IAM policy + Pod Identity association
bootstrap/               # Argo CD install and root manifests per cluster
clusters/<cluster>/      # ApplicationSet discovering apps/*/overlays/<cluster>
scripts/                 # Validation helpers
```

## Every app targets both clusters

No app deploys from `base` alone, and no app ships to only one cluster. An app is
complete when it has `overlays/dev-eks-1/`, `overlays/prod-eks-1/`, and `iam.tf`.

Promotion is a change to the prod overlay — usually a newer image digest — not the
creation of a prod overlay that did not exist. Creating prod at promotion time means the
first prod deploy is also the first time that overlay has ever been built, which is when
you discover the missing value.

## Each app declares its own IAM

`apps/<app>/iam.tf` holds the app's IAM policy and its EKS Pod Identity association for
both clusters. Nothing else. See the identity and secrets steering file for the shape.

## Constraints these values imply

- `compute_mode: auto` — the AWS Load Balancer Controller, EBS CSI driver, and node
  lifecycle are managed by EKS Auto Mode. Do not scaffold those add-ons.
- `identity_mode: pod-identity` — the ServiceAccount needs no IAM annotation. The
  association is the binding, so manifests stay free of account IDs and role ARNs.
- `policy_engine: gatekeeper` — require Namespace `labels.owner` and CPU and memory
  requests/limits on every container (including init and sidecars). Run local `gator`
  checks against the in-repo `policies/` bundle. The bundle lives at `policies/base`
  with per-cluster overlays at `policies/overlays/<cluster>`.
