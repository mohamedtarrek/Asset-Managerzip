import { useState, useCallback } from "react";
import {
  CoinsIcon,
  RefreshCw,
  Loader2,
  TrendingDown,
  Wallet,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Percent,
} from "lucide-react";
import { VersionedTransaction, Transaction } from "@solana/web3.js";
import { useWallet } from "@/lib/wallet-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { BASE_URL } from "@/lib/base-url";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type TokenHolding = {
  mint: string;
  name: string;
  symbol: string;
  balance: number;
  rawAmount: string;
  decimals: number;
  tokenAccount: string;
};

type Portfolio = {
  solBalance: number;
  tokens: TokenHolding[];
  network: string;
};

async function fetchPortfolio(walletAddress: string, network: string): Promise<Portfolio> {
  const params = new URLSearchParams({ walletAddress, network });
  const resp = await fetch(`${BASE_URL}api/portfolio?${params}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "Failed to fetch portfolio" }));
    throw new Error(err.error ?? "Failed to fetch portfolio");
  }
  return resp.json();
}

async function buildSellTx(
  walletAddress: string,
  mint: string,
  amount: string,
  slippage: number,
  network: string
): Promise<{ transaction?: string; type?: string; simulated?: boolean; network: string }> {
  const resp = await fetch(`${BASE_URL}api/portfolio/sell-tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, mint, amount, slippage, network }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "Failed to build transaction" }));
    throw new Error(err.error ?? "Failed to build transaction");
  }
  return resp.json();
}

async function signAndSend(txData: {
  transaction?: string;
  type?: string;
  simulated?: boolean;
}): Promise<string> {
  if (txData.simulated) return "simulated";

  if (!window.solana?.isPhantom) throw new Error("Phantom wallet not found");
  if (!txData.transaction) throw new Error("No transaction data received");

  const buffer = Buffer.from(txData.transaction, "base64");

  if (txData.type === "versioned") {
    const tx = VersionedTransaction.deserialize(buffer);
    const result = await window.solana.signAndSendTransaction(tx as unknown as Parameters<typeof window.solana.signAndSendTransaction>[0]);
    return result.signature;
  } else {
    const tx = Transaction.from(buffer);
    const result = await window.solana.signAndSendTransaction(tx as unknown as Parameters<typeof window.solana.signAndSendTransaction>[0]);
    return result.signature;
  }
}

function formatBalance(balance: number): string {
  if (balance >= 1_000_000_000) return `${(balance / 1_000_000_000).toFixed(2)}B`;
  if (balance >= 1_000_000) return `${(balance / 1_000_000).toFixed(2)}M`;
  if (balance >= 1_000) return `${(balance / 1_000).toFixed(2)}K`;
  if (balance >= 1) return balance.toFixed(4);
  return balance.toFixed(6);
}

function calcRawAmount(rawAmount: string, pct: number): string {
  const raw = BigInt(rawAmount);
  const sell = (raw * BigInt(Math.round(pct * 100))) / 10000n;
  return sell.toString();
}

