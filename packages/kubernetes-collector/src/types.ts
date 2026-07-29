export interface ReadOnlyKubernetesClient {
  serverVersion(): Promise<string>;
  listDeployments(namespace: string): Promise<unknown[]>;
  listStatefulSets(namespace: string): Promise<unknown[]>;
  listDaemonSets(namespace: string): Promise<unknown[]>;
  listServices(namespace: string): Promise<unknown[]>;
}

export interface CollectOptions {
  namespaces: string[];
  contextFingerprint: string;
  now: () => string;
  maxResources: number;
}
