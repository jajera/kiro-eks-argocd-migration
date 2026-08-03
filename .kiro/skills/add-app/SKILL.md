---
name: add-app
description: Scaffold a new application in this repo as Kustomize base and overlay plus an Argo CD Application. Use when the user wants to add a new app, create a new service, onboard a workload, add a cluster overlay to an existing app, or deploy something new through Argo CD.
---

# Add an application

Creates the Kustomize tree and Argo CD Application for one app. If the app is being
moved from existing infrastructure, run the `migrate-workload` skill instead — it covers
discovery, containerisation, and identity, and calls back into this workflow at Phase 5.

## 1. Gather inputs

Do not create any files until the archetype and its required fields are known.
Scaffolding around a guess produces a tree that has to be unpicked rather than edited.

Always: `app_name`, `archetype`, and a source image (Docker Hub, GHCR, ECR, local
build — wherever it currently lives). Both overlays are always created; do not ask
which cluster.

The archetype-specific fields are listed in the workload archetypes steering file. Ask
for those, plus secrets, egress destinations, and whether the app needs an Ingress.

Take defaults for anything else from the project profile rather than asking.

Name every manifest file after its Kubernetes Kind (lowercase): `application.yaml`,
`deployment.yaml`, `networkpolicy.yaml`. If that Kind already has a file in the
directory, add a suffix (`deployment-<role>.yaml`). Overlay patches are
`{kind}-patch.yaml`. See gitops-conventions.

## 2. Resolve the image into ECR

Manifests always pull from the project ECR, with the repository named after the app.
The repository is managed elsewhere — assume it already exists:

```text
111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>:<tag>
```

If the source is already that repository, record its digest and continue. Otherwise:

1. Pull the source image, retag it as
   `111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>:<tag>`, and push.
2. Record the resulting digest.

If the image has not been pushed yet (cannot obtain a real digest), use the 64-hex
dummy digest so the scaffold passes validation:

- Dev: `sha256:0000000000000000000000000000000000000000000000000000000000000001`
- Prod: `sha256:0000000000000000000000000000000000000000000000000000000000000002`

Never write `docker.io/...`, `ghcr.io/...`, or any other upstream registry into the
manifests. The source is an input; ECR is the deployed image. Do not create the ECR
repository from this workflow.

## 3. Scaffold base

`apps/<app>/base/`:

| File | Contents |
| --- | --- |
| `namespace.yaml` | Namespace with `labels.name: <app>` and `labels.owner: platform` |
| `application.yaml` | Argo CD Application using the profile defaults |
| `kustomization.yaml` | Lists the above |
| `manifests/` | Archetype manifests, for plain-manifest apps |

For plain-manifest apps, `base/manifests/` holds `serviceaccount.yaml`,
`networkpolicy.yaml`, and the workload itself, with its own `kustomization.yaml`.

Label every resource as in the gitops-conventions steering file:

- Namespace: `name: <app>`, `owner: platform`
- Workloads / SA / NetworkPolicy / pod templates: `app.kubernetes.io/name: <app>`,
  `owner: platform`
- Selectors and NetworkPolicy `podSelector`: `app.kubernetes.io/name: <app>`
- Manifests `kustomization.yaml` common label: `app.kubernetes.io/part-of: <app>`

`networkpolicy.yaml` must include `default-deny-all` plus one allow NetworkPolicy per
required flow (DNS always; HTTPS, Pod Identity, SSH, ingress as needed). Every container
must declare explicit CPU and memory `requests` and `limits`.

For `web-service`, every HTTP container needs readiness and liveness probes. Default
Deployment rolling update to `maxUnavailable: 0` / `maxSurge: 1`. When desired replicas
(or KEDA/HPA min) are **>= 2**, add `poddisruptionbudget.yaml` with `minAvailable: 1`.
Never add that PDB while `replicas: 1` — it causes `DisruptionBlocked` on node
replacement; either raise replicas then keep the PDB, or drop the PDB and rely on
rollingUpdate for rollouts only.

Base image: `111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>:<tag>`. Overlay
digests pin the same repository.

## 4. Scaffold both overlays

Create `apps/<app>/overlays/dev-eks-1/` and `apps/<app>/overlays/prod-eks-1/`. Both are
required — never scaffold one and leave prod for promotion time.

| File | Contents |
| --- | --- |
| `kustomization.yaml` | `resources: [../../base]` plus patches |
| `application-patch.yaml` | Rewrites `source.path` to the overlay's `manifests/` |
| `manifests/` | Cluster-specific patches |

Overlay patches cover the pinned image digest
(`111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>:<tag>@sha256:<64-hex-digest>`),
replica count or scaling bounds, resource sizing, and the ingress hostname. Start prod
as a copy of dev and change only what genuinely differs.