function TokenRow({
  token,
  walletAddress,
  network,
  onSold,
  disabled,
}: {
  token: TokenHolding;
  walletAddress: string;
  network: string;
  onSold: () => void;
  disabled: boolean;
}) {
  const { toast } = useToast();
  const [selling, setSelling] = useState(false);
  const [showPct, setShowPct] = useState(false);
  const [pct, setPct] = useState(50);

  const doSell = useCallback(
    async (percentage: number) => {
      setSelling(true);
      try {
        const amount = calcRawAmount(token.rawAmount, percentage);
        if (amount === "0") {
          toast({ title: "Amount too small to sell", variant: "destructive" });
          return;
        }
        const txData = await buildSellTx(walletAddress, token.mint, amount, 10, network);
        const sig = await signAndSend(txData);
        if (sig === "simulated") {
          toast({
            title: `Sell simulated — ${token.symbol} (Devnet)`,
            description: `${percentage}% of ${formatBalance(token.balance)} ${token.symbol} would be sold on mainnet via pump.fun`,
          });
        } else {
          toast({
            title: `Sold ${percentage}% of ${token.symbol}`,
            description: `TX: ${sig.slice(0, 12)}...`,
          });
        }
        onSold();
      } catch (err) {
        toast({
          title: `Sell failed — ${token.symbol}`,
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setSelling(false);
        setShowPct(false);
      }
    },
    [token, walletAddress, network, onSold, toast]
  );

  return (
    <div className="flex flex-col gap-2 px-4 py-3 rounded-lg border border-border bg-card/30 hover:bg-card/50 transition-colors">
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ background: "hsl(270 100% 60% / 0.15)", color: "hsl(270 100% 65%)" }}
        >
          {token.symbol.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">{token.name}</p>
            <span className="text-xs text-muted-foreground font-mono">{token.symbol}</span>
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate">
            {token.mint.slice(0, 8)}...{token.mint.slice(-6)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono font-semibold text-sm">{formatBalance(token.balance)}</p>
          <p className="text-xs text-muted-foreground">{token.symbol}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
            onClick={() => doSell(100)}
            disabled={selling || disabled}
          >
            {selling && !showPct ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <TrendingDown className="w-3 h-3 mr-1" />
                Sell All
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
            onClick={() => setShowPct((v) => !v)}
            disabled={selling || disabled}
          >
            <Percent className="w-3 h-3 mr-1" />
            {showPct ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
        </div>
      </div>

      {showPct && (
        <div className="pl-12 pr-2 pb-1 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Sell percentage</span>
            <span className="font-mono font-semibold text-foreground">{pct}%</span>
          </div>
          <Slider
            min={1}
            max={100}
            step={1}
            value={[pct]}
            onValueChange={([v]) => setPct(v)}
            className="w-full"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Amount: <span className="text-foreground font-mono">{formatBalance(token.balance * pct / 100)} {token.symbol}</span></span>
            <div className="flex gap-1">
              {[25, 50, 75, 100].map((p) => (
                <button
                  key={p}
                  onClick={() => setPct(p)}
                  className={cn(
                    "px-1.5 py-0.5 rounded text-xs border transition-colors",
                    pct === p
                      ? "border-purple-400/50 text-purple-400 bg-purple-500/10"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
          <Button
            size="sm"
            className="self-end h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white"
            onClick={() => doSell(pct)}
            disabled={selling}
          >
            {selling ? (
              <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Selling...</>
            ) : (
              <>Confirm Sell {pct}%</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function PortfolioPage() {
  const { walletAddress, network } = useWallet();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sellingAll, setSellingAll] = useState(false);

  const queryKey = ["portfolio", walletAddress, network];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchPortfolio(walletAddress!, network),
    enabled: !!walletAddress,
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const handleSold = () => {
    queryClient.invalidateQueries({ queryKey });
  };

  const handleSellAllCoins = async () => {
    if (!walletAddress || !data?.tokens?.length) return;
    if (!window.solana?.isPhantom && network === "mainnet") {
      toast({ title: "Connect Phantom wallet first", variant: "destructive" });
      return;
    }

    setSellingAll(true);
    let successCount = 0;
    let failCount = 0;

    for (const token of data.tokens) {
      try {
        const txData = await buildSellTx(walletAddress, token.mint, token.rawAmount, 10, network);
        const sig = await signAndSend(txData);
        if (sig) successCount++;
      } catch {
        failCount++;
      }
    }

    setSellingAll(false);
    queryClient.invalidateQueries({ queryKey });

    if (successCount > 0) {
      toast({
        title: `Sold ${successCount} token(s)${failCount > 0 ? `, ${failCount} failed` : ""}`,
        description: network === "devnet" ? "Devnet simulation complete" : "Transactions sent via pump.fun",
      });
    } else {
      toast({ title: "All sells failed", variant: "destructive" });
    }
  };

  if (!walletAddress) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "hsl(270 100% 60% / 0.1)" }}>
          <Wallet className="w-7 h-7" style={{ color: "hsl(270 100% 65%)" }} />
        </div>
        <h2 className="text-lg font-semibold">No Wallet Connected</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Connect your Phantom wallet to view and manage your token portfolio.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Portfolio</h1>
          <p className="text-sm text-muted-foreground">
            All tokens held in your connected wallet
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-2", isLoading && "animate-spin")} />
            Refresh
          </Button>
          {data?.tokens && data.tokens.length > 0 && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleSellAllCoins}
              disabled={sellingAll || isLoading}
              className="bg-red-600/80 hover:bg-red-600"
            >
              {sellingAll ? (
                <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> Selling All...</>
              ) : (
                <><TrendingDown className="w-3.5 h-3.5 mr-2" /> Sell All Coins</>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* SOL Balance Card */}
      {(isLoading || data) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="md:col-span-1">
            <CardContent className="p-4 flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "hsl(270 100% 60% / 0.15)" }}
              >
                <CoinsIcon className="w-5 h-5" style={{ color: "hsl(270 100% 65%)" }} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">SOL Balance</p>
                {isLoading ? (
                  <Skeleton className="h-5 w-24 mt-1" />
                ) : (
                  <p className="font-mono font-bold text-lg">{data?.solBalance.toFixed(4)} SOL</p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="md:col-span-1">
            <CardContent className="p-4 flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "hsl(140 60% 50% / 0.15)" }}
              >
                <CoinsIcon className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">SPL Tokens</p>
                {isLoading ? (
                  <Skeleton className="h-5 w-12 mt-1" />
                ) : (
                  <p className="font-mono font-bold text-lg">{data?.tokens.length ?? 0}</p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="md:col-span-1">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-muted/30">
                <Wallet className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Connected Wallet</p>
                <p className="font-mono text-xs text-primary truncate mt-0.5">
                  {walletAddress.slice(0, 8)}...{walletAddress.slice(-8)}
                </p>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs mt-1",
                    network === "devnet"
                      ? "text-yellow-400 border-yellow-400/30 bg-yellow-400/5"
                      : "text-green-400 border-green-400/30 bg-green-400/5"
                  )}
                >
                  {network === "devnet" ? "Devnet" : "Mainnet"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Token List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CoinsIcon className="w-4 h-4" style={{ color: "hsl(270 100% 65%)" }} />
            Token Holdings
            {data?.tokens && data.tokens.length > 0 && (
              <Badge variant="outline" className="text-xs ml-1">
                {data.tokens.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 py-4">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error instanceof Error ? error.message : "Failed to load portfolio"}
            </div>
          )}

          {!isLoading && !error && data?.tokens.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CoinsIcon className="w-10 h-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm font-medium">No SPL tokens found</p>
              <p className="text-xs text-muted-foreground mt-1">
                This wallet holds no SPL tokens on {network === "devnet" ? "Devnet" : "Mainnet"}.
              </p>
            </div>
          )}

          {!isLoading &&
            !error &&
            data?.tokens.map((token) => (
              <TokenRow
                key={token.mint}
                token={token}
                walletAddress={walletAddress}
                network={network}
                onSold={handleSold}
                disabled={sellingAll}
              />
            ))}
        </CardContent>
      </Card>

      {network === "mainnet" && data?.tokens && data.tokens.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Mainnet sells are executed via pump.fun. Ensure you have enough SOL for transaction fees.
        </p>
      )}
      {network === "devnet" && (
        <p className="text-xs text-yellow-400/70 text-center">
          Devnet sells are simulated — no real transactions are sent. Switch to Mainnet for live trading via pump.fun.
        </p>
      )}
    </div>
  );
}
