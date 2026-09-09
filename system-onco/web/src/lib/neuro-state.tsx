"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type CrosshairTarget = [number, number, number];

type NeuroState = {
  crosshairTarget: CrosshairTarget | null;
  setCrosshairTarget: (target: CrosshairTarget | null) => void;
};

const NeuroStateContext = createContext<NeuroState | null>(null);

export function NeuroStateProvider({ children }: { children: ReactNode }) {
  const [crosshairTarget, setCrosshairTarget] = useState<CrosshairTarget | null>(null);
  const value = useMemo(() => ({ crosshairTarget, setCrosshairTarget }), [crosshairTarget]);
  return <NeuroStateContext.Provider value={value}>{children}</NeuroStateContext.Provider>;
}

export function useNeuroState() {
  const context = useContext(NeuroStateContext);
  if (!context) throw new Error("useNeuroState must be used inside NeuroStateProvider");
  return context;
}
