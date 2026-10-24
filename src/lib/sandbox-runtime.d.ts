declare module "@anthropic-ai/sandbox-runtime" {
  export type SandboxRuntimeConfig = {
    network: {
      allowedDomains: string[];
      deniedDomains: string[];
      deniedResolvedAddresses?: string[];
    };
    filesystem: {
      denyRead: string[];
      allowWrite: string[];
      denyWrite: string[];
    };
  };

  export const SandboxManager: {
    initialize(config: SandboxRuntimeConfig, ask?: (host: { host: string; port?: number }) => Promise<boolean>): Promise<void>;
    checkDependencies(): unknown;
    wrapWithSandbox(command: string): Promise<string>;
  };
}
