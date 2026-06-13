/**
 * Resolves the workspace repo to attribute freshly-parsed usage to.
 *
 * Copilot's OTel log lines carry no workspace path, so per-line attribution
 * isn't possible. The best available signal is the repo of the active editor at
 * parse time, which `util/repo` derives from the built-in Git extension (falling
 * back to the workspace folder name). Multi-root workspaces with no active
 * editor fall back to the first folder.
 */
import { activeAttribution, initRepoAttribution } from '../util/repo';

export { initRepoAttribution };

/** Best-effort repo id for events parsed right now; undefined when unresolvable. */
export function currentRepo(): string | undefined {
  return activeAttribution().repo;
}
