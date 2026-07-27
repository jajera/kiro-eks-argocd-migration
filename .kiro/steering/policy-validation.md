---
inclusion: fileMatch
fileMatchPattern: ["apps/**/*.yaml", "apps/**/*.yml", "policies/**", "scripts/**"]
---

# Policy Validation

Validate manifests locally before committing. Catching an admission failure in the
editor is cheaper than catching it as a stuck Argo CD sync.

Which checks apply depends on `policy_engine` in the project profile. When it is
`none`, run the Kustomize builds and skip the rest.

## Always

```bash
kustomize build apps/<app>/base
kustomize build apps/<app>/overlays/<cluster>
kustomize build apps/<app>/overlays/<cluster>/manifests   # plain-manifest apps
```

## Gatekeeper

Pinned CLI (same as CI; not the Helm chart version):

| Item | Value |
| --- | --- |
| Gator | **3.22.0** |
| linux-amd64 SHA-256 | `45ba8c54a22261473bddf6f4f18b154058d45b0c64f3e7a67b2fa781f0791800` |
| darwin-amd64 SHA-256 | `7018a6a3ab98709323cafa8ec70ff8898980b4223baa676903b07c4fa1e34e43` |
| darwin-arm64 SHA-256 | `daa060423355aeed00084ea2bad60bd35b29d22b44fecadd95e6ce83e829bcb5` |

Install via `scripts/install-gator.sh` (checksum pin SOT; same as CI). After install:

```bash
scripts/install-gator.sh
gator verify infrastructure/gatekeeper/tests/...
scripts/gatekeeper-gator-test.sh apps/<app>/overlays/<cluster>/manifests
```

`POLICY_DIR` defaults to the in-repo `policies/` bundle. Override it only when testing
against an external policy set. The script selects the cluster-specific overlay
(`policies/overlays/<cluster>/`) when one exists, otherwise falls back to
`policies/base`. It skips cleanly when `gator`, `kustomize`, or the policy directory is
unavailable, so it is safe to call unconditionally. Hooks use these same commands when
`policy_engine` is `gatekeeper`.

### Apply order

Argo CD -> Gatekeeper operator -> policies. The operator must be healthy (CRDs
registered) before ConstraintTemplates or Constraints land. Sync waves enforce this on
the cluster; locally, `gator` validates offline without requiring a running operator.

### Pod templates must be expanded

This is the trap that makes local validation lie to you. Constraints written against
`kind: Pod` — resource limits, privilege escalation, security context — do not match a
Deployment or CronJob document. A bare `gator test` over workload YAML reports PASS
while the live admission webhook rejects the same manifests.

`scripts/expand-pod-templates.py` synthesises a Pod from each controller's pod template
so the Pod-scoped constraints have something to match. It emits multi-document YAML with
`---` separators; without separators the documents collapse into one and the synthetic
Pods disappear silently.

### deny vs dryrun

The script runs `gator test --deny-only` so that constraints in `dryrun` warn without
failing the check, matching cluster admission behaviour. Still fix dryrun findings when
it is practical — they are usually the next constraint to be promoted to `deny`.

## Common violations

| Violation | Fix |
| --- | --- |
| Container missing CPU or memory requests/limits | Set both `requests` and `limits` on *every* container, including init containers and sidecars |
| Namespace missing required label | Add `labels.name` and `labels.owner` to `namespace.yaml` |
| Workload / SA / NetPol missing labels | Add `app.kubernetes.io/name: <app>` and `owner: platform` |
| Selector / NetPol podSelector mismatch | Both must use `app.kubernetes.io/name: <app>` |
| Deploying to the default namespace | Give the app its own namespace and set `destination.namespace` |
| Privilege escalation allowed | Set `allowPrivilegeEscalation: false` and drop all capabilities |
| Floating image tag | Pin the overlay image as `repo:tag@sha256:<digest>` |
| Running as root | Set `runAsNonRoot: true` and an explicit non-zero `runAsUser` |
| No NetworkPolicy / missing deny | Add `default-deny-all`, then one allow policy per required flow |
| Combined allow rules in one NetworkPolicy | Split into one NetworkPolicy object per allow |
| Secrets without SecretProviderClass | Add overlay `secretproviderclass.yaml` + CSI mount + `secretKeyRef` |
| SPC without CSI volume mount | Mount `secrets-store` — that is what creates the K8s Secret |
| SPC without `GetSecretValue` in `iam.tf` | Grant the app role read on those SM secret ARNs |
| web-service missing probes | Add readiness and liveness on every HTTP container |
| Multi-replica without PDB | Add `poddisruptionbudget.yaml` with `minAvailable: 1` |
| PDB `minAvailable: 1` with replicas: 1 | Raise replicas to >= 2, or remove the PDB — else `DisruptionBlocked` |

Init containers and short-lived sidecars are the most frequently missed for resources.
They are containers as far as admission is concerned.

## Requirements

`kustomize`, plus `gator` and `python3` with `pyyaml` for Gatekeeper. The default
`POLICY_DIR` is the in-repo `policies/` bundle (`policy_engine: gatekeeper` is active).
