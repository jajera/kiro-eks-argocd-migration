# Discovery Checklist

Commands for Phase 0. Prefer the MCP tools where available so the values come from live
configuration rather than from memory. Everything below is read-only.

## What to capture

Record these for every source type. An `unknown` here becomes a production incident
later.

| Field | Notes |
| --- | --- |
| Runtime and version | Determines the base image |
| Entrypoint and arguments | Becomes `command` and `args` |
| Listening ports | Becomes `containerPort` and the Service |
| Environment variables | Split into non-sensitive (ConfigMap) and sensitive (Secret) |
| Secret sources | Where each secret is read from today |
| Volumes | Whether any hold state that must survive a restart |
| CPU and memory in use | Basis for requests and limits, not the instance size |
| Health check | Path, port, expected status, and startup time |
| Outbound dependencies | Host and port for every egress destination |
| Inbound path | Load balancer, listener, target group, hostname, TLS certificate |
| IAM permissions | The actions actually called, not the whole attached policy |
| Log destination | Where logs go today and who reads them |
| Scaling behaviour | Current instance count, and what drives it |

## Amazon EC2

```bash
aws ec2 describe-instances --instance-ids <id>
aws ec2 describe-security-groups --group-ids <sg-id>
aws iam get-instance-profile --instance-profile-name <name>
aws elbv2 describe-target-groups --load-balancer-arn <arn>
```

On the instance itself, via Systems Manager rather than SSH:

```bash
systemctl cat <service>      # entrypoint, working dir, environment
ss -tlnp                     # listening ports
crontab -l                   # scheduled work that becomes a CronJob
```

Two things are easy to miss on EC2. First, cron entries and systemd timers on the host
are separate workloads — they become their own `scheduled-job` apps, not part of the
main deployment. Second, an instance profile is the union of everything every process on
that host ever needed; scope the new role to what this workload actually calls.

## Amazon ECS

```bash
aws ecs describe-task-definition --task-definition <family:revision>
aws ecs describe-services --cluster <cluster> --services <service>
```

The task definition already contains most of the inventory: image, ports, environment,
secrets, CPU and memory, log configuration, and health check. The service adds desired
count, scaling policy, and the load balancer target group.

ECS task role maps to the workload IAM role. ECS *execution* role does not carry over —
its job (pulling images, writing to the log group) is handled differently on Kubernetes.

## Docker Compose or Podman

Read `compose.yaml` directly. Each service maps to one app.

- `image` or `build` -> the container image
- `ports` -> Service and `containerPort`
- `environment` and `env_file` -> ConfigMap and Secret
- `volumes` -> whether the workload is actually stateless
- `depends_on` -> startup ordering, usually handled by readiness probes instead
- `deploy.resources` -> requests and limits, if present

Compose links between services become Service DNS names. A container addressed as `db`
becomes `db.<namespace>.svc.cluster.local`, or a managed database endpoint if that part
is also being migrated.

## Sizing

Do not derive requests and limits from the instance type — that is capacity, not usage.
Take observed utilisation over a representative period. Set requests near the steady
state so the scheduler can bin-pack, and limits with enough headroom for peaks.

## Right-sizing the IAM role

Instance profiles and task roles accumulate permissions. Before writing the new policy:

1. List the AWS API calls the code actually makes.
2. Cross-check against CloudTrail for the source workload's identity over a
   representative period.
3. Grant only the intersection, scoped to specific resource ARNs.
4. Drop every wildcard action and `Resource: "*"` inherited from the old policy.