When the real digest is not yet known at scaffold time, use a 64-hex dummy:

- Dev: `sha256:0000000000000000000000000000000000000000000000000000000000000001`
- Prod: `sha256:0000000000000000000000000000000000000000000000000000000000000002`

Never write `REPLACE_WITH_ACTUAL_DIGEST` — it fails the disallowed-tags constraint.
These dummies pass `gator test --deny-only` but are not deployable; replace with the
real digest after pushing the image to ECR.

### Account-specific annotations belong in overlays

Any annotation containing an AWS account ID must live in the overlay's
`ingress-patch.yaml`, not in base. Dev and prod are separate AWS accounts, so
these ARNs differ per cluster:

| Annotation | Dev overlay (account `111122223333`) | Prod overlay (account `444455556666`) |
| --- | --- | --- |
| `alb.ingress.kubernetes.io/certificate-arn` | `arn:aws:acm:ap-southeast-2:111122223333:certificate/00000000-0000-0000-0000-000000000001` | `arn:aws:acm:ap-southeast-2:444455556666:certificate/00000000-0000-0000-0000-000000000002` |
| `alb.ingress.kubernetes.io/wafv2-acl-arn` | `arn:aws:wafv2:ap-southeast-2:111122223333:regional/webacl/<app>/00000000-0000-0000-0000-000000000001` | `arn:aws:wafv2:ap-southeast-2:444455556666:regional/webacl/<app>/00000000-0000-0000-0000-000000000002` |

When the real ARN is known, use it. When it is not yet known (initial scaffold), use
the shape-valid dummies shown above. They pass `gator test --deny-only` because they
match the WAFv2 regex (`arn:aws:wafv2:<region>:<12-digit>:regional/webacl/<name>/<uuid>`)
and the ACM ARN shape. They are **not** deployable — replace every dummy with a real
ARN before the app reaches a live cluster.

Never write bare tokens like `REPLACE_WITH_CERT_ID` or `REPLACE_WITH_WEBACL_ID` — those
fail Gatekeeper validation offline and in CI.

Base `ingress.yaml` carries only account-neutral annotations (`scheme`,
`target-type`, `listen-ports`, `kubernetes.io/ingress.allow-http`). The TLS
section (`spec.tls`) is also overlay-specific because the hostname differs per
environment. Each overlay's `ingress-patch.yaml` adds:

- `certificate-arn` with the correct account
- `wafv2-acl-arn` with the correct account
- `spec.tls` with the environment hostname
- `spec.rules[].host` with the environment hostname

When `secrets` is not `none`, each overlay's `manifests/` must also include
`secretproviderclass.yaml` from the identity and secrets steering file, plus the CSI
volume, mount, and `secretKeyRef` env in the workload patch. Both overlays get an SPC —
secret paths often differ per environment.

## 5. Declare the app's IAM

Create `apps/<app>/iam.tf` with the IAM policy and the Pod Identity association. The
identity and secrets steering file has the exact shape — copy it, fill `<app>` /
`<cluster>`, and replace the policy statement with what the app actually calls.

If the app uses a SecretProviderClass, the policy must include
`secretsmanager:GetSecretValue` (and `kms:Decrypt` when the secret is CMK-encrypted)
scoped to those secret ARNs.

Write the policy from what the app actually calls: explicit actions, explicit resource
ARNs. If the app calls no AWS APIs and has no secrets, it still needs a ServiceAccount
but no `iam.tf`.

## 6. Supporting files

- `apps/<app>/README.md` — **required for every app** (see gitops-conventions
  “App README”). Match kube-devops-apps / `fmp-polling` shape: purpose, then
  `## Inputs and outputs` with Mermaid `flowchart LR` subgraphs
  (`inputs` / workers / `outputs`) and labeled edges from real config; tables under
  the diagram; image/IAM/networking as needed. Must pass markdown lint
  (`.markdownlint.json`).
- `apps/<app>/renovate.json` — digest bump config for the overlay pin files, if the repo
  uses Renovate. Extend it from the root config.

## 7. Validate

```bash
kustomize build apps/<app>/base
for c in dev-eks-1 prod-eks-1; do
  kustomize build apps/<app>/overlays/$c
  kustomize build apps/<app>/overlays/$c/manifests
done
terraform fmt -check apps/<app>
npx --yes markdownlint-cli2 "apps/<app>/README.md"
```

Then run the policy checks for whatever `policy_engine` is set to. See the policy
validation steering file — in particular, validate against expanded Pod templates, not
the controller manifests alone.

Fix violations before committing. An admission failure surfaces as an Argo CD sync that
sits in a degraded state, which is a much slower way to learn about a missing resource
limit.

## Rolling out

Apply the app's Terraform, then let dev sync and confirm the app is healthy and can
reach its AWS dependencies. Only then promote the digest to the prod overlay.
