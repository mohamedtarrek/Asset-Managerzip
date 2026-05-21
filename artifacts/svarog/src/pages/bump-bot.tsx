import { useState, useEffect } from "react";
import { Bot, Play, Pause, Square, Plus, Loader2, Zap, Clock, DollarSign, Activity } from "lucide-react";
import { useWallet } from "@/lib/wallet-context";
import { useListBots, useCreateBot, useStartBot, useStopBot, usePauseBot, useDeleteBot, useEstimateBotCost, getListBotsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

const WALLET_COUNTS = [5, 10, 15, 20, 25];
const SPEEDS = [
  { value: "gentle", label: "Gentle", sub: "90-150s between bumps" },
  { value: "moderate", label: "Moderate", sub: "20-40s between bumps" },
  { value: "fast", label: "Fast", sub: "10-20s between bumps" },
];

const BOT_STATUS_COLORS: Record<string, string> = {
  running: "text-green-400 border-green-400/30 bg-green-400/5",
  paused: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
  idle: "text-blue-400 border-blue-400/30 bg-blue-400/5",
  stopped: "text-red-400 border-red-400/30 bg-red-400/5",
  completed: "text-muted-foreground border-border",
};

function BotCard({ bot }: {
  bot: { id: number; tokenAddress: string; tokenName?: string | null; walletCount: number; speed: string; budgetSol: number; bumpSize?: number | null; bumpsPerHour?: number | null; bumpsExecuted?: number | null; totalBumps?: number | null; estimatedDurationHours?: number | null; status: string; };
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const startBot = useStartBot();
  const stopBot = useStopBot();
  const pauseBot = usePauseBot();
  const deleteBot = useDeleteBot();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });

  const progress = bot.totalBumps && bot.bumpsExecuted ? Math.round((bot.bumpsExecuted / bot.totalBumps) * 100) : 0;

  return (
    <Card data-testid={`bot-card-${bot.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "hsl(270 100% 60% / 0.15)" }}>
              <Bot className="w-4 h-4" style={{ color: "hsl(270 100% 65%)" }} />
            </div>
            <div>
              <p className="text-sm font-semibold">{bot.tokenName ?? "Unknown Token"}</p>
              <p className="text-xs font-mono text-muted-foreground truncate max-w-[180px]">{bot.tokenAddress}</p>
            </div>
          </div>
          <Badge variant="outline" className={cn("text-xs", BOT_STATUS_COLORS[bot.status] ?? "text-muted-foreground")}>{bot.status}</Badge>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-2 rounded-lg bg-card border border-border">
            <p className="text-xs text-muted-foreground">Bump Size</p>
            <p className="text-sm font-mono font-bold">{(bot.bumpSize ?? 0).toFixed(4)} SOL</p>
          </div>
          <div className="p-2 rounded-lg bg-card border border-border">
            <p className="text-xs text-muted-foreground">Per Hour</p>
            <p className="text-sm font-mono font-bold">{bot.bumpsPerHour ?? 0}</p>
          </div>
          <div className="p-2 rounded-lg bg-card border border-border">
            <p className="text-xs text-muted-foreground">Executed</p>
            <p className="text-sm font-mono font-bold">{bot.bumpsExecuted ?? 0}/{bot.totalBumps ?? "?"}</p>
          </div>
        </div>

        {bot.totalBumps && bot.bumpsExecuted != null && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-border overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: "hsl(270 100% 60%)" }} />
            </div>
            <p className="text-xs text-muted-foreground">{progress}% complete · ~{bot.estimatedDurationHours?.toFixed(1)}h total</p>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          {bot.status !== "running" && (
            <Button size="sm" variant="outline" className="flex-1 text-green-400 border-green-400/30 hover:bg-green-400/10"
              onClick={() => startBot.mutate({ id: bot.id }, { onSuccess: invalidate })} data-testid={`button-start-bot-${bot.id}`}>
              <Play className="w-3 h-3 mr-1" /> Start
            </Button>
          )}
          {bot.status === "running" && (
            <Button size="sm" variant="outline" className="flex-1 text-yellow-400 border-yellow-400/30 hover:bg-yellow-400/10"
              onClick={() => pauseBot.mutate({ id: bot.id }, { onSuccess: invalidate })} data-testid={`button-pause-bot-${bot.id}`}>
              <Pause className="w-3 h-3 mr-1" /> Pause
            </Button>
          )}
          <Button size="sm" variant="outline" className="flex-1 text-red-400 border-red-400/30 hover:bg-red-400/10"
            onClick={() => stopBot.mutate({ id: bot.id }, { onSuccess: invalidate })} data-testid={`button-stop-bot-${bot.id}`}>
            <Square className="w-3 h-3 mr-1" /> Stop
          </Button>
          <Button size="sm" variant="ghost" className="w-8 h-8 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => deleteBot.mutate({ id: bot.id }, { onSuccess: () => { toast({ title: "Bot deleted" }); invalidate(); } })} data-testid={`button-delete-bot-${bot.id}`}>
            ×
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function BumpBotPage() {
  const { walletAddress } = useWallet();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({ tokenAddress: "", walletCount: 10, speed: "moderate", budgetSol: 0.5 });
  const { data: bots, isLoading } = useListBots(walletAddress ? { ownerAddress: walletAddress } : {});
  const createBot = useCreateBot();
  const estimateCost = useEstimateBotCost();

  useEffect(() => {
    if (form.walletCount > 0 && form.budgetSol > 0) {
      estimateCost.mutate({ data: { walletCount: form.walletCount, speed: form.speed, budgetSol: form.budgetSol } });
    }
  }, [form.walletCount, form.speed, form.budgetSol]);

  const estimate = estimateCost.data;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAddress) { toast({ title: "Connect wallet first", variant: "destructive" }); return; }
    if (!form.tokenAddress) { toast({ title: "Token CA required", variant: "destructive" }); return; }
    createBot.mutate(
      { data: { ownerAddress: walletAddress, ...form } },
      {
        onSuccess: () => {
          toast({ title: "Bump bot created!" });
          setForm({ tokenAddress: "", walletCount: 10, speed: "moderate", budgetSol: 0.5 });
          queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
        },
        onError: () => toast({ title: "Failed to create bot", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Bump Bot</h1>
        <p className="text-sm text-muted-foreground">Keep your token visible on Pump.Fun with automated bumps</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Create form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" /> Create Bump Bot
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Token Contract Address</Label>
                <Input placeholder="Pump.Fun token CA..." value={form.tokenAddress} onChange={e => setForm(p => ({ ...p, tokenAddress: e.target.value }))} data-testid="input-bot-token-ca" />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Number of Wallets</Label>
                <div className="flex gap-2 flex-wrap">
                  {WALLET_COUNTS.map(n => (
                    <button key={n} type="button" onClick={() => setForm(p => ({ ...p, walletCount: n }))}
                      className={cn("px-3 py-1.5 rounded-lg border text-sm font-mono transition-all",
                        form.walletCount === n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50")}
                      data-testid={`button-bot-wallets-${n}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Bump Speed</Label>
                <div className="space-y-2">
                  {SPEEDS.map(s => (
                    <button key={s.value} type="button" onClick={() => setForm(p => ({ ...p, speed: s.value }))}
                      className={cn("w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left",
                        form.speed === s.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/50")}
                      data-testid={`button-speed-${s.value}`}>
                      <span className={cn("text-sm font-medium", form.speed === s.value ? "text-primary" : "")}>{s.label}</span>
                      <span className="text-xs text-muted-foreground">{s.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Total Budget (SOL)</Label>
                <Input type="number" step="0.1" min="0.2" value={form.budgetSol} onChange={e => setForm(p => ({ ...p, budgetSol: parseFloat(e.target.value) || 0 }))} data-testid="input-bot-budget" />
                <p className="text-xs text-muted-foreground">Minimum 0.2 SOL for 10 wallets · 0.05 SOL per wallet</p>
              </div>

              <Button type="submit" className="w-full" disabled={createBot.isPending || !walletAddress || !form.tokenAddress} data-testid="button-create-bot">
                {createBot.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</> : <><Bot className="w-4 h-4 mr-2" /> Create Bump Bot</>}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Estimate card */}
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" /> Live Estimate
            </CardTitle>
          </CardHeader>
          <CardContent>
            {estimateCost.isPending ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : estimate ? (
              <div className="space-y-3">
                {estimate.isValid === false && estimate.validationMessage && (
                  <div className="p-3 rounded-lg border border-red-400/30 bg-red-400/5 text-xs text-red-400">{estimate.validationMessage}</div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { icon: Zap, label: "Bump Size", value: `${estimate.bumpSize.toFixed(4)} SOL`, color: "text-yellow-400" },
                    { icon: Activity, label: "Bumps/Hour", value: String(estimate.bumpsPerHour), color: "text-cyan-400" },
                    { icon: DollarSign, label: "Cost/Bump", value: `${estimate.costPerBump.toFixed(5)} SOL`, color: "text-green-400" },
                    { icon: Activity, label: "Total Bumps", value: String(estimate.totalBumps), color: "text-purple-400" },
                  ].map(({ icon: Icon, label, value, color }) => (
                    <div key={label} className="p-3 rounded-lg border border-border bg-card/50">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon className={cn("w-3 h-3", color)} />
                        <span className="text-xs text-muted-foreground">{label}</span>
                      </div>
                      <p className="font-mono font-bold text-sm">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="p-3 rounded-lg border border-border bg-card/50 flex items-center gap-3">
                  <Clock className="w-4 h-4 text-primary shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Estimated Duration</p>
                    <p className="font-mono font-bold">{estimate.estimatedDurationHours.toFixed(1)} hours</p>
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-border bg-card/50 flex items-center gap-3">
                  <DollarSign className="w-4 h-4 text-cyan-400 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">SOL per Wallet</p>
                    <p className="font-mono font-bold">{estimate.solPerWallet.toFixed(4)} SOL</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Zap className="w-10 h-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">Fill in the form to see a live estimate</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Bots */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" /> Active Bots
          {bots && bots.length > 0 && <Badge variant="outline" className="text-xs">{bots.length}</Badge>}
        </h2>
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
          </div>
        ) : bots && bots.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bots.map(bot => <BotCard key={bot.id} bot={bot} />)}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Bot className="w-12 h-12 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No bots created yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Create a bump bot above to keep your token visible</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
