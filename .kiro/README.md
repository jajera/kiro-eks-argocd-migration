# Kiro Configuration

Configures Kiro as a repeatable factory for migrating workloads onto EKS managed by
Argo CD, across `dev-eks-1` and `prod-eks-1`.

Environment-specific values live in `steering/project-profile.md`; every other file
refers to those keys by name rather than hard-coding them.

## Structure

```text
.kiro/
  steering/                      # Reference knowledge, loaded by inclusion mode
    project-profile.md           # always   — clusters, region, defaults
    gitops-conventions.md        # always   — Argo CD + Kustomize conventions
    workload-archetypes.md       # apps/**  — the five archetypes and their inputs
    identity-and-secrets.md      # apps/**  — iam.tf shape, Pod Identity, secrets
    policy-validation.md         # apps/**  — Gatekeeper policy checks
    ci-workflows.md              # .github/ — CI reference
  skills/                        # Workflows, activated by intent
    migrate-workload/SKILL.md    # gated eight-phase migration
      references/                # loaded on demand during execution
    add-app/SKILL.md             # scaffold a new app
    promote-app/SKILL.md         # copy verified digest to prod
    manage-clusters/SKILL.md     # bootstrap and ApplicationSet discovery
  hooks/                         # Checks that fire on file events
    validate-app-scaffold.kiro.hook
    validate-infra-scaffold.kiro.hook
    policy-validate.kiro.hook
    kustomize-build-check.kiro.hook       # fileCreated
    kustomize-build-check-on-edit.kiro.hook
    gator-test-on-create.kiro.hook
    gator-test-on-edit.kiro.hook
    block-infra-commands.kiro.hook
  agents/eks-migration.json      # Agent bundling the steering and skills
  settings/mcp.json              # MCP server configuration
```

## Steering vs skills

Steering is knowledge that shapes how Kiro writes YAML: conventions, constraints,
policies. Skills are workflows with an order and a stopping condition.

The split matters because duplicating a workflow into steering means it loads on every
interaction and drifts out of sync with the skill. Conventions belong in steering,
procedures belong in skills, and neither should restate the other.

## Inclusion modes

Set as YAML frontmatter at the very top of the file:

| Mode | Frontmatter | Loaded |
| --- | --- | --- |
| Always | `inclusion: always` | Every interaction |
| Conditional | `inclusion: fileMatch` plus `fileMatchPattern` | When matching files are in play |
| Manual | `inclusion: manual` | Only when referenced with `#file-name` |

Keep `always` for things that are genuinely universal. Everything else should be
conditional, or it is just context budget spent on irrelevance.

## Skills

Kiro discovers skills as `.kiro/skills/<name>/SKILL.md`, with frontmatter carrying
`name` (matching the directory) and `description`. A flat `.kiro/skills/<name>.md` file
is never loaded.

The `description` is what Kiro matches against a request, so it should read like the
things people actually ask for, not like a title.

`migrate-workload` uses progressive disclosure: the description decides activation, the
body carries the phase workflow, and `references/` holds detail that is only read when
the relevant phase starts.

## MCP servers

`settings/mcp.json` configures:

| Server | Purpose |
| --- | --- |
| `aws-knowledge` | AWS documentation and current service behaviour (remote HTTP; no AWS creds) |
| `eks` | Cluster and Kubernetes resource inspection, read-only |
| `kubernetes` | Live cluster state |
| `filesystem` | Local file access |

Set `AWS_PROFILE` / `AWS_REGION` in the `eks` server's `env` and `--profile` / `--region`
args before use (defaults here: profile `dev`, region `ap-southeast-2`). Leave `eks`
and `kubernetes` `disabled: true` until credentials and a live cluster exist; keep
`aws-knowledge` enabled — it does not need a cluster. The `eks` server runs read-only —
the migration writes YAML into Git and lets Argo CD apply it, rather than mutating the
cluster directly.

## Getting started

1. Fill in `steering/project-profile.md` — the real account IDs (`owner` is `platform`).
2. Set `AWS_PROFILE` in `settings/mcp.json` (region is already `ap-southeast-2`).
3. Policy validation is enabled — `policy_engine: gatekeeper` uses the in-repo
   `policies/` bundle. Install gator **3.22.0** (see root README) so hooks can run
   `gator verify` / `gatekeeper-gator-test.sh` locally.
4. Ask Kiro to migrate something.
