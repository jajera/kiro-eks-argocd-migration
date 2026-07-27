---
name: migrate-workload
description: Migrate a workload running on EC2, ECS, Docker Compose, or a virtual machine onto EKS managed by Argo CD. Use when the user asks to migrate, move, port, containerise, or modernise an existing application onto Kubernetes or EKS, or mentions moving off EC2/ECS/Compose.
---

# Migrate a workload to EKS with Argo CD

An eight-phase migration with a gate at the end of each phase. Do not start a phase
until the previous gate has passed. If a gate fails, fix the cause and re-run that
phase; do not work around it by skipping ahead.

The source workload stays live until Phase 7. Every phase before that is additive, so
there is a rollback path at all times.

Read `references/` files only when the phase that needs them begins — they are detail,
not context you need up front.

## Phase 0 — Discover

Build an inventory of the source workload. Use the AWS MCP tools to read live
configuration rather than asking the user to retype it; ask only for what you cannot
observe.

Capture: runtime and version, entrypoint, listening ports, environment variables,
secrets and where they come from, mounted volumes and whether they hold state, CPU and
memory in use, health check endpoint, outbound dependencies, inbound traffic path, IAM
permissions in use, log destination, and current scaling behaviour.

`references/discovery-checklist.md` has the per-source-type commands.

**Gate:** the inventory is complete and every environment variable and IAM permission is
accounted for. Any unresolved `unknown` is a blocker, not a footnote.

## Phase 1 — Containerise

Skip if a suitable image already exists.

Write a Dockerfile: multi-stage, minimal runtime base, non-root user, no secrets in
layers, explicit `EXPOSE`, and a `HEALTHCHECK` where the runtime supports one. Build for
`linux/amd64` unless the cluster runs arm64 nodes.

Run it locally with the same environment variables as production.

**Gate:** the container starts and its health endpoint responds successfully.

## Phase 2 — Publish the image

Push into the existing project ECR repository named after the app. Do not create the
repository — it is managed elsewhere. Retag and push:

```text
111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>:<tag>
```

If the source already lives on Docker Hub, GHCR, or elsewhere, retag and push into that
ECR repository — do not leave the upstream registry in the manifests.

**Gate:** the image is resolvable by digest from
`111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>`.

## Phase 3 — Cluster readiness

Confirm the target cluster exists and has what the workload needs: an ingress
controller if the app serves traffic, a CSI driver if it needs volumes, an autoscaler if
it is a `queue-worker`, and the secrets backend named in the project profile.

On EKS Auto Mode the load balancer controller, storage driver, and node lifecycle are
managed for you — do not install them.

**Gate:** every required controller or CRD is present. Missing platform components are a
change to `<platform-repo>`, not something to bundle into the app.

## Phase 4 — Identity and secrets

Write `apps/<app>/iam.tf` from the permissions inventoried in Phase 0, not from a copy
of the source instance profile. It declares the IAM policy and the Pod Identity
association — see the identity and secrets steering file for the shape, and
`references/iam-templates.md` if the app needs IRSA instead.

When the app needs Secrets Manager values, create
`overlays/<cluster>/manifests/secretproviderclass.yaml` for **both** clusters from
the same steering snippet (`region: ap-southeast-2`, `usePodIdentity: "true"`,
`secretObjects` for env keys). Wire the CSI volume, mount, and `secretKeyRef` in the
overlay workload patch. Add `secretsmanager:GetSecretValue` on those secret ARNs to
`iam.tf`.

Apply Terraform for `dev-eks-1` now; prod follows at promotion. SM secret *values* are
created out of band — this workflow only references them.

**Gate:** the association exists and resolves to the intended ServiceAccount, every
secret path referenced by the manifests exists in Secrets Manager, and both overlays
have a matching SecretProviderClass when secrets are required.

## Phase 5 — Generate GitOps manifests

Choose the archetype, then scaffold base and both overlays. Follow the `add-app` skill
for file-by-file detail — this phase is that skill with the inventory already in hand.

Translate the inventory rather than transcribing it:

| Source | Kubernetes |
| --- | --- |
| Instance count | `replicas`, or autoscaler bounds |
| Instance type sizing | Resource requests and limits from observed usage |
| Instance profile | Per-workload IAM role |
| Security group rules | NetworkPolicy |
| Load balancer listener | Service plus Ingress |
| `.env` file or Parameter Store lookups at boot | Overlay SecretProviderClass + `secretKeyRef` |
| Host log agent | Container stdout plus a cluster log forwarder |
| Cron entry on the host | CronJob |

`references/manifest-patterns.md` has the manifest skeletons.

**Gate:** `kustomize build` succeeds for base and both overlays, and policy validation
passes. See the policy validation steering file.

## Phase 6 — Sync and verify on dev

Commit on a branch and open a pull request. Let CI run. After merge, the ApplicationSet
picks up the new overlay and Argo CD syncs it to `dev-eks-1`.

Verify the Application reports `Synced` and `Healthy`, all pods are Running and Ready,
logs show no startup errors, the app can reach its AWS dependencies through its new
role, and the health endpoint responds through the new load balancer.

**Gate:** Argo CD reports Healthy on `dev-eks-1` and the health endpoint responds.

## Phase 7 — Promote and cut over

Use the `promote-app` skill for the digest copy. Summary:

1. Apply `iam.tf` for `prod-eks-1` if the association is not already there.
2. Copy the verified image digest from the `dev-eks-1` overlay pin to the `prod-eks-1`
   overlay pin. Do not rebuild.
3. Merge, then confirm `<app>-prod-eks-1` is `Synced` and `Healthy`.

Then shift traffic at DNS. Use weighted routing for a gradual shift when the app is
user-facing. Watch error rates and latency across the shift.

**Gate:** all traffic is on the new endpoint and error rates match the pre-migration
baseline.

### Rollback (named path — keep it available until Phase 8)

The source workload and its load balancer stay up through Phase 7. Until decommission:

| Problem | Action |
| --- | --- |
| Prod Argo app unhealthy after digest promote | Revert the promote PR (or restore the previous prod digest); leave digests alone |
| Errors spike after DNS weight shift | Move DNS weight back to the old endpoint; leave the EKS app running |
| Need a hard abort | Point DNS fully at the old stack; do not delete EKS resources yet |

Do not start Phase 8 until cutover has been stable for a full business cycle. Rollback
after decommission is a rebuild, not a flip.

## Phase 8 — Decommission

Only after the cutover has been stable long enough to trust — a full business cycle at
minimum. Remove the old compute, its load balancer and target groups, its instance
profile, and any deployment artefacts. Record what was deleted.

**Gate:** explicit human confirmation. Never delete source infrastructure automatically.

## Post-migration

Do not treat the migration as finished at cutover. Three things reliably break later if
skipped:

- **Observability.** Host-level dashboards keyed on instance IDs are now meaningless.
  Rebuild them around pod, deployment, and namespace dimensions, and forward container
  stdout to your log backend.
- **Alerting.** Add alerts for pod restart counts, rollout failures, and error rate at
  the ingress. The old instance-health alarms no longer fire on anything real.
- **Runbooks.** Instance-based procedures do not translate. There is no SSH to a node on
  EKS Auto Mode. Rewrite them around `kubectl logs`, `kubectl describe pod`,
  `kubectl rollout restart`, and ephemeral debug containers before the next incident,
  not during it.

## Scope

This workflow assumes a stateless workload. Stateful workloads need persistent volume
claims, a StatefulSet, and a data migration plan with its own cutover — treat that as a
separate exercise and do not fold it into these phases.
