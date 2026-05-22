import { useState } from "react";
import { TrendingUp, TrendingDown, Rocket, Wallet, Bot, DollarSign, Activity, ArrowUpRight, Github, Loader2, CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { useWallet } from "@/lib/wallet-context";
import { useGetDashboardStats, useGetDashboardActivity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BASE_URL } from "@/lib/base-url";

const GITHUB_REPO = "https://github.com/mohamedtarrek/Asset-Managerzip";

const COIN_PRICES = [
  { symbol: "BTC", name: "Bitcoin", price: "$67,240", change: "+2.4%" },
  { symbol: "SOL", name: "Solana", price: "$142.80", change: "+5.1%" },
  { symbol: "ETH", name: "Ethereum", price: "$3,450", change: "+1.8%" },
  { symbol: "BONK", name: "Bonk", price: "$0.0000234", change: "-3.2%" },
];

function StatCard({ title, value, sub, icon: Icon, trend, color }: {
  title: string; value: string; sub?: string; icon: React.ElementType; trend?: "up" | "down"; color?: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold font-mono" style={color ? { color } : {}}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `hsl(270 100% 60% / 0.15)` }}>
            <Icon className="w-5 h-5" style={{ color: "hsl(270 100% 65%)" }} />
          </div>
        </div>
        {trend && (
          <div className={cn("flex items-center gap-1 mt-3 text-xs", trend === "up" ? "text-green-400" : "text-red-400")}>
            {trend === "up" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend === "up" ? "Positive" : "Negative"} trend
          </div>
        )}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(135deg, hsl(270 100% 60% / 0.03), transparent)" }} />
      </CardContent>
    </Card>
  );
}

function ActivityItem({ event }: { event: { id: number; type: string; description: string; timestamp: string; tokenName?: string | null; tokenSymbol?: string | null; amount?: number | null; } }) {
  const typeColor: Record<string, string> = {
    bundle_launch: "text-purple-400",
    vamp_launch: "text-cyan-400",
    bot_start: "text-green-400",
    bot_stop: "text-red-400",
    wallet_create: "text-blue-400",
  };
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0" data-testid={`activity-item-${event.id}`}>
      <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">{event.description}</p>
        {event.tokenName && (
          <span className={cn("text-xs font-mono", typeColor[event.type] ?? "text-muted-foreground")}>
            {event.tokenSymbol ?? event.tokenName}
          </span>
        )}
      </div>
      <div className="text-right shrink-0">
        {event.amount != null && (
          <p className="text-xs font-mono text-muted-foreground">{event.amount.toFixed(4)} SOL</p>
        )}
        <p className="text-xs text-muted-foreground">{new Date(event.timestamp).toLocaleTimeString()}</p>
      </div>
    </div>
  );
}

type PushResult = { success?: boolean; committed?: boolean; message?: string; output?: string; error?: string; hint?: string; details?: string };

