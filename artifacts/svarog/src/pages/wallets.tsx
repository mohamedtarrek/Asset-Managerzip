import { useState } from "react";
import { Plus, Download, Trash2, Wallet, CheckSquare, Square, Loader2, RefreshCw, Eye, EyeOff, Copy } from "lucide-react";
import { useWallet } from "@/lib/wallet-context";
import { useI18n } from "@/lib/i18n";
import { useListWallets, useCreateWallet, useImportWallet, useGenerateBulkWallets, useDeleteWallet, useListWalletGroups, useGetWalletPrivateKey, getGetWalletPrivateKeyQueryKey, getListWalletsQueryKey, getListWalletGroupsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

const MAX_WALLETS = 200;

function PrivateKeyReveal({ walletId }: { walletId: number }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const { data, isLoading } = useGetWalletPrivateKey(walletId, {
    query: { enabled: visible, staleTime: Infinity, queryKey: getGetWalletPrivateKeyQueryKey(walletId) },
  });

  const handleCopy = () => {
    if (data?.privateKeyBase58) {
      navigator.clipboard.writeText(data.privateKeyBase58);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <div className="flex-1 min-w-0 font-mono text-xs bg-muted/30 rounded px-2 py-0.5 border border-border/50">
        {!visible ? (
          <span className="text-muted-foreground tracking-widest select-none">••••••••••••••••••••••••••••••••••••••••••</span>
        ) : isLoading ? (
          <span className="text-muted-foreground">Loading...</span>
        ) : (
          <span className="text-yellow-400/90 break-all">{data?.privateKeyBase58}</span>
        )}
      </div>
      <button
        onClick={() => setVisible(v => !v)}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        title={visible ? "Hide private key" : "Show private key"}
      >
        {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
      {visible && data?.privateKeyBase58 && (
        <button
          onClick={handleCopy}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          title="Copy private key"
        >
          <Copy className={cn("w-3.5 h-3.5", copied && "text-green-400")} />
        </button>
      )}
    </div>
  );
}

function WalletRow({ wallet, selected, onSelect, onDelete }: {
  wallet: { id: number; publicKey: string; label?: string | null; group?: string | null; balanceSol?: number | null; balanceUsd?: number | null; isActive?: boolean; };
  selected: boolean; onSelect: () => void; onDelete: () => void;
}) {
  const short = `${wallet.publicKey.slice(0, 6)}...${wallet.publicKey.slice(-8)}`;
  return (
    <div className={cn("p-3 border rounded-lg transition-all", selected ? "border-primary bg-primary/5" : "border-border bg-card/30 hover:bg-card/60")} data-testid={`wallet-row-${wallet.id}`}>
      <div className="flex items-center gap-3">
        <button onClick={onSelect} className="shrink-0 text-muted-foreground hover:text-primary transition-colors">
          {selected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
        </button>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(270 100% 60% / 0.12)" }}>
          <Wallet className="w-4 h-4" style={{ color: "hsl(270 100% 65%)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-mono text-foreground">{short}</p>
            {wallet.label && <span className="text-xs text-muted-foreground">· {wallet.label}</span>}
            {wallet.group && <Badge variant="outline" className="text-xs px-1.5 py-0">{wallet.group}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{wallet.publicKey}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-mono font-semibold">{(wallet.balanceSol ?? 0).toFixed(4)} <span className="text-xs text-muted-foreground">SOL</span></p>
          {wallet.balanceUsd != null && <p className="text-xs text-muted-foreground">${wallet.balanceUsd.toFixed(2)}</p>}
        </div>
        <button onClick={onDelete} className="text-muted-foreground hover:text-destructive transition-colors shrink-0" data-testid={`button-delete-wallet-${wallet.id}`}>
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="ml-[52px]">
        <PrivateKeyReveal walletId={wallet.id} />
      </div>
    </div>
  );
}

export default function WalletsPage() {
  const { walletAddress } = useWallet();
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [importKey, setImportKey] = useState("");
  const [importLabel, setImportLabel] = useState("");
  const [importGroup, setImportGroup] = useState("");
  const [bulkCount, setBulkCount] = useState(5);
  const [bulkGroup, setBulkGroup] = useState("");

  const params = {
    ownerAddress: walletAddress ?? undefined,
    group: groupFilter !== "all" ? groupFilter : undefined,
  };
  const { data: wallets, isLoading } = useListWallets(params);
  const { data: groups } = useListWalletGroups(walletAddress ? { ownerAddress: walletAddress } : {});
  const createWallet = useCreateWallet();
  const importWallet = useImportWallet();
  const generateBulk = useGenerateBulkWallets();
  const deleteWallet = useDeleteWallet();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListWalletGroupsQueryKey() });
  };

  const handleGenerate = () => {
    if (!walletAddress) { toast({ title: t("connect_first"), variant: "destructive" }); return; }
    createWallet.mutate({ data: { ownerAddress: walletAddress } }, {
      onSuccess: () => { toast({ title: t("wallet_generated") }); invalidate(); },
    });
  };

  const handleImport = () => {
    if (!walletAddress || !importKey) { toast({ title: t("private_key_label"), variant: "destructive" }); return; }
    importWallet.mutate({ data: { ownerAddress: walletAddress, privateKey: importKey, label: importLabel || undefined, group: importGroup || undefined } }, {
      onSuccess: () => { toast({ title: t("wallet_imported") }); setImportOpen(false); setImportKey(""); invalidate(); },
      onError: () => toast({ title: t("invalid_key"), variant: "destructive" }),
    });
  };

  const handleBulkGenerate = () => {
    if (!walletAddress) { toast({ title: t("connect_first"), variant: "destructive" }); return; }
    generateBulk.mutate({ data: { ownerAddress: walletAddress, count: bulkCount, group: bulkGroup || undefined } }, {
      onSuccess: (ws) => { toast({ title: `${t("generated_wallets")} ${ws.length}` }); setBulkOpen(false); invalidate(); },
    });
  };

  const handleDelete = (id: number) => {
    deleteWallet.mutate({ id }, {
      onSuccess: () => {
        toast({ title: t("wallet_deleted") });
        invalidate();
        selected.delete(id);
        setSelected(new Set(selected));
      },
    });
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    setDeletingBulk(true);
    const ids = Array.from(selected);
    let deleted = 0;
    for (const id of ids) {
      try {
        await new Promise<void>((resolve, reject) => {
          deleteWallet.mutate({ id }, { onSuccess: () => resolve(), onError: reject });
        });
        deleted++;
      } catch { /* continue */ }
    }
    setSelected(new Set());
    invalidate();
    setDeletingBulk(false);
    toast({ title: `${deleted} ${t("wallets_deleted")}` });
  };

  const toggleSelect = (id: number) => {
    const ns = new Set(selected);
    if (ns.has(id)) ns.delete(id); else ns.add(id);
    setSelected(ns);
  };

  const toggleAll = () => {
    if (!wallets) return;
    if (selected.size === wallets.length) setSelected(new Set());
    else setSelected(new Set(wallets.map(w => w.id)));
  };

  const count = wallets?.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("wallets_title")}</h1>
          <p className="text-sm text-muted-foreground">{t("wallets_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
            <RefreshCw className="w-4 h-4 mr-2" /> {t("bulk_generate")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Download className="w-4 h-4 mr-2" /> {t("import_wallet")}
          </Button>
          <Button size="sm" onClick={handleGenerate} disabled={createWallet.isPending}>
            {createWallet.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            {t("generate")}
          </Button>
        </div>
      </div>

      {/* Storage bar */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("storage_usage")}</span>
            <span className="font-mono font-semibold">{count}/{MAX_WALLETS} {t("used")}</span>
          </div>
          <Progress value={(count / MAX_WALLETS) * 100} className="h-2" />
          <p className="text-xs text-muted-foreground">{MAX_WALLETS - count} {t("wallet_slots_remaining")}</p>
        </CardContent>
      </Card>

      {/* Filters & bulk actions */}
      <div className="flex items-center gap-3">
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t("all_groups")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all_groups")}</SelectItem>
            {groups?.map(g => (
              <SelectItem key={g.name} value={g.name}>{g.name} ({g.count})</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selected.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDelete}
            disabled={deletingBulk}
            className="flex items-center gap-2"
          >
            {deletingBulk
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Trash2 className="w-4 h-4" />
            }
            {t("delete_selected")} ({selected.size})
          </Button>
        )}

        <button
          onClick={toggleAll}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
        >
          {selected.size === count && count > 0 ? t("deselect_all") : t("select_all")}
        </button>
      </div>

      {/* Wallet list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : wallets && wallets.length > 0 ? (
        <div className="space-y-2">
          {wallets.map(w => (
            <WalletRow key={w.id} wallet={w} selected={selected.has(w.id)} onSelect={() => toggleSelect(w.id)} onDelete={() => handleDelete(w.id)} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Wallet className="w-14 h-14 text-muted-foreground/20 mb-4" />
            <h3 className="text-base font-semibold mb-1">{t("no_wallets")}</h3>
            <p className="text-sm text-muted-foreground mb-6">{t("no_wallets_desc")}</p>
            <Button onClick={handleGenerate}>{t("generate")}</Button>
          </CardContent>
        </Card>
      )}

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("import_wallet")}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("private_key_label")}</Label>
              <Input type="password" placeholder="Base58 encoded private key..." value={importKey} onChange={e => setImportKey(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("label_optional")}</Label>
                <Input placeholder="Trading wallet" value={importLabel} onChange={e => setImportLabel(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("group_optional")}</Label>
                <Input placeholder="Group A" value={importGroup} onChange={e => setImportGroup(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleImport} disabled={importWallet.isPending || !importKey}>
              {importWallet.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} {t("import_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Generate Dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("bulk_generate")}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("num_wallets")}</Label>
              <Input type="number" min="1" max="50" value={bulkCount} onChange={e => setBulkCount(parseInt(e.target.value) || 1)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("group_optional")}</Label>
              <Input placeholder="Bundle Group A" value={bulkGroup} onChange={e => setBulkGroup(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleBulkGenerate} disabled={generateBulk.isPending}>
              {generateBulk.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} {t("bulk_generate_confirm")} {bulkCount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
