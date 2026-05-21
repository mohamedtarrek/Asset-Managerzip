import React, { createContext, useContext, useState, useEffect } from "react";

interface WalletContextType {
  walletAddress: string | null;
  setWalletAddress: (address: string | null) => void;
  isConnecting: boolean;
}

const WalletContext = createContext<WalletContextType>({
  walletAddress: null,
  setWalletAddress: () => {},
  isConnecting: false,
});

export const useWallet = () => useContext(WalletContext);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [walletAddress, setWalletAddressState] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);

  useEffect(() => {
    // Make sure we always have dark mode
    document.documentElement.classList.add("dark");

    const savedAddress = localStorage.getItem("svarog_wallet_address");
    if (savedAddress) {
      setWalletAddressState(savedAddress);
    }
    setIsConnecting(false);
  }, []);

  const setWalletAddress = (address: string | null) => {
    if (address) {
      localStorage.setItem("svarog_wallet_address", address);
    } else {
      localStorage.removeItem("svarog_wallet_address");
    }
    setWalletAddressState(address);
  };

  return (
    <WalletContext.Provider value={{ walletAddress, setWalletAddress, isConnecting }}>
      {children}
    </WalletContext.Provider>
  );
};
