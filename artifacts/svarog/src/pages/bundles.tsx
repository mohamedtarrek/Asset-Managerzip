import { useState } from "react";
import { Search, Package, Trash2, ExternalLink, TrendingUp, Loader2, Rocket, ChevronDown, ChevronUp, Wallet, DollarSign } from "lucide-react";
import { Link } from "wouter";
import { useWallet } from "@/lib/wallet-context";
import { useListBundles, useGetBundleStats, useDeleteBundle, getListBundlesQueryKey, getGetBundleStatsQueryKey } from "@workspace/api-client-react";
import type { Bundle, BundleWallet } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { BASE_URL } from "@/lib/base-url";

const STATUS_COLORS: Record<string, string> = {
  active: "text-green-400 border-green-400/30 bg-green-400/5",
  pending: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
  completed: "text-blue-400 border-blue-400/30 bg-blue-400/5",
  failed: "text-red-400 border-red-400/30 bg-red-400/5",
};

function tradeUrl(bundle: Bundle): string {
  if (bundle.network === "devnet") {
    return bundle.poolId
      ? `https://raydium.io/liquidity/increase/?mode=add&pool_id=${bundle.poolId}`
      : "https://raydium.io/liquidity-pools/";
  }
  if (bundle.poolId) return `https://raydium.io/liquidity/increase/?mode=add&pool_id=${bundle.poolId}`;
  if (bundle.tokenAddress) return `https://pump.fun/coin/${bundle.tokenAddress}`;
  return "https://raydium.io/liquidity-pools/";
}

function tradeLinkLabel(bundle: Bundle): string {
  if (bundle.network === "devnet") return "View on Raydium";
  return bundle.poolId ? "View pool on Raydium" : "View on Pump.fun";
}

type WalletWithBalance = {
  walletPublicKey: string;
  isCreator: boolean;
  soldAt: string | null;
  solBalance: number;
  tokenBalance: number;
};

