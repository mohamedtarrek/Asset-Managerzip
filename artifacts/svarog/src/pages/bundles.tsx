import { useState } from "react";
import { Search, Package, Trash2, ExternalLink, TrendingUp, Loader2, Rocket } from "lucide-react";
import { Link } from "wouter";
import { useWallet } from "@/lib/wallet-context";
import { useListBundles, useGetBundleStats, useDeleteBundle, getListBundlesQueryKey, getGetBundleStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

const STATUS_COLORS: Record<string, string> = {
  active: "text-green-400 border-green-400/30 bg-green-400/5",
  pending: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
  completed: "text-blue-400 border-blue-400/30 bg-blue-400/5",
  failed: "text-red-400 border-red-400/30 bg-red-400/5",
};

function BundleRow({ bundle, onDelete }: {
  bundle: { id: number; tokenName: string; tokenSymbol: string; tokenAddress?: string | null; walletCount: number; solPerWallet?: number | null; totalSolSpent?: number | null; status: string; launchType: string; performanceUsd?: number | null; createdAt: string; };
  onDelete: (id: number) => void;
}) {
  return (
    <div className="flex items-center gap-4 p-4 border border-border rounded-lg bg-card/30 hover:bg-card/60 transition-colors" data-testid={`bundle-row-${bundle.id}`}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "hsl(270 100% 60% / 0.15)" }}>
        <Rocket className="w-5 h-5" style={{ color: "hsl(270 100% 65%)" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold truncate">{bundle.tokenName}</p>
          <span className="text-xs text-muted-foreground font-mono">{bundle.tokenSymbol}</span>
          <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[bundle.status])}>{bundle.status}</Badge>
          <Badge variant="outline" className="text-xs text-muted-foreground">{bundle.launchType.toUpperCase()}</Badge>
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
          <a href={`https://pump.fun/${bundle.tokenAddress}`} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground" data-testid={`button-open-pump-${bundle.id}`}>
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          </a>
        )}
        <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-destructive" onClick={() => onDelete(bundle.id)} data-testid={`button-delete-bundle-${bundle.id}`}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
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

      {/* Stats */}
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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search bundles by name or token address..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-bundles" />
      </div>

      {/* Bundle List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : bundles && bundles.length > 0 ? (
        <div className="space-y-2">
          {bundles.map(bundle => (
            <BundleRow key={bundle.id} bundle={bundle} onDelete={handleDelete} />
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
