// node-oidc-provider ships no types here; the conformance test uses it as a black box.
declare module "oidc-provider" {
  const Provider: new (
    issuer: string,
    configuration: unknown,
  ) => {
    callback(): (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void;
    on(event: string, handler: (...args: unknown[]) => void): void;
  };
  export default Provider;
}
