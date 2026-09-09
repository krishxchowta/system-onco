import type { ReactNode } from "react";

/** One shared 12-column grid: observation spans 7, synthesis spans 5. */
export function Layout({ observation, synthesis }: { observation: ReactNode; synthesis: ReactNode }) {
  return <div className="workspace-grid"><div className="observation-column">{observation}</div><div className="synthesis-column">{synthesis}</div></div>;
}
