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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/lib/wallet-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useGetDashboardStats, getGetDashboardStatsQueryKey } from "@workspace/api-client-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/launch", label: "Token Launch", icon: Rocket },
  { href: "/bundles", label: "Bundles", icon: Package },
  { href: "/wallets", label: "Wallets", icon: Wallet },
  { href: "/bump-bot", label: "Bump Bot", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
];

function truncateAddress(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [inputAddress, setInputAddress] = useState("");

  const { walletAddress, isConnecting, hasPhantom, connect, disconnect, setManualAddress } = useWallet();

  const { data: stats } = useGetDashboardStats(
    { walletAddress: walletAddress ?? undefined },
    { query: { enabled: !!walletAddress, queryKey: getGetDashboardStatsQueryKey({ walletAddress: walletAddress ?? undefined }) } }
  );

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

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r border-border transition-all duration-300 relative",
          collapsed ? "w-16" : "w-56"
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
                  data-testid={`nav-${label.toLowerCase().replace(" ", "-")}`}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150",
                    active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                  style={active ? {
                    background: "linear-gradient(90deg, hsl(270 100% 60% / 0.25), hsl(270 100% 60% / 0.05))",
                    borderLeft: "2px solid hsl(270 100% 60%)"
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
          className="absolute -right-3 top-20 w-6 h-6 rounded-full border border-border bg-card flex items-center justify-center hover:bg-accent transition-colors z-10"
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>

        {/* Bottom wallet info */}
        {!collapsed && (
          <div className="p-4 border-t border-border">
            {walletAddress ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Connected</div>
                <div className="text-xs font-mono text-primary truncate">{truncateAddress(walletAddress)}</div>
                <button
                  onClick={disconnect}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  <LogOut className="w-3 h-3" /> Disconnect
                </button>
              </div>
            ) : (
              <Button size="sm" className="w-full text-xs" onClick={handleConnectClick} disabled={isConnecting}>
                {isConnecting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                Connect Wallet
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
              {navItems.find(n => n.href === location)?.label || "Dashboard"}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {stats && walletAddress && (
              <div className="hidden md:flex items-center gap-4 text-sm">
                <span className="text-muted-foreground">Balance:</span>
                <span className="font-mono text-foreground font-semibold">
                  {stats.totalBalanceSol?.toFixed(4) ?? "0.0000"} SOL
                </span>
                <span className="text-muted-foreground/60">
                  ${stats.totalBalanceUsd?.toFixed(2) ?? "0.00"}
                </span>
              </div>
            )}
            {walletAddress ? (
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-mono cursor-pointer hover:bg-accent transition-colors"
                onClick={disconnect}
                data-testid="wallet-address-display"
                title="Click to disconnect"
              >
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                {truncateAddress(walletAddress)}
              </div>
            ) : (
              <Button
                size="sm"
                onClick={handleConnectClick}
                disabled={isConnecting}
                data-testid="connect-wallet-button"
              >
                {isConnecting
                  ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Connecting...</>
                  : hasPhantom
                    ? "Connect Phantom"
                    : "Connect Wallet"
                }
              </Button>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

      {/* Manual address fallback dialog (shown only when Phantom is not installed) */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Wallet</DialogTitle>
            <DialogDescription>
              Phantom wallet extension not detected. Install Phantom for one-click connect, or enter your Solana address manually.
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
                  <p className="text-sm font-medium">Install Phantom</p>
                  <p className="text-xs text-muted-foreground">phantom.app</p>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">→</span>
            </a>
            <div className="relative flex items-center gap-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground px-2">or enter manually</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <Input
              placeholder="Your Solana wallet address..."
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleManualConnect()}
              data-testid="input-wallet-address"
              className="font-mono text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>Cancel</Button>
            <Button
              onClick={handleManualConnect}
              disabled={inputAddress.trim().length < 32}
              data-testid="button-connect-confirm"
            >
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
