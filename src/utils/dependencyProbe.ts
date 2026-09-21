/**
 * Does this instance actually run the node_modules the package ships?
 *
 * For months it did not. The old App Service runs `wwwroot/node_modules`
 * frozen at 2026-06-07 and ignores whatever the deploy uploads, so adding any
 * dependency took the site down with ERR_MODULE_NOT_FOUND while the deploy
 * reported success (docs/DEPLOYMENT.md). Escaping that is the entire point of
 * the move to a new App Service, and the only way to know it worked is to add
 * a package and see whether the running process can find it.
 *
 * Doing that by importing it at the top of server.ts is exactly what took
 * production down on 2026-09-16, and one build still deploys to both apps. So
 * the import happens here instead: inside a try, at request time, cached, and
 * never allowed to throw. The app does not need the package and does not use
 * it - it only reports whether it is reachable:
 *
 *   loaded: true   the instance runs the shipped node_modules. Trap gone.
 *   loaded: false  the instance runs its own frozen copy. Trap still there.
 *
 * Both are useful answers, and neither can break anything, which is what
 * makes this safe to ship to production and the new app from one build.
 *
 * Once the old App Service is retired this file has served its purpose and
 * should be deleted along with the dependency it probes.
 */
export type DependencyProbe = {
  package: string;
  loaded: boolean;
  error: string | null;
};

const PROBE_PACKAGE = "compression";

let cached: DependencyProbe | null = null;

export async function probeShippedDependency(): Promise<DependencyProbe> {
  if (cached) return cached;

  // Held in a variable rather than written as a literal: a literal makes
  // TypeScript demand type declarations for a package this code never calls,
  // and the point here is resolution at RUNTIME, not at compile time.
  const name: string = PROBE_PACKAGE;

  try {
    await import(name);
    cached = { package: PROBE_PACKAGE, loaded: true, error: null };
  } catch (err: any) {
    cached = {
      package: PROBE_PACKAGE,
      loaded: false,
      error: String(err?.code || err?.message || err).slice(0, 200),
    };
  }

  return cached;
}
