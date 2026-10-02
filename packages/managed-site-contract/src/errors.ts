export class ManagedSiteContractError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ManagedSiteContractError";
  }
}
