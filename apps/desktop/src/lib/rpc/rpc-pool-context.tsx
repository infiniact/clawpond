"use client";

import { createContext, useContext, useRef, useEffect } from "react";
import { RpcPool, type GatewayInfo } from "./rpc-pool";

type RpcPoolContextValue = {
  pool: RpcPool;
  gateways: GatewayInfo[];
};

const RpcPoolContext = createContext<RpcPoolContextValue | null>(null);

export function RpcPoolProvider({
  gateways,
  children,
}: {
  gateways: GatewayInfo[];
  children: React.ReactNode;
}) {
  const poolRef = useRef(new RpcPool());

  useEffect(() => {
    return () => {
      poolRef.current.disconnectAll();
    };
  }, []);

  return (
    <RpcPoolContext.Provider value={{ pool: poolRef.current, gateways }}>
      {children}
    </RpcPoolContext.Provider>
  );
}

export function useRpcPool() {
  const ctx = useContext(RpcPoolContext);
  if (!ctx) throw new Error("useRpcPool must be used within RpcPoolProvider");
  return ctx;
}
