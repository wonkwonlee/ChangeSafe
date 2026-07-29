# Kubernetes (v0.3.0)

ChangeSafe reviews Kubernetes changes offline. The only networked step is the optional, namespace-scoped collector:

```text
Kubernetes API --GET/LIST--> collector --atomic JSON--> snapshot
snapshot + manifests --> pure domain --> findings/receipt
```

The collector supports only `apps/v1` Deployments, StatefulSets, DaemonSets, and `v1` Services. It accepts explicit namespaces, rejects credential plugins, and never watches, writes, executes commands, or contacts the API during gating. Manifest omission is not deletion.

```bash
changesafe kubernetes collect --namespace demo --context staging-readonly --out current.snapshot.json
changesafe gate --domain kubernetes --input current.snapshot.json --proposal proposed.yaml --receipt receipt.json
changesafe verify receipt.json --domain kubernetes --input current.snapshot.json --proposal proposed.yaml
```

A clean result is `gate_only`, not approval. ChangeSafe cannot apply the reviewed manifests. A human and their existing deployment system remain responsible for execution and for checking the snapshot is current.

## Least privilege

Use [`examples/kubernetes/changesafe-reader.yaml`](../examples/kubernetes/changesafe-reader.yaml) in each reviewed namespace. It grants only `get` and `list` for the four supported resource groups; it grants no `watch`, write verb, Secret access, or cluster-wide binding.
