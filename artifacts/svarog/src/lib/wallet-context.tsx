import { createContext, useContext, useState, useEffect, useCallback } from "react";

interface WalletContextType {
  walletAddress: string | null;
  isConnecting: boolean;
  hasPhantom: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  setManualAddress: (address: string) => void;
}

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
      disconnect: () => Promise<void>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      off: (event: string, handler: (...args: unknown[]) => void) => void;
      publicKey?: { toString(): string } | null;
    };
  }
}

const WalletContext = createContext<WalletContextType>({
  walletAddress: null,
  isConnecting: false,
  hasPhantom: false,
  connect: async () => {},
  disconnect: () => {},
  setManualAddress: () => {},
});

export const useWallet = () => useContext(WalletContext);

export const WalletProvider = ({ children }: { children: React.ReactNode }) => {
  const [walletAddress, setWalletAddressState] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [hasPhantom, setHasPhantom] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    const saved = localStorage.getItem("svarog_wallet_address");
    if (saved) setWalletAddressState(saved);

    const checkPhantom = () => setHasPhantom(!!(window.solana?.isPhantom));
    checkPhantom();
    window.addEventListener("load", checkPhantom);

    const handleAccountChanged = (key: unknown) => {
      if (key && typeof key === "object" && "toString" in key) {
        const addr = (key as { toString(): string }).toString();
        setWalletAddressState(addr);
        localStorage.setItem("svarog_wallet_address", addr);
      } else {
        setWalletAddressState(null);
        localStorage.removeItem("svarog_wallet_address");
      }
    };

    if (window.solana) {
      window.solana.on("accountChanged", handleAccountChanged);
    }

    return () => {
      window.removeEventListener("load", checkPhantom);
      if (window.solana) {
        window.solana.off("accountChanged", handleAccountChanged);
      }
    };
  }, []);

  const connect = useCallback(async () => {
    if (!window.solana?.isPhantom) return;
    setIsConnecting(true);
    try {
      const resp = await window.solana.connect();
      const addr = resp.publicKey.toString();
      setWalletAddressState(addr);
      localStorage.setItem("svarog_wallet_address", addr);
    } catch {
      // user rejected
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (window.solana?.isPhantom) {
      try { await window.solana.disconnect(); } catch {}
    }
    setWalletAddressState(null);
    localStorage.removeItem("svarog_wallet_address");
  }, []);

  const setManualAddress = useCallback((address: string) => {
    if (address) {
      localStorage.setItem("svarog_wallet_address", address);
      setWalletAddressState(address);
    }
  }, []);

  return (
    <WalletContext.Provider value={{ walletAddress, isConnecting, hasPhantom, connect, disconnect, setManualAddress }}>
      {children}
    </WalletContext.Provider>
  );
};