export default function DashboardPage() {
  const { walletAddress } = useWallet();
  const params = walletAddress ? { walletAddress } : {};

  const { data: stats, isLoading: statsLoading } = useGetDashboardStats(params);
  const { data: activity, isLoading: activityLoading } = useGetDashboardActivity({ ...params, limit: 10 });

  const [showGithub, setShowGithub] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);

  const handleGithubPush = async () => {
    setPushing(true);
    setPushResult(null);
    try {
      const resp = await fetch(`${BASE_URL}api/github/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: GITHUB_REPO }),
      });
      const data: PushResult = await resp.json();
      setPushResult(data);
    } catch {
      setPushResult({ error: "Network error — could not reach server" });
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Your trading overview</p>
        </div>
        <div className="flex items-center gap-2">
          {!walletAddress && (
            <Badge variant="outline" className="text-yellow-400 border-yellow-400/30 bg-yellow-400/5">
              Connect wallet to see your stats
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setShowGithub(true); setPushResult(null); }}
            className="border-gray-600/50 text-gray-300 hover:bg-gray-700/30 hover:text-white gap-2"
          >
            <Github className="w-4 h-4" />
            Push to GitHub
          </Button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))
        ) : (
          <>
            <StatCard
              title="Today's Earnings"
              value={`$${(stats?.earningsToday ?? 0).toFixed(2)}`}
              sub={`Last 30d: $${(stats?.earningsLast30Days ?? 0).toFixed(2)}`}
              icon={DollarSign}
              trend={(stats?.earningsToday ?? 0) >= 0 ? "up" : "down"}
            />
            <StatCard
              title="Bundles Launched"
              value={String(stats?.bundlesLaunched ?? 0)}
              sub={`${stats?.activeBots ?? 0} bots active`}
              icon={Rocket}
            />
            <StatCard
              title="Total Balance"
              value={`${(stats?.totalBalanceSol ?? 0).toFixed(4)} SOL`}
              sub={`$${(stats?.totalBalanceUsd ?? 0).toFixed(2)} USD`}
              icon={Wallet}
              color="hsl(190 100% 60%)"
            />
            <StatCard
              title="PNL"
              value={`${(stats?.pnl ?? 0) >= 0 ? "+" : ""}${(stats?.pnl ?? 0).toFixed(2)}%`}
              sub={`${stats?.totalWallets ?? 0} wallets stored`}
              icon={TrendingUp}
              trend={(stats?.pnl ?? 0) >= 0 ? "up" : "down"}
              color={(stats?.pnl ?? 0) >= 0 ? "hsl(142 71% 45%)" : "hsl(0 72% 51%)"}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity Feed */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : activity && activity.length > 0 ? (
              <div>
                {activity.map((event) => (
                  <ActivityItem key={event.id} event={{ ...event, timestamp: event.timestamp }} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Activity className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No activity yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Launch your first token to see activity here</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Crypto Prices */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-primary" /> Market Prices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {COIN_PRICES.map((coin) => {
                const isUp = coin.change.startsWith("+");
                return (
                  <div key={coin.symbol} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0" data-testid={`price-${coin.symbol.toLowerCase()}`}>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: "hsl(270 100% 60% / 0.15)", color: "hsl(270 100% 70%)" }}>
                        {coin.symbol[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{coin.symbol}</p>
                        <p className="text-xs text-muted-foreground">{coin.name}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono font-semibold">{coin.price}</p>
                      <p className={cn("text-xs font-mono", isUp ? "text-green-400" : "text-red-400")}>{coin.change}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* GitHub Push Dialog */}
      <Dialog open={showGithub} onOpenChange={setShowGithub}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Github className="w-5 h-5" />
              Push to GitHub
            </DialogTitle>
            <DialogDescription>
              Commit all current changes and push them to your repository.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 flex items-center gap-3">
              <Github className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Target repository</p>
                <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer" className="text-sm font-mono text-foreground hover:underline flex items-center gap-1">
                  mohamedtarrek/Asset-Managerzip
                  <ExternalLink className="w-3 h-3 text-muted-foreground" />
                </a>
              </div>
            </div>

            {!pushResult && (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-xs text-yellow-300/80 space-y-1">
                <p className="font-medium text-yellow-300">Before pushing:</p>
                <p>Make sure <span className="font-mono">GITHUB_TOKEN</span> is set in your project secrets with <span className="font-mono">repo</span> scope.</p>
                <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer" className="underline text-yellow-200">Generate a token →</a>
              </div>
            )}

            {pushResult && (
              <div className={cn(
                "rounded-lg border px-4 py-3 text-sm space-y-1",
                pushResult.success
                  ? "border-green-500/30 bg-green-500/5 text-green-300"
                  : "border-red-500/30 bg-red-500/5 text-red-300"
              )}>
                <div className="flex items-center gap-2 font-medium">
                  {pushResult.success
                    ? <CheckCircle className="w-4 h-4" />
                    : <XCircle className="w-4 h-4" />}
                  {pushResult.success ? (pushResult.committed ? "Pushed successfully" : "Already up to date") : "Push failed"}
                </div>
                {pushResult.message && <p className="text-xs opacity-80">{pushResult.message}</p>}
                {pushResult.output && <p className="text-xs font-mono opacity-70 break-all">{pushResult.output}</p>}
                {pushResult.error && <p className="text-xs opacity-90">{pushResult.error}</p>}
                {pushResult.hint && <p className="text-xs opacity-70 mt-1">{pushResult.hint}</p>}
                {pushResult.details && <p className="text-xs font-mono opacity-60 break-all mt-1">{pushResult.details}</p>}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowGithub(false)}>Cancel</Button>
              <Button
                size="sm"
                onClick={handleGithubPush}
                disabled={pushing}
                className="bg-gray-700 hover:bg-gray-600 text-white gap-2"
              >
                {pushing
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Pushing...</>
                  : <><Github className="w-4 h-4" />Push Now</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
