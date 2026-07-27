---
inclusion: fileMatch
fileMatchPattern: ["apps/**/*.yaml", "apps/**/*.yml"]
---

# Identity and Secrets

How a workload gets AWS credentials and secret material. The single biggest security
change when moving from instances to pods is that identity stops being host-wide and
becomes per-workload — take advantage of it rather than recreating the old shared role.

## Each app declares its own IAM

Every app carries `apps/<app>/iam.tf`: an IAM policy for what the app may call, and a
Pod Identity association binding that role to the app's namespace and ServiceAccount.
Repeat the pattern once per cluster (or once per account) as needed.

```hcl
# Replace with the API calls this app actually makes. Explicit actions, explicit ARNs.
data "aws_iam_policy_document" "app" {
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::<bucket>/*"]
  }

  # When using SecretProviderClass, also allow:
  # statement {
  #   effect    = "Allow"
  #   actions   = ["secretsmanager:GetSecretValue"]
  #   resources = ["arn:aws:secretsmanager:ap-southeast-2:<account>:secret:<sm-secret-name>*"]
  # }
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "<cluster>-<app>"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
}

resource "aws_iam_role_policy" "app" {
  name   = "<app>"
  role   = aws_iam_role.app.name
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_eks_pod_identity_association" "app" {
  cluster_name    = "<cluster>"
  namespace       = "<app>"
  service_account = "<app>"
  role_arn        = aws_iam_role.app.arn
}
```

Because the association is the binding, the ServiceAccount needs no annotation and the
manifests stay free of account IDs and role ARNs.

Apply Terraform before the app syncs. A pod whose association does not exist yet starts
normally and fails its first AWS call, which reads as an application bug rather than
missing infrastructure.

## Scoping the policy

Migrating an instance profile is the moment to shrink it. An EC2 instance profile is
usually the union of everything any process on that host ever needed.

1. List the AWS API calls the workload actually makes.
2. Grant only those actions, scoped to specific resource ARNs.
3. Give each workload its own role. Do not share one role across apps.
4. Do not carry over wildcard actions or `Resource: "*"` from the instance profile.

## IRSA

Pod Identity is not supported on Fargate. If an app ever lands there, it needs an OIDC
trust policy and an `eks.amazonaws.com/role-arn` annotation on the ServiceAccount
instead, plus the same treatment for any operator acting on its behalf. Restart the
Deployment after changing the annotation — credentials resolve at pod start.

## Secret material

When an app needs secrets from AWS Secrets Manager, it gets a
`secretproviderclass.yaml` in **each** overlay — same idea as `iam.tf`: one fixed
shape, fill in the names. Never invent a different layout.

Required pieces when `secrets` is not `none`:

| Piece | Where |
| --- | --- |
| `overlays/<cluster>/manifests/secretproviderclass.yaml` | SPC + optional `secretObjects` |
| CSI volume + mount on the workload | Overlay patch (`deployment-patch` / `cronjob-patch`) |
| `secretKeyRef` env vars | Same overlay patch, for values the app reads as env |
| `secretsmanager:GetSecretValue` (and `KMSDecrypt` if needed) | App's `iam.tf` policy |
| `allow-https-egress` + `allow-pod-identity-egress` | `networkpolicy.yaml` |

Secret paths differ per environment, so the SPC lives in the overlay, not base. Create
it for both `dev-eks-1` and `prod-eks-1`.

### Canonical SecretProviderClass

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

SM secrets must be JSON objects so `jmesPath` can select keys. A raw string secret cannot
be selected reliably.

### Wiring the workload (overlay patch)

```yaml
# volumes (pod spec)
- name: secrets-store
  csi:
    driver: secrets-store.csi.k8s.io
    readOnly: true
    volumeAttributes:
      secretProviderClass: <app>
- name: tmp
  emptyDir: {}

# container
env:
  - name: <env-var-name>
    valueFrom:
      secretKeyRef:
        name: <app>
        key: <env-var-name>
volumeMounts:
  - name: secrets-store
    mountPath: /mnt/secrets-store
    readOnly: true
  - name: tmp
    mountPath: /tmp
```

The CSI mount is what creates the Kubernetes Secret from `secretObjects`. Env via
`secretKeyRef` alone is not enough — without the volume, the Secret never appears and
the pod fails to start.

Rules:

- Never bake secrets into the image and never commit them to Git.
- Prefer `secretObjects` + `secretKeyRef` for values the app reads as env.
- Grant the workload role read access only to the specific SM secret ARNs it needs.
- Do not put OpenSSH private keys in `secretObjects` — see below.

## Private keys and other permission-sensitive files

Some consumers reject files that are group- or world-readable. OpenSSH is the common
case: it refuses a private key that is not mode `0600`, and CSI mounts are typically
`0644`. Three things are needed beyond the mount itself:

| Need | Solution |
| --- | --- |
| Mode `0600` key file | initContainer copies the mount to an `emptyDir` and `chmod 600` |
| A passwd entry for the run-as UID | ConfigMap mounted at `/etc/passwd` when the image has no entry |
| A writable HOME | Set `HOME=/tmp` and back it with an `emptyDir` |

Sketch of the initContainer:

```yaml
initContainers:
  - name: prepare-key
    image: 111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/busybox:<tag>@sha256:<digest>
    command: ["sh", "-c", "cp /mnt/secrets-store/key /keys/key && chmod 600 /keys/key"]
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      runAsNonRoot: true
      capabilities: { drop: ["ALL"] }
    resources:
      requests: { cpu: 10m, memory: 16Mi }
      limits: { cpu: 100m, memory: 64Mi }
    volumeMounts:
      - { name: secrets-store, mountPath: /mnt/secrets-store, readOnly: true }
      - { name: keys, mountPath: /keys }
```

Mount the `emptyDir` read-only in the main container.

Do not mirror a private key into a Kubernetes Secret via CSI `secretObjects`. The Secret
is written by the CSI driver on first mount, so a Job that starts before the driver has
synced fails to mount and the pod never recovers on its own.

If the store requires a structured value, store the key as JSON (`{"key": "..."}`) and
extract it with a JMESPath expression in the `SecretProviderClass`. A raw multi-line PEM
stored as a plain string is awkward to select reliably.

## Network policy

Always start with a namespace-wide deny of both directions. Then add one NetworkPolicy
per allow — never fold several allows into a single object. A separate policy per need
makes review and removal obvious.

Required for every plain-manifest app:

| Policy | When |
| --- | --- |
| `default-deny-all` | Always. `podSelector: {}`, `policyTypes: [Ingress, Egress]` |
| `allow-dns-egress` | Always. UDP/TCP 53 to `kube-system` |
| `allow-https-egress` | When the app calls HTTPS (AWS APIs, external APIs) |
| `allow-pod-identity-egress` | When the app uses Pod Identity (`169.254.170.23:80`) |
| `allow-ssh-egress` | When the app needs Git over SSH (TCP 22) |
| `allow-<name>-ingress` | When the app serves traffic — one policy per allowed source |

See `manifest-patterns.md` in the migrate-workload skill for the full YAML shape.

Write these in base when they are the same everywhere. Patch in an overlay only when a
cluster genuinely differs.
