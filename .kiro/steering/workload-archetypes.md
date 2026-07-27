---
inclusion: fileMatch
fileMatchPattern: ["apps/**/*.yaml", "apps/**/*.yml", "apps/**/*.md"]
---

# Workload Archetypes

Every migrated workload maps to one of five archetypes. Pick the archetype first — it
determines which manifests get scaffolded and which inputs are mandatory.

| Archetype | Use when | Core manifests |
| --- | --- | --- |
| `web-service` | Serves HTTP to users or other services | Deployment, Service, Ingress |
| `worker` | Always-on background processing, no inbound traffic | Deployment |
| `queue-worker` | Event-driven, scales on queue depth | Deployment, ScaledObject, TriggerAuthentication |
| `scheduled-job` | Runs periodically then exits | CronJob |
| `helm-chart` | An upstream chart is a better fit than raw manifests | Application pointing at the chart |

Every archetype except `helm-chart` also gets `serviceaccount.yaml` and
`networkpolicy.yaml` in base.

## Choosing between them

- A process that loops with an internal `sleep` is a `scheduled-job`, not a `worker`.
  Let the CronJob controller own the schedule so failures are visible as failed Jobs.
- A `worker` that polls a queue on a timer is a `queue-worker`. Scaling on queue depth
  is the reason to migrate it at all.
- A workload that both serves HTTP and consumes a queue should be split into two apps
  unless they genuinely share in-process state.

## Required inputs per archetype

Collect these before creating any files. Do not scaffold with placeholder values for
archetype-critical fields — a half-populated tree is harder to fix than an empty one.

Always required: `app_name`, `archetype`, and a source `image` (any registry or a local
build). Both cluster overlays are always created.

The deployed image is never the source registry. It is always the existing project ECR
repository named after the app:
`111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>`. Mirror the source there
before writing manifests. Do not create the ECR repository.

| Archetype | Also required |
| --- | --- |
| `web-service` | container port, health check path, hostname (if `ingress: true`); readiness + liveness probes |
| `worker` | none beyond the common set |
| `queue-worker` | queue URL or name per worker role, number of roles, scaling bounds |
| `scheduled-job` | `schedule` (cron expression), `timeZone` (defaults to `<default_timezone>`) |
| `helm-chart` | chart repo, chart name, chart version |

Ask about these when relevant to any archetype:

- `secrets` — secret store paths and keys, or `none`
- `config` — ConfigMap, or a remote object the app fetches itself (see below)
- `egress` — which destinations and ports the app needs to reach
- `ingress` — whether it needs an Ingress at all
- `iam` — which AWS APIs it calls, so the role policy can be scoped

## Hardening (every plain-manifest app)

- Explicit CPU and memory `requests` and `limits` on every container, including init
  containers and sidecars.
- `networkpolicy.yaml` with `default-deny-all`, then one allow NetworkPolicy per required
  flow (DNS always; HTTPS / Pod Identity / SSH / ingress as needed). Never combine
  allows into one object.
- Labels as in gitops-conventions: Namespace `name` + `owner`; everything else
  `app.kubernetes.io/name` + `owner`; selectors and NetPol `podSelector` use
  `app.kubernetes.io/name`; manifests kustomization adds `app.kubernetes.io/part-of`.
- When secrets are needed: overlay `secretproviderclass.yaml` (both clusters) from the
  identity and secrets steering file, plus CSI mount and `secretKeyRef` in the workload
  patch, and `secretsmanager:GetSecretValue` in `iam.tf`.
- `web-service`: readiness and liveness probes on every HTTP container; Deployment
  `rollingUpdate.maxUnavailable: 0` / `maxSurge: 1`.
- replicas (or autoscaler min) >= 2: `poddisruptionbudget.yaml` with
  `minAvailable: 1`. Never leave that PDB on a single-replica app (blocks drains).

## Configuration

Prefer a ConfigMap for small, mostly-static configuration. When an app already reads a
config document from object storage (for example `-config s3://bucket/key.json`), keep
that mechanism and grant `GetObject` through the workload's IAM role rather than
translating it into a ConfigMap. Rewriting a working config-loading path is migration
risk with no payoff.

## queue-worker specifics

- **One app, N Deployments.** Multiple worker roles that share an image belong in a
  single app, differentiated by the queue environment variable in overlay patches.
- **Scaling.** One `ScaledObject` per Deployment. Share a single
  `TriggerAuthentication` across them.
- **Sync waves.** ServiceAccount and TriggerAuthentication at wave `0`, Deployments at
  `1`, ScaledObjects at `2`. The autoscaler must not start before its auth exists.
- **Permissions.** Both the workload and the autoscaler operator need read access to
  the queue: the workload to consume, the operator to read queue depth.

## scheduled-job specifics

- Mount secrets on each Job pod directly. Do not run a long-lived pause Deployment
  purely to keep a secret synced — it costs a pod around the clock for nothing.
- Set `readOnlyRootFilesystem: true` and give the job an `emptyDir` at `/tmp`.
- Set `successfulJobsHistoryLimit` and `failedJobsHistoryLimit` so completed Jobs do not
  accumulate.
- Set `concurrencyPolicy: Forbid` unless overlapping runs are genuinely safe.

## Documentation

Each app gets `apps/<app>/README.md` covering what it does, its inputs and outputs, its
schedule or trigger, and which AWS resources it touches. For scheduled jobs and queue
workers include a small Mermaid diagram of the data flow — those are the apps whose
behaviour is least obvious from the manifests.
