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
  Rocket,
  ExternalLink,
} from "lucide-react";
import { VersionedTransaction, Transaction } from "@solana/web3.js";
import { Link } from "wouter";
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

type BundleWalletBalance = {
  walletPublicKey: string;
  isCreator: boolean;
  soldAt: string | null;
  solBalance: number;
  tokenBalance: number;
};

type BundleHolding = {
  bundleId: number;
  tokenName: string;
  tokenSymbol: string;
  tokenAddress: string | null;
  status: string;
  network: string;
  totalTokenBalance: number;
  totalSolBalance: number;
  unsoldWalletCount: number;
  wallets: BundleWalletBalance[];
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

async function fetchBundleHoldings(ownerAddress: string, network: string): Promise<BundleHolding[]> {
  const params = new URLSearchParams({ ownerAddress, network });
  const resp = await fetch(`${BASE_URL}api/portfolio/bundle-holdings?${params}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "Failed to fetch bundle holdings" }));
    throw new Error(err.error ?? "Failed to fetch bundle holdings");
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

async function bundleSell(
  bundleId: number,
  recipientAddress: string,
  network: string,
  opts?: { walletPublicKey?: string; includeCreator?: boolean }
): Promise<{ sold: { walletPublicKey: string; solAmount: number; txHash: string }[]; failed: { walletPublicKey: string; error: string }[] }> {
  const rpcEndpoint = network === "devnet" ? "https://api.devnet.solana.com" : undefined;
  const resp = await fetch(`${BASE_URL}api/bundles/${bundleId}/sell`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipientAddress,
      ...(opts?.walletPublicKey ? { walletPublicKey: opts.walletPublicKey } : {}),
      ...(opts?.includeCreator ? { includeCreator: true } : {}),
      ...(rpcEndpoint ? { rpcEndpoint } : {}),
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? "Sell failed");
  return data;
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
          toast({ title: `Sell simulated — ${token.symbol} (Devnet)`, description: `${percentage}% of ${formatBalance(token.balance)} ${token.symbol} would be sold on mainnet via pump.fun` });
        } else {
          toast({ title: `Sold ${percentage}% of ${token.symbol}`, description: `TX: ${sig.slice(0, 12)}...` });
        }
        onSold();
      } catch (err) {
        toast({ title: `Sell failed — ${token.symbol}`, description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
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
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: "hsl(270 100% 60% / 0.15)", color: "hsl(270 100% 65%)" }}>
          {token.symbol.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">{token.name}</p>
            <span className="text-xs text-muted-foreground font-mono">{token.symbol}</span>
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate">{token.mint.slice(0, 8)}...{token.mint.slice(-6)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono font-semibold text-sm">{formatBalance(token.balance)}</p>
          <p className="text-xs text-muted-foreground">{token.symbol}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10" onClick={() => doSell(100)} disabled={selling || disabled}>
            {selling && !showPct ? <Loader2 className="w-3 h-3 animate-spin" /> : <><TrendingDown className="w-3 h-3 mr-1" />Sell All</>}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs border-purple-500/30 text-purple-400 hover:bg-purple-500/10" onClick={() => setShowPct((v) => !v)} disabled={selling || disabled}>
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
          <Slider min={1} max={100} step={1} value={[pct]} onValueChange={([v]) => setPct(v)} className="w-full" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Amount: <span className="text-foreground font-mono">{formatBalance(token.balance * pct / 100)} {token.symbol}</span></span>
            <div className="flex gap-1">
              {[25, 50, 75, 100].map((p) => (
                <button key={p} onClick={() => setPct(p)} className={cn("px-1.5 py-0.5 rounded text-xs border transition-colors", pct === p ? "border-purple-400/50 text-purple-400 bg-purple-500/10" : "border-border text-muted-foreground hover:text-foreground")}>
                  {p}%
                </button>
              ))}
            </div>
          </div>
          <Button size="sm" className="self-end h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white" onClick={() => doSell(pct)} disabled={selling}>
            {selling ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Selling...</> : <>Confirm Sell {pct}%</>}
          </Button>
        </div>
      )}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: "text-green-400 border-green-400/30 bg-green-400/5",
  pending: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
  completed: "text-blue-400 border-blue-400/30 bg-blue-400/5",
  failed: "text-red-400 border-red-400/30 bg-red-400/5",
};

function BundleHoldingRow({
  holding,
  walletAddress,
  network,
  onSold,
}: {
  holding: BundleHolding;
  walletAddress: string;
  network: string;
  onSold: () => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [selling, setSelling] = useState(false);
  const [sellingWallet, setSellingWallet] = useState<string | null>(null);

  const handleSellAll = async () => {
    setSelling(true);
    try {
      const result = await bundleSell(holding.bundleId, walletAddress, network);
      if (result.sold.length > 0) {
        const totalSol = result.sold.reduce((s, w) => s + w.solAmount, 0);
        toast({ title: `Sold all ${holding.tokenSymbol} — ${totalSol.toFixed(4)} SOL returned` });
        onSold();
      } else {
        toast({ title: result.failed[0]?.error ?? "Nothing to sell", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Sell failed", variant: "destructive" });
    } finally {
      setSelling(false);
    }
  };

  const handleSellOne = async (walletPublicKey: string) => {
    setSellingWallet(walletPublicKey);
    try {
      const result = await bundleSell(holding.bundleId, walletAddress, network, { walletPublicKey });
      if (result.sold.length > 0) {
        toast({ title: `Sold — ${result.sold[0].solAmount.toFixed(4)} SOL returned` });
        onSold();
      } else {
        toast({ title: result.failed[0]?.error ?? "Sell failed", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Sell failed", variant: "destructive" });
    } finally {
      setSellingWallet(null);
    }
  };

  const [sellingCreator, setSellingCreator] = useState(false);

  const handleSellCreator = async () => {
    setSellingCreator(true);
    try {
      const result = await bundleSell(holding.bundleId, walletAddress, network, {
        walletPublicKey: creatorWallet!.walletPublicKey,
      });
      if (result.sold.length > 0) {
        const solAmount = result.sold[0].solAmount;
        toast({ title: `Creator coins sold — ${solAmount.toFixed(4)} SOL returned` });
        onSold();
      } else {
        toast({ title: result.failed[0]?.error ?? "Creator sell failed", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Sell failed", variant: "destructive" });
    } finally {
      setSellingCreator(false);
    }
  };

  const unsoldWallets = holding.wallets.filter((w) => !w.isCreator && !w.soldAt);
  const creatorWallet = holding.wallets.find((w) => w.isCreator);
  const creatorHasTokens = creatorWallet && creatorWallet.tokenBalance > 0 && !creatorWallet.soldAt;

  return (
    <div className="rounded-lg border border-border bg-card/30 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: "hsl(270 100% 60% / 0.15)", color: "hsl(270 100% 65%)" }}>
          {holding.tokenSymbol.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{holding.tokenName}</p>
            <span className="text-xs text-muted-foreground font-mono">{holding.tokenSymbol}</span>
            <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[holding.status])}>{holding.status}</Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground">Bundle #{holding.bundleId}</Badge>
          </div>
          {holding.tokenAddress && (
            <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
              {holding.tokenAddress.slice(0, 8)}...{holding.tokenAddress.slice(-6)}
            </p>
          )}
        </div>
        <div className="text-right shrink-0 hidden sm:block">
          <p className="font-mono font-semibold text-sm text-purple-400">{formatBalance(holding.totalTokenBalance)}</p>
          <p className="text-xs text-muted-foreground">{holding.tokenSymbol} across {holding.unsoldWalletCount} wallet(s)</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {unsoldWallets.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10" onClick={handleSellAll} disabled={selling || sellingCreator}>
              {selling ? <Loader2 className="w-3 h-3 animate-spin" /> : <><TrendingDown className="w-3 h-3 mr-1" />Sell All</>}
            </Button>
          )}
          {creatorHasTokens && (
            <Button size="sm" variant="outline" className="h-7 text-xs border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10" onClick={handleSellCreator} disabled={selling || sellingCreator}>
              {sellingCreator ? <Loader2 className="w-3 h-3 animate-spin" /> : <><TrendingDown className="w-3 h-3 mr-1" />Sell Creator</>}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
          {holding.tokenAddress && (
            <a href={holding.network === "devnet" ? `https://explorer.solana.com/address/${holding.tokenAddress}?cluster=devnet` : `https://pump.fun/coin/${holding.tokenAddress}`} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </a>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/50 px-4 pb-3 pt-2 space-y-1.5">
          <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-2">Wallet Breakdown</p>
          {holding.wallets.map((w) => (
            <div key={w.walletPublicKey} className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted/20 text-xs">
              <div className="flex-1 min-w-0">
                <span className="font-mono text-muted-foreground truncate block">
                  {w.walletPublicKey.slice(0, 10)}...{w.walletPublicKey.slice(-6)}
                  {w.isCreator && <span className="ml-1 text-yellow-400/70">(creator)</span>}
                </span>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-muted-foreground/70"><span className="text-foreground/80 font-mono">{w.solBalance.toFixed(4)}</span> SOL</span>
                  {w.tokenBalance > 0 && (
                    <span className="text-muted-foreground/70"><span className="text-purple-400 font-mono font-semibold">{formatBalance(w.tokenBalance)}</span> {holding.tokenSymbol}</span>
                  )}
                </div>
              </div>
              {w.soldAt ? (
                <Badge variant="outline" className="text-xs text-blue-400 border-blue-400/30 bg-blue-400/5 shrink-0">sold</Badge>
              ) : !w.isCreator && w.tokenBalance > 0 ? (
                <Button size="sm" variant="outline" className="h-7 text-xs shrink-0 border-green-500/30 text-green-400 hover:bg-green-500/10" onClick={() => handleSellOne(w.walletPublicKey)} disabled={sellingWallet === w.walletPublicKey || selling}>
                  {sellingWallet === w.walletPublicKey ? <Loader2 className="w-3 h-3 animate-spin" /> : "Sell"}
                </Button>
              ) : null}
            </div>
          ))}
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

  const phantomQueryKey = ["portfolio", walletAddress, network];
  const bundleQueryKey = ["portfolio-bundles", walletAddress, network];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: phantomQueryKey,
    queryFn: () => fetchPortfolio(walletAddress!, network),
    enabled: !!walletAddress,
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const { data: bundleHoldings, isLoading: bundlesLoading, refetch: refetchBundles } = useQuery({
    queryKey: bundleQueryKey,
    queryFn: () => fetchBundleHoldings(walletAddress!, network),
    enabled: !!walletAddress,
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const handleRefresh = () => {
    refetch();
    refetchBundles();
  };

  const handleSold = () => {
    queryClient.invalidateQueries({ queryKey: phantomQueryKey });
    queryClient.invalidateQueries({ queryKey: bundleQueryKey });
  };

  const handleSellAllCoins = async () => {
    if (!walletAddress || !data?.tokens?.length) return;
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
    queryClient.invalidateQueries({ queryKey: phantomQueryKey });
    if (successCount > 0) {
      toast({ title: `Sold ${successCount} token(s)${failCount > 0 ? `, ${failCount} failed` : ""}`, description: network === "devnet" ? "Devnet simulation complete" : "Transactions sent via pump.fun" });
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
        <p className="text-sm text-muted-foreground max-w-xs">Connect your Phantom wallet to view and manage your token portfolio.</p>
      </div>
    );
  }

  const totalBundleTokens = bundleHoldings?.reduce((s, b) => s + b.totalTokenBalance, 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Portfolio</h1>
          <p className="text-sm text-muted-foreground">All tokens in your connected wallet and bundle wallets</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={isLoading || bundlesLoading}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-2", (isLoading || bundlesLoading) && "animate-spin")} />
            Refresh
          </Button>
          {data?.tokens && data.tokens.length > 0 && (
            <Button size="sm" variant="destructive" onClick={handleSellAllCoins} disabled={sellingAll || isLoading} className="bg-red-600/80 hover:bg-red-600">
              {sellingAll ? <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Selling All...</> : <><TrendingDown className="w-3.5 h-3.5 mr-2" />Sell All Coins</>}
            </Button>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(270 100% 60% / 0.15)" }}>
              <CoinsIcon className="w-5 h-5" style={{ color: "hsl(270 100% 65%)" }} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">SOL Balance</p>
              {isLoading ? <Skeleton className="h-5 w-20 mt-1" /> : <p className="font-mono font-bold">{data?.solBalance.toFixed(4) ?? "—"} SOL</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-green-500/10">
              <CoinsIcon className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Wallet Tokens</p>
              {isLoading ? <Skeleton className="h-5 w-8 mt-1" /> : <p className="font-mono font-bold">{data?.tokens.length ?? 0}</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-purple-500/10">
              <Rocket className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Bundle Holdings</p>
              {bundlesLoading ? <Skeleton className="h-5 w-8 mt-1" /> : <p className="font-mono font-bold">{bundleHoldings?.length ?? 0} token{bundleHoldings?.length !== 1 ? "s" : ""}</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-muted/30">
              <Wallet className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Network</p>
              <Badge variant="outline" className={cn("text-xs mt-0.5", network === "devnet" ? "text-yellow-400 border-yellow-400/30 bg-yellow-400/5" : "text-green-400 border-green-400/30 bg-green-400/5")}>
                {network === "devnet" ? "Devnet" : "Mainnet"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bundle wallet holdings — launched tokens */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="w-4 h-4 text-purple-400" />
            Bundle Wallet Holdings
            <span className="text-xs text-muted-foreground font-normal">(tokens from your launches)</span>
            {bundleHoldings && bundleHoldings.length > 0 && (
              <Badge variant="outline" className="text-xs ml-1 text-purple-400 border-purple-400/30">{bundleHoldings.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {bundlesLoading && (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            </div>
          )}

          {!bundlesLoading && (!bundleHoldings || bundleHoldings.length === 0) && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Rocket className="w-10 h-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm font-medium">No bundle holdings found</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">Launch a token to see its holdings here.</p>
              <Link href="/launch">
                <Button size="sm" variant="outline">Go to Token Launch</Button>
              </Link>
            </div>
          )}

          {!bundlesLoading && bundleHoldings?.map((holding) => (
            <BundleHoldingRow
              key={holding.bundleId}
              holding={holding}
              walletAddress={walletAddress}
              network={network}
              onSold={handleSold}
            />
          ))}
        </CardContent>
      </Card>

      {/* Phantom wallet tokens */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CoinsIcon className="w-4 h-4" style={{ color: "hsl(270 100% 65%)" }} />
            Connected Wallet Tokens
            <span className="text-xs text-muted-foreground font-normal">({walletAddress.slice(0, 6)}...{walletAddress.slice(-4)})</span>
            {data?.tokens && data.tokens.length > 0 && (
              <Badge variant="outline" className="text-xs ml-1">{data.tokens.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 py-4">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error instanceof Error ? error.message : "Failed to load portfolio"}
            </div>
          )}

          {!isLoading && !error && data?.tokens.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CoinsIcon className="w-10 h-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm font-medium">No SPL tokens in this wallet</p>
              <p className="text-xs text-muted-foreground mt-1">Tokens from your launches are shown above in Bundle Wallet Holdings.</p>
            </div>
          )}

          {!isLoading && !error && data?.tokens.map((token) => (
            <TokenRow key={token.mint} token={token} walletAddress={walletAddress} network={network} onSold={handleSold} disabled={sellingAll} />
          ))}
        </CardContent>
      </Card>

      {network === "devnet" && (
        <p className="text-xs text-yellow-400/70 text-center">
          Devnet — bundle sell actions will sweep SOL back to your wallet. Switch to Mainnet for real pump.fun trading.
        </p>
      )}
    </div>
  );
}
