import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Rocket,
  Package,
  Wallet,
  Bot,
  Settings,
  Zap,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Loader2,
  Globe,
  FlaskConical,
  CoinsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/lib/wallet-context";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { useGetDashboardStats, getGetDashboardStatsQueryKey } from "@workspace/api-client-react";
import { RPC_ENDPOINTS } from "@/lib/wallet-context";

function truncateAddress(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [inputAddress, setInputAddress] = useState("");

  const { walletAddress, isConnecting, hasPhantom, network, setNetwork, connect, disconnect, setManualAddress } = useWallet();
  const { lang, setLang, t, isRTL } = useI18n();

  const navItems = [
    { href: "/dashboard", label: t("nav_dashboard"), icon: LayoutDashboard },
    { href: "/launch", label: t("nav_launch"), icon: Rocket },
    { href: "/bundles", label: t("nav_bundles"), icon: Package },
    { href: "/portfolio", label: "Portfolio", icon: CoinsIcon },
    { href: "/wallets", label: t("nav_wallets"), icon: Wallet },
    { href: "/bump-bot", label: t("nav_bumpbot"), icon: Bot },
    { href: "/settings", label: t("nav_settings"), icon: Settings },
  ];

  const { data: stats } = useGetDashboardStats(
    { walletAddress: walletAddress ?? undefined },
    { query: { enabled: !!walletAddress, queryKey: getGetDashboardStatsQueryKey({ walletAddress: walletAddress ?? undefined }) } }
  );

  const { data: ownerBalance } = useQuery({
    queryKey: ["owner-balance", walletAddress, network],
    enabled: !!walletAddress,
    refetchInterval: 30_000,
    queryFn: async () => {
      const rpcUrl = RPC_ENDPOINTS[network];
      const resp = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [walletAddress] }),
      });
      const json = await resp.json() as { result?: { value: number } };
      const lamports = json.result?.value ?? 0;
      const sol = lamports / 1_000_000_000;
      return { sol, usd: sol * 142.8 };
    },
  });

  const handleConnectClick = async () => {
    if (hasPhantom) {
      await connect();
    } else {
      setManualOpen(true);
    }
  };

  const handleManualConnect = () => {
    if (inputAddress.trim().length >= 32) {
      setManualAddress(inputAddress.trim());
      setManualOpen(false);
      setInputAddress("");
    }
  };

  const isDevnet = network === "devnet";

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r border-border transition-all duration-300 relative",
          collapsed ? "w-16" : "w-56",
          isRTL ? "border-l border-r-0 order-last" : ""
        )}
        style={{ background: "hsl(var(--sidebar))" }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2 px-4 py-5 border-b border-border h-16 shrink-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, hsl(270 100% 60%), hsl(190 100% 50%))" }}>
            <Zap className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <span className="font-bold text-sm tracking-wide text-foreground">
              Bundle<span style={{ color: "hsl(270 100% 70%)" }}>X</span>
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = location === href || (href === "/dashboard" && location === "/");
            return (
              <Link key={href} href={href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150",
                    active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    isRTL ? "flex-row-reverse" : ""
                  )}
                  style={active ? {
                    background: "linear-gradient(90deg, hsl(270 100% 60% / 0.25), hsl(270 100% 60% / 0.05))",
                    borderLeft: isRTL ? "none" : "2px solid hsl(270 100% 60%)",
                    borderRight: isRTL ? "2px solid hsl(270 100% 60%)" : "none",
                  } : {}}
                >
                  <Icon className={cn("w-4 h-4 shrink-0", active ? "text-primary" : "")} />
                  {!collapsed && (
                    <span className={cn("text-sm font-medium", active ? "text-foreground" : "")}>
                      {label}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "absolute top-20 w-6 h-6 rounded-full border border-border bg-card flex items-center justify-center hover:bg-accent transition-colors z-10",
            isRTL ? "-left-3" : "-right-3"
          )}
        >
          {collapsed
            ? (isRTL ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)
            : (isRTL ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />)
          }
        </button>

        {/* Bottom wallet info */}
        {!collapsed && (
          <div className="p-4 border-t border-border">
            {walletAddress ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">{t("connected")}</div>
                <div className="text-xs font-mono text-primary truncate">{truncateAddress(walletAddress)}</div>
                <button
                  onClick={disconnect}
                  className={cn("flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors", isRTL ? "flex-row-reverse" : "")}
                >
                  <LogOut className="w-3 h-3" /> {t("disconnect")}
                </button>
              </div>
            ) : (
              <Button size="sm" className="w-full text-xs" onClick={handleConnectClick} disabled={isConnecting}>
                {isConnecting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                {t("connect_wallet")}
              </Button>
            )}
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-16 flex items-center justify-between px-6 border-b border-border shrink-0 bg-card/50 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground">
              {navItems.find(n => n.href === location)?.label || t("nav_dashboard")}
            </div>
          </div>
          <div className={cn("flex items-center gap-2", isRTL ? "flex-row-reverse" : "")}>
            {/* Balance — live on-chain balance of the connected wallet */}
            {walletAddress && (
              <div className="hidden md:flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">{t("balance")}:</span>
                <span className="font-mono text-foreground font-semibold">
                  {ownerBalance ? ownerBalance.sol.toFixed(4) : "—"} SOL
                </span>
                <span className="text-muted-foreground/60">
                  ${ownerBalance ? ownerBalance.usd.toFixed(2) : "—"}
                </span>
              </div>
            )}

            {/* Network toggle */}
            <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs font-medium">
              <button
                onClick={() => setNetwork("mainnet")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 transition-colors",
                  !isDevnet
                    ? "bg-green-500/20 text-green-400"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                title={t("mainnet")}
              >
                <Globe className="w-3 h-3" />
                <span className="hidden sm:inline">{t("mainnet")}</span>
              </button>
              <div className="w-px h-5 bg-border" />
              <button
                onClick={() => setNetwork("devnet")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 transition-colors",
                  isDevnet
                    ? "bg-yellow-500/20 text-yellow-400"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                title={t("devnet")}
              >
                <FlaskConical className="w-3 h-3" />
                <span className="hidden sm:inline">{t("devnet")}</span>
              </button>
            </div>

            {/* Language toggle */}
            <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs font-medium">
              <button
                onClick={() => setLang("en")}
                className={cn(
                  "px-2.5 py-1.5 transition-colors",
                  lang === "en"
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                EN
              </button>
              <div className="w-px h-5 bg-border" />
              <button
                onClick={() => setLang("ar")}
                className={cn(
                  "px-2.5 py-1.5 transition-colors",
                  lang === "ar"
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                AR
              </button>
            </div>

            {/* Wallet connect */}
            {walletAddress ? (
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-mono cursor-pointer hover:bg-accent transition-colors"
                onClick={disconnect}
                title="Click to disconnect"
              >
                <div className={cn("w-2 h-2 rounded-full animate-pulse", isDevnet ? "bg-yellow-400" : "bg-green-400")} />
                {truncateAddress(walletAddress)}
              </div>
            ) : (
              <Button size="sm" onClick={handleConnectClick} disabled={isConnecting}>
                {isConnecting
                  ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> {t("connecting")}</>
                  : hasPhantom
                    ? t("connect_phantom")
                    : t("connect_wallet")
                }
              </Button>
            )}
          </div>
        </header>

        {/* Devnet warning banner */}
        {isDevnet && (
          <div className="px-6 py-1.5 text-xs text-center font-medium text-yellow-400 bg-yellow-500/10 border-b border-yellow-500/20">
            <FlaskConical className="w-3 h-3 inline mr-1.5" />
            {t("devnet")} — {lang === "ar" ? "هذه الشبكة للاختبار فقط، لا تُستخدم أموال حقيقية" : "Test network only — no real funds used"}
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

      {/* Manual address fallback dialog */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("connect_wallet")}</DialogTitle>
            <DialogDescription>
              {lang === "ar"
                ? "لم يتم اكتشاف امتداد Phantom. ثبّت Phantom للاتصال بنقرة واحدة، أو أدخل عنوان سولانا يدوياً."
                : "Phantom wallet extension not detected. Install Phantom for one-click connect, or enter your Solana address manually."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <a
              href="https://phantom.app"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50 hover:bg-accent transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white text-xs font-bold">P</div>
                <div>
                  <p className="text-sm font-medium">{t("install_phantom")}</p>
                  <p className="text-xs text-muted-foreground">phantom.app</p>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">→</span>
            </a>
            <div className="relative flex items-center gap-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground px-2">{t("or_enter_manually")}</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <Input
              placeholder={t("wallet_address_placeholder")}
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleManualConnect()}
              className="font-mono text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleManualConnect} disabled={inputAddress.trim().length < 32}>
              {t("connect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