function WalletList({ bundle, onSellComplete }: {
  bundle: Bundle;
  onSellComplete: () => void;
}) {
  const { walletAddress } = useWallet();
  const { toast } = useToast();
  const [wallets, setWallets] = useState<WalletWithBalance[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sellingAll, setSellingAll] = useState(false);
  const [sellingWallet, setSellingWallet] = useState<string | null>(null);

  const fetchWallets = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${BASE_URL}api/bundles/${bundle.id}/wallets/balances`);
      const data = await resp.json();
      setWallets(data);
    } catch {
      toast({ title: "Failed to load wallets", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (!wallets && !loading) {
    fetchWallets();
  }

  const doSell = async (walletPublicKey?: string) => {
    if (!walletAddress) {
      toast({ title: "Connect your Phantom wallet first", variant: "destructive" });
      return;
    }
    const settingsRpc = bundle.network === "devnet" ? "https://api.devnet.solana.com" : undefined;
    const body: Record<string, string> = { recipientAddress: walletAddress };
    if (walletPublicKey) body.walletPublicKey = walletPublicKey;
    if (settingsRpc) body.rpcEndpoint = settingsRpc;

    const resp = await fetch(`${BASE_URL}api/bundles/${bundle.id}/sell`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error ?? "Sell failed");
    return data as { sold: { walletPublicKey: string; solAmount: number; txHash: string }[]; failed: { walletPublicKey: string; error: string }[] };
  };

  const handleSellOne = async (walletPublicKey: string) => {
    setSellingWallet(walletPublicKey);
    try {
      const result = await doSell(walletPublicKey);
      if (result?.sold.length) {
        toast({ title: `Sold — ${result.sold[0].solAmount.toFixed(4)} SOL sent to your wallet` });
        onSellComplete();
        fetchWallets();
      } else {
        toast({ title: result?.failed[0]?.error ?? "Sell failed", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Sell failed", variant: "destructive" });
    } finally {
      setSellingWallet(null);
    }
  };

  const handleSellAll = async () => {
    setSellingAll(true);
    try {
      const result = await doSell();
      if (result?.sold.length) {
        const totalSol = result.sold.reduce((s, w) => s + w.solAmount, 0);
        toast({ title: `Sold ${result.sold.length} wallet(s) — ${totalSol.toFixed(4)} SOL sent to your wallet` });
        onSellComplete();
        fetchWallets();
      } else {
        toast({ title: result?.failed[0]?.error ?? "Nothing to sell", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Sell all failed", variant: "destructive" });
    } finally {
      setSellingAll(false);
    }
  };

  const bundleWallets = (wallets ?? []).filter(w => !w.isCreator);
  const unsoldCount = bundleWallets.filter(w => !w.soldAt).length;

  return (
    <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider flex items-center gap-1.5">
          <Wallet className="w-3.5 h-3.5" /> Bundle Wallets
        </p>
        {unsoldCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
            onClick={handleSellAll}
            disabled={sellingAll}
            data-testid={`button-sell-all-${bundle.id}`}
          >
            {sellingAll ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <DollarSign className="w-3 h-3 mr-1.5" />}
            Sell All ({unsoldCount})
          </Button>
        )}
      </div>

      {loading && (
        <div className="space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      )}

      {!loading && bundleWallets.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">No bundle wallets recorded (older launch)</p>
      )}

      {!loading && bundleWallets.map(bw => (
        <div key={bw.walletPublicKey} className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted/20 text-xs">
          <div className="flex-1 min-w-0">
            <span className="font-mono text-muted-foreground truncate block">
              {bw.walletPublicKey.slice(0, 10)}...{bw.walletPublicKey.slice(-6)}
            </span>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-muted-foreground/70">
                <span className="text-foreground/80 font-mono">{bw.solBalance.toFixed(4)}</span> SOL
              </span>
              {bw.tokenBalance > 0 && (
                <span className="text-muted-foreground/70">
                  <span className="text-purple-400 font-mono font-semibold">
                    {bw.tokenBalance >= 1_000_000
                      ? `${(bw.tokenBalance / 1_000_000).toFixed(2)}M`
                      : bw.tokenBalance >= 1_000
                        ? `${(bw.tokenBalance / 1_000).toFixed(1)}K`
                        : bw.tokenBalance.toFixed(0)}
                  </span>{" "}{bundle.tokenSymbol}
                </span>
              )}
              {bw.tokenBalance === 0 && !bw.soldAt && (
                <span className="text-muted-foreground/50 italic">no tokens</span>
              )}
            </div>
          </div>
          {bw.soldAt ? (
            <Badge variant="outline" className="text-xs text-blue-400 border-blue-400/30 bg-blue-400/5 shrink-0">sold</Badge>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs shrink-0 border-green-500/30 text-green-400 hover:bg-green-500/10"
              onClick={() => handleSellOne(bw.walletPublicKey)}
              disabled={sellingWallet === bw.walletPublicKey || sellingAll}
            >
              {sellingWallet === bw.walletPublicKey
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : "Sell"}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function BundleRow({ bundle, onDelete, onRefresh }: {
  bundle: Bundle;
  onDelete: (id: number) => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg bg-card/30 hover:bg-card/60 transition-colors" data-testid={`bundle-row-${bundle.id}`}>
      <div className="flex items-center gap-4 p-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "hsl(270 100% 60% / 0.15)" }}>
          <Rocket className="w-5 h-5" style={{ color: "hsl(270 100% 65%)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">{bundle.tokenName}</p>
            <span className="text-xs text-muted-foreground font-mono">{bundle.tokenSymbol}</span>
            <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[bundle.status])}>{bundle.status}</Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground">{bundle.launchType.toUpperCase()}</Badge>
            {bundle.network === "devnet" && (
              <Badge variant="outline" className="text-xs text-orange-400 border-orange-400/30 bg-orange-400/5">DEVNET</Badge>
            )}
          </div>
          {bundle.tokenAddress && (
            <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{bundle.tokenAddress}</p>
          )}
        </div>
        <div className="hidden md:flex items-center gap-6 text-sm shrink-0">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Wallets</p>
            <p className="font-mono font-semibold">{bundle.walletCount}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">SOL Spent</p>
            <p className="font-mono font-semibold">{(bundle.totalSolSpent ?? 0).toFixed(3)}</p>
          </div>
          {bundle.performanceUsd != null && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Performance</p>
              <p className={cn("font-mono font-semibold", bundle.performanceUsd >= 0 ? "text-green-400" : "text-red-400")}>
                ${bundle.performanceUsd.toFixed(2)}
              </p>
            </div>
          )}
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Launched</p>
            <p className="text-xs font-mono">{new Date(bundle.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {bundle.tokenAddress && (
            <a href={tradeUrl(bundle)} target="_blank" rel="noopener noreferrer" title={tradeLinkLabel(bundle)}>
              <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground" data-testid={`button-open-trade-${bundle.id}`}>
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </a>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8 text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(e => !e)}
            data-testid={`button-expand-${bundle.id}`}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-destructive" onClick={() => onDelete(bundle.id)} data-testid={`button-delete-bundle-${bundle.id}`}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4">
          <WalletList bundle={bundle} onSellComplete={onRefresh} />
        </div>
      )}
    </div>
  );
}

export default function BundlesPage() {
  const { walletAddress } = useWallet();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const params = walletAddress ? { ownerAddress: walletAddress, search: search || undefined } : { search: search || undefined };
  const { data: bundles, isLoading } = useListBundles(params);
  const { data: stats } = useGetBundleStats(walletAddress ? { ownerAddress: walletAddress } : {});
  const deleteBundle = useDeleteBundle();

  const handleDelete = (id: number) => {
    deleteBundle.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Bundle deleted" });
        queryClient.invalidateQueries({ queryKey: getListBundlesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBundleStatsQueryKey() });
      },
    });
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getListBundlesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBundleStatsQueryKey() });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bundles</h1>
          <p className="text-sm text-muted-foreground">All your token launches</p>
        </div>
        <Link href="/launch">
          <Button size="sm" data-testid="button-create-bundle">
            <Rocket className="w-4 h-4 mr-2" /> New Bundle
          </Button>
        </Link>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Launches", value: String(stats.totalLaunches), icon: Package },
            { label: "Best Launch", value: `$${stats.bestLaunchUsd.toFixed(2)}`, icon: TrendingUp },
            { label: "Total SOL Spent", value: `${stats.totalSolSpent.toFixed(3)} SOL`, icon: Package },
            { label: "Success Rate", value: `${stats.successRate.toFixed(1)}%`, icon: TrendingUp },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(270 100% 60% / 0.15)" }}>
                  <Icon className="w-4 h-4" style={{ color: "hsl(270 100% 65%)" }} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-mono font-bold">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search bundles by name or token address..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-bundles" />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : bundles && bundles.length > 0 ? (
        <div className="space-y-2">
          {bundles.map(bundle => (
            <BundleRow key={bundle.id} bundle={bundle} onDelete={handleDelete} onRefresh={handleRefresh} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Package className="w-14 h-14 text-muted-foreground/20 mb-4" />
            <h3 className="text-base font-semibold mb-1">No bundles found</h3>
            <p className="text-sm text-muted-foreground mb-6">
              {search ? "No bundles match your search" : "You haven't launched any bundles yet"}
            </p>
            <Link href="/launch">
              <Button data-testid="button-create-first-bundle">Create your first bundle</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
