# kiro-eks-argocd-migration

A Kiro configuration for migrating workloads onto Amazon EKS managed by Argo CD, across
two clusters: `dev-eks-1` and `prod-eks-1`.

Point Kiro at an app running on EC2, ECS, or Docker Compose and it works through a
gated migration: discover the workload, containerise it, publish the image, wire up
per-pod identity, generate Kustomize manifests, and let Argo CD sync them. Each phase
has a gate that must pass before the next one starts.

The repo is standalone. Manifests, cluster configuration, and the IAM each app needs all
live here.

## Why a skill rather than a prompt

Without a defined workflow, an agent picks its approach at runtime. It tries a path,
hits an error, retries differently, and produces different results on different days.
Encoding the workflow as a skill with explicit validation gates makes the migration
repeatable: the same phases run in the same order, and the agent cannot skip ahead past
a failed check.

## How it works

1. `.kiro/steering/` holds conventions and constraints, loaded automatically when
   relevant.
2. `.kiro/skills/` holds the workflows — migrating a workload, adding an app, changing
   platform configuration.
3. `.kiro/hooks/` validate scaffolds and admission policy as files change.
4. MCP servers give Kiro live access to AWS and the cluster, so discovery reads real
   configuration instead of guessing.
5. Kiro writes YAML into Git. Argo CD applies it. The agent does not mutate the cluster
   directly.

## Migration phases

| Phase | Gate |
| --- | --- |
| 0. Discover | Inventory complete, nothing unresolved |
| 1. Containerise | Container runs and passes its health check locally |
| 2. Publish image | Image resolvable by digest in the registry |
| 3. Cluster readiness | Required controllers and CRDs present |
| 4. Identity and secrets | Pod Identity association resolves; secret paths exist |
| 5. Generate manifests | `kustomize build` and policy validation pass |
| 6. Sync and verify on dev | Argo CD reports Healthy on `dev-eks-1` |
| 7. Promote and cut over | Prod Healthy; traffic shifted; errors match baseline |
| 8. Decommission | Explicit human confirmation |

The source workload stays live through Phase 6, so there is a rollback path until you
choose to give it up.

## Walkthrough

How `.kiro/` was designed from scratch, hooks, Gatekeeper/gator, and the **Kiro**
thin-prompt `add-app` demo:
**[docs/Walkthrough.md](docs/Walkthrough.md)**. Stills slideshow:
[docs/media/walkthrough/slideshow.html](docs/media/walkthrough/slideshow.html).

## Getting started

1. Fill in `.kiro/steering/project-profile.md` — the real account IDs in place of the
   `111122223333` / `444455556666` placeholders (`owner` is already `platform`).
2. Set `AWS_PROFILE` in `.kiro/settings/mcp.json` (region is already `ap-southeast-2`).
3. Ask Kiro to migrate a workload.

## Repo layout

```text
apps/                    # Root for all application manifests (empty until first add-app)
  <app>/
    base/                # Namespace, Argo CD Application, shared manifests
    overlays/dev-eks-1/  # Cluster-specific patches
    overlays/prod-eks-1/
    iam.tf               # IAM policy + Pod Identity association
bootstrap/
  dev-eks-1/             # Argo CD install and root manifests for dev
  prod-eks-1/            # Argo CD install and root manifests for prod
clusters/
  dev-eks-1/             # ApplicationSet discovering apps/*/overlays/dev-eks-1
    applicationset.yaml
  prod-eks-1/            # ApplicationSet discovering apps/*/overlays/prod-eks-1
    applicationset.yaml
infrastructure/
  gatekeeper/              # OPA Gatekeeper operator, templates, constraints, tests
policies/
  base/                    # Kustomize bundle aggregating templates + constraints
  overlays/dev-eks-1/      # Sync waves + enforcement promotions for dev
  overlays/prod-eks-1/     # Sync waves + enforcement promotions for prod
scripts/                 # Validation helpers
  expand-pod-templates.py
  gatekeeper-gator-test.sh
.github/workflows/       # CI pipelines
  kustomize-build.yml
  markdown-lint.yml
  commitmsg-conform.yml
  policy-validate.yml
.kiro/                   # Agent configuration
  settings/mcp.json
  skills/                # Repeatable workflows (migrate, add-app, promote, manage)
  steering/              # Conventions loaded automatically when relevant
  hooks/                 # File-change validations (kustomize, policy, scaffold)
  agents/                # Custom agent definitions
```

Every app has both overlays. An `ApplicationSet` discovers `apps/*/overlays/<cluster>`
and creates one Argo CD Application per match, named `<app>-<cluster>`. Promotion is
copying the verified image digest from the dev overlay to the prod overlay.

The two clusters live in separate accounts (`111122223333` for dev, `444455556666` for
prod). Each app declares the AWS permissions it needs in its own `iam.tf`, as a scoped
IAM policy plus a Pod Identity association per cluster — so no app inherits another's
credentials, and dev credentials cannot reach prod resources.

## Policy tooling (reproducible)

`policy_engine` is `gatekeeper`. Offline checks use the **gator** CLI pinned to the
same version as CI (distinct from Helm chart **3.21.1**).

| Item | Value |
| --- | --- |
| Gator version | **3.22.0** |
| Release | https://github.com/open-policy-agent/gatekeeper/releases/tag/v3.22.0 |
| linux-amd64 SHA-256 | `45ba8c54a22261473bddf6f4f18b154058d45b0c64f3e7a67b2fa781f0791800` |
| darwin-amd64 SHA-256 | `7018a6a3ab98709323cafa8ec70ff8898980b4223baa676903b07c4fa1e34e43` |
| darwin-arm64 SHA-256 | `daa060423355aeed00084ea2bad60bd35b29d22b44fecadd95e6ce83e829bcb5` |

Install (detects OS/arch; checksum-verified — same script CI runs):

```bash
scripts/install-gator.sh          # → /usr/local/bin/gator
# or: scripts/install-gator.sh "$HOME/bin"
```

SHA pins live in `scripts/install-gator.sh`. The table above is documentation only;
do not invent alternate checksums.

Smoke:

```bash
gator verify infrastructure/gatekeeper/tests/...
# when apps exist:
scripts/gatekeeper-gator-test.sh apps/<app>/overlays/<cluster>/manifests
```

Also useful: `kustomize`, and `terraform` for `iam.tf`. Scripts skip cleanly if a tool is
missing; CI always installs the pinned gator. Bump version only by updating
`scripts/install-gator.sh` (version + SHA map), this README, and
`.kiro/steering/policy-validation.md` together.

## License

MIT. See [LICENSE](LICENSE).
