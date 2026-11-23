/** Branche tardive : le store OAuth est créé après l'API REST, dans le même processus. */
let lookup: (token: string) => boolean = () => false;

export function bindOauthAccessLookup(fn: (token: string) => boolean): void {
  lookup = fn;
}

export function oauthAccessValid(token: string): boolean {
  try {
    return lookup(token);
  } catch {
    return false;
  }
}
