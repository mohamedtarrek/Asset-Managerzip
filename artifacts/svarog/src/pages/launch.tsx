import { useState, useEffect, useRef, useCallback } from "react";
import { Rocket, Copy, Lock, Loader2, CheckCircle, Upload, X, AlertTriangle } from "lucide-react";
import { useWallet, RPC_ENDPOINTS } from "@/lib/wallet-context";
import { useI18n } from "@/lib/i18n";
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

function ImageUpload({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => onChange(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = () => setDragging(false);

  if (value) {
    return (
      <div className="relative group">
        <img src={value} alt="Token preview" className="w-full h-32 object-contain rounded-lg border border-border bg-muted/20" />
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-destructive/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-3 h-3 text-white" />
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={cn(
        "flex flex-col items-center justify-center gap-2 h-32 rounded-lg border-2 border-dashed cursor-pointer transition-all",
        dragging
          ? "border-primary bg-primary/10"
          : "border-border/60 bg-muted/10 hover:border-primary/50 hover:bg-muted/20"
      )}
    >
      <Upload className="w-6 h-6 text-muted-foreground" />
      <div className="text-center">
        <p className="text-xs font-medium text-foreground">{t("click_or_drag")}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t("image_formats")}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
    </div>
  );
}

function extractApiError(err: unknown): string {
  if (err instanceof Error) {
    // ApiError.message is already formatted as "HTTP 400 Bad Request: <api error message>"
    // Strip the HTTP prefix to show only the relevant part
    const msg = err.message.replace(/^HTTP \d+ [^:]+:\s*/i, "");
    return msg || err.message;
  }
  return "Launch failed — please try again";
}

function DevnetWarning({ lang }: { lang: string }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-xs text-yellow-400">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>
        {lang === "ar"
          ? "Pump.Fun يعمل على الشبكة الرئيسية فقط. ستفشل الإطلاقات على شبكة التطوير. قم بالتبديل إلى الشبكة الرئيسية في الشريط العلوي."
          : "Pump.Fun only exists on Mainnet. Launches on Devnet will fail. Switch to Mainnet in the top bar before launching."}
      </span>
    </div>
  );
}

function NewBundleForm({ walletAddress }: { walletAddress: string | null }) {
  const { toast } = useToast();
  const { t, lang } = useI18n();
  const { network } = useWallet();
  const queryClient = useQueryClient();
  const createBundle = useCreateBundle();

  const { data: wallets } = useListWallets(
    { ownerAddress: walletAddress ?? undefined },
    { query: { enabled: !!walletAddress, queryKey: getListWalletsQueryKey({ ownerAddress: walletAddress ?? undefined }) } }
  );
  const availableCount = wallets?.length ?? 0;

  const [form, setForm] = useState({
    tokenName: "",
    tokenSymbol: "",
    tokenDescription: "",
    tokenImageUrl: "",
    walletCount: 10,
    solPerWallet: 0.1,
  });

  // Cap walletCount to available wallets
  useEffect(() => {
    if (availableCount > 0 && form.walletCount > availableCount) {
      setForm(p => ({ ...p, walletCount: Math.max(1, availableCount) }));
    }
  }, [availableCount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAddress) { toast({ title: t("connect_first"), variant: "destructive" }); return; }
    if (!form.tokenName || !form.tokenSymbol) {
      toast({ title: `${t("token_name")} & ${t("token_symbol")} required`, variant: "destructive" });
      return;
    }
    if (!form.tokenImageUrl) {
      toast({ title: t("image_required"), variant: "destructive" });
      return;
    }
    if (availableCount < form.walletCount) {
      toast({
        title: `Not enough wallets`,
        description: `You have ${availableCount} wallet${availableCount !== 1 ? "s" : ""} but selected ${form.walletCount}. Generate more wallets first.`,
        variant: "destructive",
      });
      return;
    }

    createBundle.mutate(
      {
        data: {
          ...form,
          ownerAddress: walletAddress,
          rpcEndpoint: RPC_ENDPOINTS[network],
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Bundle submitted — launching on Pump.Fun..." });
          setForm({ tokenName: "", tokenSymbol: "", tokenDescription: "", tokenImageUrl: "", walletCount: 10, solPerWallet: 0.1 });
          queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
        },
        onError: (err: unknown) => {
          const message = extractApiError(err);
          toast({ title: "Launch failed", description: message, variant: "destructive" });
        },
      }
    );
  };

  const walletOptions = WALLET_COUNT_OPTIONS.filter(n => n <= Math.max(availableCount, 1));
  if (walletOptions.length === 0) walletOptions.push(Math.min(1, availableCount) || 1);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {network === "devnet" && <DevnetWarning lang={lang} />}

      {/* Wallet availability notice */}
      {walletAddress && availableCount < 5 && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-orange-500/30 bg-orange-500/10 text-xs text-orange-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            You have <strong>{availableCount}</strong> wallet{availableCount !== 1 ? "s" : ""}.
            {availableCount === 0
              ? " Generate wallets in the Wallets page before launching."
              : " For a larger bundle, generate more wallets first."}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="tokenName" className="text-xs text-muted-foreground">{t("token_name")}</Label>
          <Input id="tokenName" placeholder="My Meme Token" value={form.tokenName} onChange={e => setForm(p => ({ ...p, tokenName: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tokenSymbol" className="text-xs text-muted-foreground">{t("token_symbol")}</Label>
          <Input id="tokenSymbol" placeholder="MEME" value={form.tokenSymbol} onChange={e => setForm(p => ({ ...p, tokenSymbol: e.target.value.toUpperCase() }))} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tokenDescription" className="text-xs text-muted-foreground">{t("description")}</Label>
        <Textarea id="tokenDescription" placeholder="Token description..." rows={2} value={form.tokenDescription} onChange={e => setForm(p => ({ ...p, tokenDescription: e.target.value }))} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          {t("token_image")} <span className="text-destructive">*</span>
        </Label>
        <ImageUpload value={form.tokenImageUrl} onChange={url => setForm(p => ({ ...p, tokenImageUrl: url }))} />
        <p className="text-xs text-muted-foreground">{t("image_required")}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">{t("bundled_wallets")}</Label>
          {walletAddress && (
            <span className="text-xs text-muted-foreground">{availableCount} available</span>
          )}
        </div>
        <div className="flex gap-2">
          {WALLET_COUNT_OPTIONS.map(n => {
            const tooFew = availableCount > 0 && n > availableCount;
            return (
              <button
                key={n}
                type="button"
                onClick={() => !tooFew && setForm(p => ({ ...p, walletCount: n }))}
                disabled={tooFew}
                className={cn(
                  "flex-1 py-2 rounded-lg border text-sm font-mono transition-all",
                  form.walletCount === n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50",
                  tooFew && "opacity-30 cursor-not-allowed"
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="solPerWallet" className="text-xs text-muted-foreground">{t("sol_per_wallet")}</Label>
        <Input
          id="solPerWallet"
          type="number"
          step="0.01"
          min="0.01"
          value={form.solPerWallet}
          onChange={e => setForm(p => ({ ...p, solPerWallet: parseFloat(e.target.value) || 0 }))}
        />
        <p className="text-xs text-muted-foreground">
          {t("total")}: {(form.walletCount * form.solPerWallet).toFixed(3)} SOL {t("across")} {form.walletCount} wallets
        </p>
      </div>

      <Button type="submit" className="w-full" disabled={createBundle.isPending || !walletAddress || availableCount === 0}>
        {createBundle.isPending
          ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("launching")}</>
          : <><Rocket className="w-4 h-4 mr-2" /> {t("launch_bundle")}</>
        }
      </Button>
    </form>
  );
}

function VampForm({ walletAddress }: { walletAddress: string | null }) {
  const { toast } = useToast();
  const { t, lang } = useI18n();
  const { network } = useWallet();
  const createVamp = useCreateVampBundle();
  const [ca, setCa] = useState("");
  const [debouncedCa, setDebouncedCa] = useState("");
  const [walletCount, setWalletCount] = useState(10);
  const [solPerWallet, setSolPerWallet] = useState(0.1);

  const { data: wallets } = useListWallets(
    { ownerAddress: walletAddress ?? undefined },
    { query: { enabled: !!walletAddress, queryKey: getListWalletsQueryKey({ ownerAddress: walletAddress ?? undefined }) } }
  );
  const availableCount = wallets?.length ?? 0;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCa(ca), 600);
    return () => clearTimeout(timer);
  }, [ca]);

  const { data: meta, isLoading: metaLoading } = useGetTokenMetadata(
    { ca: debouncedCa },
    { query: { enabled: debouncedCa.length >= 32, queryKey: getGetTokenMetadataQueryKey({ ca: debouncedCa }) } }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAddress) { toast({ title: t("connect_first"), variant: "destructive" }); return; }
    if (!ca) { toast({ title: t("source_token_ca"), variant: "destructive" }); return; }
    if (availableCount < walletCount) {
      toast({
        title: "Not enough wallets",
        description: `You have ${availableCount} wallets but selected ${walletCount}.`,
        variant: "destructive",
      });
      return;
    }
    createVamp.mutate(
      {
        data: {
          ownerAddress: walletAddress,
          sourceTokenAddress: ca,
          walletCount,
          solPerWallet,
          rpcEndpoint: RPC_ENDPOINTS[network],
        },
      },
      {
        onSuccess: () => toast({ title: t("vamp_launch") + " submitted!" }),
        onError: (err: unknown) => {
          toast({ title: "VAMP failed", description: extractApiError(err), variant: "destructive" });
        },
      }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {network === "devnet" && <DevnetWarning lang={lang} />}

      <div className="space-y-1.5">
        <Label htmlFor="sourceCA" className="text-xs text-muted-foreground">{t("source_token_ca")}</Label>
        <div className="relative">
          <Input id="sourceCA" placeholder="Pump.Fun contract address..." value={ca} onChange={e => setCa(e.target.value)} />
          {metaLoading && <Loader2 className="absolute right-3 top-2.5 w-4 h-4 animate-spin text-muted-foreground" />}
          {meta && !metaLoading && <CheckCircle className="absolute right-3 top-2.5 w-4 h-4 text-green-400" />}
        </div>
      </div>

      {meta && (
        <div className="rounded-lg border border-border p-3 bg-card/50 space-y-1">
          <div className="flex items-center gap-2">
            {meta.imageUrl && <img src={meta.imageUrl} alt={meta.name} className="w-8 h-8 rounded-full object-cover" />}
            <div>
              <p className="text-sm font-semibold">{meta.name} <span className="text-muted-foreground">({meta.symbol})</span></p>
              {meta.description && <p className="text-xs text-muted-foreground line-clamp-1">{meta.description}</p>}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">{t("bundled_wallets")}</Label>
          {walletAddress && <span className="text-xs text-muted-foreground">{availableCount} available</span>}
        </div>
        <div className="flex gap-2">
          {WALLET_COUNT_OPTIONS.map(n => {
            const tooFew = availableCount > 0 && n > availableCount;
            return (
              <button
                key={n}
                type="button"
                onClick={() => !tooFew && setWalletCount(n)}
                disabled={tooFew}
                className={cn(
                  "flex-1 py-2 rounded-lg border text-sm font-mono transition-all",
                  walletCount === n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50",
                  tooFew && "opacity-30 cursor-not-allowed"
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="vampSolPerWallet" className="text-xs text-muted-foreground">{t("sol_per_wallet")}</Label>
        <Input
          id="vampSolPerWallet"
          type="number"
          step="0.01"
          min="0.01"
          value={solPerWallet}
          onChange={e => setSolPerWallet(parseFloat(e.target.value) || 0)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={createVamp.isPending || !walletAddress || !ca}>
        {createVamp.isPending
          ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("launching")}</>
          : <><Copy className="w-4 h-4 mr-2" /> {t("vamp_launch")}</>
        }
      </Button>
    </form>
  );
}

export default function LaunchPage() {
  const { walletAddress } = useWallet();
  const { t } = useI18n();
  const [activeCard, setActiveCard] = useState<string | null>(null);

  const LAUNCH_CARDS = [
    { id: "bundle", label: t("new_bundle"), icon: Rocket, description: t("new_bundle_desc"), color: "hsl(270 100% 60%)" },
    { id: "vamp", label: t("vamp"), icon: Copy, description: t("vamp_desc"), color: "hsl(190 100% 50%)" },
    { id: "cto", label: t("cto"), icon: Lock, description: t("cto_desc"), color: "hsl(40 100% 50%)", comingSoon: true },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("token_launch")}</h1>
        <p className="text-sm text-muted-foreground">{t("token_launch_subtitle")}</p>
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
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ background: `${card.color}22` }}>
                    <Icon className="w-5 h-5" style={{ color: card.color }} />
                  </div>
                  {card.comingSoon && <Badge variant="outline" className="text-yellow-400 border-yellow-400/30 text-xs">{t("coming_soon")}</Badge>}
                  {isActive && <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />}
                </div>
                <CardTitle className="text-base mt-2">{card.label}</CardTitle>
                <CardDescription className="text-xs">{card.description}</CardDescription>
              </CardHeader>
              {!card.comingSoon && (
                <CardContent className="pt-0">
                  <Button
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    className="w-full"
                    onClick={(e) => { e.stopPropagation(); setActiveCard(isActive ? null : card.id); }}
                  >
                    {isActive ? t("close") : t("open")}
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
              <Rocket className="w-4 h-4 text-primary" /> {t("new_bundle")}
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
              <Copy className="w-4 h-4" style={{ color: "hsl(190 100% 50%)" }} /> {t("vamp_launch")}
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
