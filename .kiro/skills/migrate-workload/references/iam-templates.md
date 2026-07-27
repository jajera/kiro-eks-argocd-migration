# IAM Templates

Detail for Phase 4. The default path is Pod Identity declared in `apps/<app>/iam.tf` —
the identity and secrets steering file has that snippet. This file covers the cases it
does not.

## Policy scoping

Start from the API calls inventoried in Phase 0, not from the source instance profile.

- Scope every statement to specific resource ARNs.
- Split read and write into separate statements so read-only access is easy to audit.
- Key environment-specific ARNs off the cluster so dev and prod reach their own
  resources.
- One role per app per cluster. A shared role recreates the instance-profile problem the
  migration is meant to solve.

Cross-check the intended policy against CloudTrail for the source workload's identity
over a representative period. Code inspection misses calls made by SDK middleware and by
rarely exercised paths.

## Operators acting on the app's behalf

A queue autoscaler reads queue depth using its *own* identity, not the workload's.
Granting the app permission to consume from a queue does not let the autoscaler see how
deep that queue is, and the symptom is a worker that never scales up with nothing in its
logs. Grant the operator's ServiceAccount read access to the queue attributes.

## IRSA

Only needed where Pod Identity is unavailable, such as Fargate. The trust relationship
lives in the role, so it is cluster-specific.

```hcl
assume_role_policy = jsonencode({
  Version = "2012-10-17"
  Statement = [{
    Effect    = "Allow"
    Action    = "sts:AssumeRoleWithWebIdentity"
    Principal = { Federated = "arn:aws:iam::111122223333:oidc-provider/<oidc-issuer>" }
    Condition = {
      StringEquals = {
        "<oidc-issuer>:sub" = "system:serviceaccount:<app>:<app>"
        "<oidc-issuer>:aud" = "sts.amazonaws.com"
      }
    }
  }]
})
```

The ServiceAccount then needs the role ARN as an annotation:

```yaml
metadata:
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::111122223333:role/dev-eks-1-<app>
```

Because that ARN contains the account ID, it belongs in an overlay patch, not in base —
`111122223333` in the dev overlay, `444455556666` in the prod overlay. Pod Identity
avoids this entirely, which is why it is the default.

Two things go wrong with IRSA that do not go wrong with Pod Identity. The `sub`
condition must match the namespace and ServiceAccount exactly — a mismatch fails
`AssumeRoleWithWebIdentity` in a way that looks like a permissions problem but is a
naming problem. And credentials resolve at pod start, so an existing pod keeps its old
identity until the Deployment is restarted.
