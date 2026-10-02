"use client";

import { FC, ReactNode, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { RPC_URL } from "@/lib/program";

import "@solana/wallet-adapter-react-ui/styles.css";

export const WalletContextProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  // wallet-adapter types lag React 18.3's JSX runtime types; cast through.
  const CP = ConnectionProvider as unknown as FC<{
    endpoint: string;
    children: ReactNode;
  }>;
  const WP = WalletProvider as unknown as FC<{
    wallets: unknown[];
    autoConnect?: boolean;
    children: ReactNode;
  }>;
  const MP = WalletModalProvider as unknown as FC<{ children: ReactNode }>;
  return (
    <CP endpoint={RPC_URL}>
      <WP wallets={wallets} autoConnect>
        <MP>{children}</MP>
      </WP>
    </CP>
  );
};
