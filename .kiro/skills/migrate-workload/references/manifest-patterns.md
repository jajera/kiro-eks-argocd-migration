# Manifest Patterns

Skeletons for Phase 5. Substitute values from the project profile. These show structure
and the fields that are easy to get wrong, not every field you may need.

## Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: <app>
  labels:
    name: <app>
    owner: platform
```

## ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: <app>
  labels:
    app.kubernetes.io/name: <app>
    owner: platform
```

## Workload labels and selectors

Every workload resource, its pod template, and its selector use the same name label:

```yaml
metadata:
  name: <app>
  labels:
    app.kubernetes.io/name: <app>
    owner: platform
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: <app>
  template:
    metadata:
      labels:
        app.kubernetes.io/name: <app>
        owner: platform
```

Manifests `kustomization.yaml` also applies:

```yaml
labels:
  - pairs:
      app.kubernetes.io/part-of: <app>
```

## Argo CD Application

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: <app>
  namespace: argocd
spec:
  project: <argocd_project>
  source:
    repoURL: <app-repo-url>
    targetRevision: <default_branch>
    path: apps/<app>/base/manifests
  destination:
    name: in-cluster
    namespace: <app>
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

The overlay patches `source.path` to `apps/<app>/overlays/<cluster>/manifests`.

## Container security context and resources

Apply to every container, including init containers and sidecars. Both `requests` and
`limits` for CPU and memory are mandatory — never omit them.

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    cpu: 500m
    memory: 256Mi
```

`readOnlyRootFilesystem: true` needs an `emptyDir` wherever the app writes — usually
`/tmp`, and sometimes a cache or run directory. Check what the app writes before setting
it, rather than reverting it after the first CrashLoopBackOff.

## Probes

Mandatory for every `web-service` HTTP container. Readiness and liveness are both
required. Prefer a shallow readiness path; do not reuse a deep dependency check for
liveness.

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
Workers and CronJobs skip HTTP probes unless they expose an admin port.

## Deployment rolling update

Default for Deployments (especially `replicas: 1` web services):

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
```

Keeps service up during rollouts by surging first. Does not replace a PDB for drains.

## PodDisruptionBudget

When desired replicas (or KEDA/HPA min) are **>= 2**, add `poddisruptionbudget.yaml`
with `minAvailable: 1`:

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

Do **not** leave this PDB on a single-replica Deployment — that is the
`DisruptionBlocked` failure mode. Raise replicas to >= 2, or remove the PDB.

## Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: <app>
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/healthcheck-path: /health
spec:
  ingressClassName: <ingress_class>
  rules:
    - host: <hostname>
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: <app>
                port: { name: http }
```

Applying this provisions a *new* load balancer. The source load balancer keeps serving
until DNS is shifted in Phase 7, which is what makes the cutover reversible.

## NetworkPolicy

Always `default-deny-all`, then one NetworkPolicy per allow. Never combine allows.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  labels:
    app.kubernetes.io/name: <app>
    owner: platform
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  labels:
    app.kubernetes.io/name: <app>
    owner: platform
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: <app>
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-https-egress
  labels:
    app.kubernetes.io/name: <app>
    owner: platform
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: <app>
  policyTypes:
    - Egress
  egress:
    - ports:
        - protocol: TCP
          port: 443
---
# Required when the app calls AWS APIs via Pod Identity.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-pod-identity-egress
  labels:
    app.kubernetes.io/name: <app>
    owner: platform
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: <app>
  policyTypes:
    - Egress
  egress:
    - to:
        - ipBlock:
            cidr: 169.254.170.23/32
      ports:
        - protocol: TCP
          port: 80
```

Add further single-purpose policies as needed (`allow-ssh-egress` for TCP 22,
`allow-http-ingress` for the Service port, and so on). A default-deny that forgets DNS
produces name resolution failures that look like network outages — ship DNS with the
deny in the same commit.

## SecretProviderClass

When `secrets` is not `none`, put this in **each** overlay
(`overlays/<cluster>/manifests/secretproviderclass.yaml`). Same shape as the identity
and secrets steering file — do not invent another layout.

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: <app>
  labels:
    app.kubernetes.io/name: <app>
    owner: platform
  annotations:
    argocd.argoproj.io/sync-wave: "-4"
spec:
  provider: aws
  parameters:
    region: ap-southeast-2
    usePodIdentity: "true"
    objects: |
      - objectName: "<sm-secret-name>"
        objectType: "secretsmanager"
        jmesPath:
          - path: <json-key>
            objectAlias: <alias>
  secretObjects:
    - secretName: <app>
      type: Opaque
      data:
        - objectName: <alias>
          key: <env-var-name>
```

Wire the CSI volume, mount at `/mnt/secrets-store`, and `secretKeyRef` env in the same
overlay's workload patch. The mount is what materialises the Kubernetes Secret.

## KEDA ScaledObject

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: <app>
  annotations:
    argocd.argoproj.io/sync-wave: "2"
spec:
  scaleTargetRef:
    name: <app>
  minReplicaCount: 0
  maxReplicaCount: 10
  triggers:
    - type: aws-sqs-queue
      authenticationRef:
        name: <app>-trigger-auth
      metadata:
        queueURLFromEnv: QUEUE_URL
        queueLength: "5"
        awsRegion: ap-southeast-2
```

The Deployment must declare the same floor the autoscaler uses, and the Application
needs `ignoreDifferences` on `/spec/replicas`, or Argo CD will keep resetting the
replica count the autoscaler just changed.
