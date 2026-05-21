import { useState, useEffect } from "react";
import { Rocket, Copy, Lock, Search, Loader2, CheckCircle } from "lucide-react";
import { useWallet } from "@/lib/wallet-context";
import {
  useCreateBundle,
  useCreateVampBundle,
  useGetTokenMetadata,
  getGetTokenMetadataQueryKey,
  useListWallets,
  getListWalletsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

const WALLET_COUNT_OPTIONS = [5, 10, 20];

function NewBundleForm({ walletAddress }: { walletAddress: string | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createBundle = useCreateBundle();
  const [form, setForm] = useState({ tokenName: "", tokenSymbol: "", tokenDescription: "", tokenImageUrl: "", walletCount: 10, solPerWallet: 0.1 });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAddress) { toast({ title: "Connect your wallet first", variant: "destructive" }); return; }
    if (!form.tokenName || !form.tokenSymbol) { toast({ title: "Token name and symbol required", variant: "destructive" }); return; }
    createBundle.mutate(
      { data: { ...form, ownerAddress: walletAddress } },
      {
        onSuccess: () => {
          toast({ title: "Bundle launched!", description: `${form.tokenName} is being created on Pump.Fun` });
          setForm({ tokenName: "", tokenSymbol: "", tokenDescription: "", tokenImageUrl: "", walletCount: 10, solPerWallet: 0.1 });
          queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
        },
        onError: () => toast({ title: "Launch failed", description: "Check your connection and try again", variant: "destructive" }),
      }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="tokenName" className="text-xs text-muted-foreground">Token Name</Label>
          <Input id="tokenName" placeholder="My Meme Token" value={form.tokenName} onChange={e => setForm(p => ({ ...p, tokenName: e.target.value }))} data-testid="input-token-name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tokenSymbol" className="text-xs text-muted-foreground">Symbol</Label>
          <Input id="tokenSymbol" placeholder="MEME" value={form.tokenSymbol} onChange={e => setForm(p => ({ ...p, tokenSymbol: e.target.value.toUpperCase() }))} data-testid="input-token-symbol" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tokenDescription" className="text-xs text-muted-foreground">Description</Label>
        <Textarea id="tokenDescription" placeholder="Token description..." rows={2} value={form.tokenDescription} onChange={e => setForm(p => ({ ...p, tokenDescription: e.target.value }))} data-testid="input-token-description" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tokenImageUrl" className="text-xs text-muted-foreground">Image URL</Label>
        <Input id="tokenImageUrl" placeholder="https://..." value={form.tokenImageUrl} onChange={e => setForm(p => ({ ...p, tokenImageUrl: e.target.value }))} data-testid="input-token-image-url" />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Bundled Wallets</Label>
        <div className="flex gap-2">
          {WALLET_COUNT_OPTIONS.map(n => (
            <button key={n} type="button" onClick={() => setForm(p => ({ ...p, walletCount: n }))}
              className={cn("flex-1 py-2 rounded-lg border text-sm font-mono transition-all",
                form.walletCount === n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50")}
              data-testid={`button-wallet-count-${n}`}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="solPerWallet" className="text-xs text-muted-foreground">SOL per Wallet</Label>
        <Input id="solPerWallet" type="number" step="0.01" min="0.01" value={form.solPerWallet} onChange={e => setForm(p => ({ ...p, solPerWallet: parseFloat(e.target.value) || 0 }))} data-testid="input-sol-per-wallet" />
        <p className="text-xs text-muted-foreground">Total: {(form.walletCount * form.solPerWallet).toFixed(3)} SOL across {form.walletCount} wallets</p>
      </div>
      <Button type="submit" className="w-full" disabled={createBundle.isPending || !walletAddress} data-testid="button-launch-bundle">
        {createBundle.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Launching...</> : <><Rocket className="w-4 h-4 mr-2" /> Launch Bundle</>}
      </Button>
    </form>
  );
}

function VampForm({ walletAddress }: { walletAddress: string | null }) {
  const { toast } = useToast();
  const createVamp = useCreateVampBundle();
  const [ca, setCa] = useState("");
  const [debouncedCa, setDebouncedCa] = useState("");
  const [walletCount, setWalletCount] = useState(10);
  const [solPerWallet, setSolPerWallet] = useState(0.1);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedCa(ca), 600);
    return () => clearTimeout(t);
  }, [ca]);

  const { data: meta, isLoading: metaLoading } = useGetTokenMetadata(
    { ca: debouncedCa },
    { query: { enabled: debouncedCa.length >= 32, queryKey: getGetTokenMetadataQueryKey({ ca: debouncedCa }) } }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAddress) { toast({ title: "Connect your wallet first", variant: "destructive" }); return; }
    if (!ca) { toast({ title: "Enter a token CA", variant: "destructive" }); return; }
    createVamp.mutate(
      { data: { ownerAddress: walletAddress, sourceTokenAddress: ca, walletCount, solPerWallet } },
      {
        onSuccess: () => toast({ title: "VAMP launched!", description: "Token copy created on Pump.Fun" }),
        onError: () => toast({ title: "VAMP failed", variant: "destructive" }),
      }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="sourceCA" className="text-xs text-muted-foreground">Source Token Contract Address</Label>
        <div className="relative">
          <Input id="sourceCA" placeholder="Pump.Fun contract address..." value={ca} onChange={e => setCa(e.target.value)} data-testid="input-vamp-ca" />
          {metaLoading && <Loader2 className="absolute right-3 top-2.5 w-4 h-4 animate-spin text-muted-foreground" />}
          {meta && !metaLoading && <CheckCircle className="absolute right-3 top-2.5 w-4 h-4 text-green-400" />}
        </div>
      </div>
      {meta && (
        <div className="rounded-lg border border-border p-3 bg-card/50 space-y-1">
          <div className="flex items-center gap-2">
            {meta.imageUrl && <img src={meta.imageUrl} alt={meta.name} className="w-8 h-8 rounded-full" />}
            <div>
              <p className="text-sm font-semibold">{meta.name} <span className="text-muted-foreground">({meta.symbol})</span></p>
              {meta.description && <p className="text-xs text-muted-foreground line-clamp-1">{meta.description}</p>}
            </div>
          </div>
        </div>
      )}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Bundled Wallets</Label>
        <div className="flex gap-2">
          {WALLET_COUNT_OPTIONS.map(n => (
            <button key={n} type="button" onClick={() => setWalletCount(n)}
              className={cn("flex-1 py-2 rounded-lg border text-sm font-mono transition-all",
                walletCount === n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50")}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vampSolPerWallet" className="text-xs text-muted-foreground">SOL per Wallet</Label>
        <Input id="vampSolPerWallet" type="number" step="0.01" min="0.01" value={solPerWallet} onChange={e => setSolPerWallet(parseFloat(e.target.value) || 0)} />
      </div>
      <Button type="submit" className="w-full" disabled={createVamp.isPending || !walletAddress || !ca} data-testid="button-vamp-launch">
        {createVamp.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Launching...</> : <><Copy className="w-4 h-4 mr-2" /> VAMP Launch</>}
      </Button>
    </form>
  );
}

const LAUNCH_CARDS = [
  { id: "bundle", label: "New Bundle", icon: Rocket, description: "Create and launch a new token with multiple bundled wallets buying simultaneously at launch to simulate demand.", color: "hsl(270 100% 60%)" },
  { id: "vamp", label: "VAMP", icon: Copy, description: "Copy an existing token's metadata (name, image, description) from Pump.Fun and relaunch it with your bundle.", color: "hsl(190 100% 50%)" },
  { id: "cto", label: "CTO", icon: Lock, description: "Take over an existing token using your own wallets. Coordinate a community takeover with your bundle.", color: "hsl(40 100% 50%)", comingSoon: true },
];

export default function LaunchPage() {
  const { walletAddress } = useWallet();
  const [activeCard, setActiveCard] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Token Launch</h1>
        <p className="text-sm text-muted-foreground">Launch meme tokens on Pump.Fun with bundled wallets</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {LAUNCH_CARDS.map((card) => {
          const Icon = card.icon;
          const isActive = activeCard === card.id;
          return (
            <Card
              key={card.id}
              className={cn("cursor-pointer transition-all duration-200 border", card.comingSoon ? "opacity-60" : "hover:border-primary/50", isActive ? "border-primary" : "")}
              onClick={() => !card.comingSoon && setActiveCard(isActive ? null : card.id)}
              data-testid={`card-launch-${card.id}`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ background: `${card.color}22` }}>
                    <Icon className="w-5 h-5" style={{ color: card.color }} />
                  </div>
                  {card.comingSoon && <Badge variant="outline" className="text-yellow-400 border-yellow-400/30 text-xs">Coming Soon</Badge>}
                  {isActive && <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />}
                </div>
                <CardTitle className="text-base mt-2">{card.label}</CardTitle>
                <CardDescription className="text-xs">{card.description}</CardDescription>
              </CardHeader>
              {!card.comingSoon && (
                <CardContent className="pt-0">
                  <Button variant={isActive ? "default" : "outline"} size="sm" className="w-full" onClick={(e) => { e.stopPropagation(); setActiveCard(isActive ? null : card.id); }}>
                    {isActive ? "Close" : "Open"}
                  </Button>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {activeCard === "bundle" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Rocket className="w-4 h-4 text-primary" /> New Bundle Launch
            </CardTitle>
          </CardHeader>
          <CardContent>
            <NewBundleForm walletAddress={walletAddress} />
          </CardContent>
        </Card>
      )}

      {activeCard === "vamp" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Copy className="w-4 h-4" style={{ color: "hsl(190 100% 50%)" }} /> VAMP Launch
            </CardTitle>
          </CardHeader>
          <CardContent>
            <VampForm walletAddress={walletAddress} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
