"use client";
import dynamic from "next/dynamic";
import type { ObservationProps } from "./ObservationDeck";
const ObservationDeck = dynamic(() => import("./ObservationDeck"), {
  ssr: false,
  loading: () => <div className="viewer-skeleton">Loading MRI explorer…</div>,
});
export default function ClientObservationDeck(props: ObservationProps) {
  return <ObservationDeck {...props} />;
}
