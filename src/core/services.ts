import type { GitProbe } from "./pending";
import type { Runner } from "./summarize";

// Side effects that reach outside the vault (git, gh, Claude), injected so tests never call them.
export interface Services {
  git: GitProbe;
  summarizer(model: string): Runner;
}
