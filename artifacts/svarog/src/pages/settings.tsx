import { useState, useEffect } from "react";
import { Settings, User, Bell, Zap, Activity, Save, Loader2 } from "lucide-react";
import { useWallet } from "@/lib/wallet-context";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-border/50 last:border-0">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const { walletAddress } = useWallet();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useGetSettings(
    { walletAddress: walletAddress ?? undefined },
    { query: { enabled: !!walletAddress, queryKey: getGetSettingsQueryKey({ walletAddress: walletAddress ?? undefined }) } }
  );
  const updateSettings = useUpdateSettings();

  const [form, setForm] = useState({
    defaultWalletCount: 10,
    defaultSolPerWallet: 0.1,
    autoApprove: false,
    darkMode: true,
    notificationsEnabled: true,
    rpcEndpoint: "",
  });

  useEffect(() => {
    if (settings) {
      setForm({
        defaultWalletCount: settings.defaultWalletCount ?? 10,
        defaultSolPerWallet: settings.defaultSolPerWallet ?? 0.1,
        autoApprove: settings.autoApprove ?? false,
        darkMode: settings.darkMode ?? true,
        notificationsEnabled: settings.notificationsEnabled ?? true,
        rpcEndpoint: settings.rpcEndpoint ?? "",
      });
    }
  }, [settings]);

  const handleSave = () => {
    if (!walletAddress) { toast({ title: "Connect wallet first", variant: "destructive" }); return; }
    updateSettings.mutate(
      { data: { walletAddress, ...form, rpcEndpoint: form.rpcEndpoint || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Settings saved" });
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
      }
    );
  };

  if (!walletAddress) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">Configure your preferences</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Settings className="w-14 h-14 text-muted-foreground/20 mb-4" />
            <h3 className="text-base font-semibold mb-1">Connect your wallet</h3>
            <p className="text-sm text-muted-foreground">Connect a wallet to manage your settings</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">Configure your platform preferences</p>
        </div>
        <Button onClick={handleSave} disabled={updateSettings.isPending} data-testid="button-save-settings">
          {updateSettings.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save Changes
        </Button>
      </div>

      <Tabs defaultValue="account">
        <TabsList className="mb-6">
          <TabsTrigger value="account" data-testid="tab-account"><User className="w-3.5 h-3.5 mr-1.5" /> Account</TabsTrigger>
          <TabsTrigger value="general" data-testid="tab-general"><Settings className="w-3.5 h-3.5 mr-1.5" /> General</TabsTrigger>
          <TabsTrigger value="quick-actions" data-testid="tab-quick-actions"><Zap className="w-3.5 h-3.5 mr-1.5" /> Quick Actions</TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity"><Activity className="w-3.5 h-3.5 mr-1.5" /> Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Account Settings</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : (
                <div>
                  <SettingRow label="Connected Wallet" description="Your primary identity on the platform">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-400" />
                      <code className="text-xs bg-card border border-border rounded px-2 py-1">{walletAddress.slice(0, 6)}...{walletAddress.slice(-8)}</code>
                    </div>
                  </SettingRow>
                  <SettingRow label="Default Launch Wallets" description="Number of bundled wallets for new launches">
                    <Input type="number" min="1" max="50" className="w-24 text-right" value={form.defaultWalletCount} onChange={e => setForm(p => ({ ...p, defaultWalletCount: parseInt(e.target.value) || 5 }))} data-testid="input-default-wallet-count" />
                  </SettingRow>
                  <SettingRow label="Default SOL per Wallet" description="Default SOL amount distributed to each bundled wallet">
                    <Input type="number" step="0.01" min="0.01" className="w-28 text-right" value={form.defaultSolPerWallet} onChange={e => setForm(p => ({ ...p, defaultSolPerWallet: parseFloat(e.target.value) || 0.1 }))} data-testid="input-default-sol-per-wallet" />
                  </SettingRow>
                  <SettingRow label="Auto-Approve Transactions" description="Automatically sign transactions without confirmation prompts">
                    <Switch checked={form.autoApprove} onCheckedChange={v => setForm(p => ({ ...p, autoApprove: v }))} data-testid="switch-auto-approve" />
                  </SettingRow>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="general">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">General Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <SettingRow label="Dark Mode" description="Use dark theme (recommended for trading)">
                <Switch checked={form.darkMode} onCheckedChange={v => setForm(p => ({ ...p, darkMode: v }))} data-testid="switch-dark-mode" />
              </SettingRow>
              <SettingRow label="Notifications" description="Receive alerts for bundle launches, bot events, and transaction confirmations">
                <Switch checked={form.notificationsEnabled} onCheckedChange={v => setForm(p => ({ ...p, notificationsEnabled: v }))} data-testid="switch-notifications" />
              </SettingRow>
              <SettingRow label="Custom RPC Endpoint" description="Use your own Solana RPC (leave blank to use default devnet)">
                <Input placeholder="https://your-rpc..." className="w-64" value={form.rpcEndpoint} onChange={e => setForm(p => ({ ...p, rpcEndpoint: e.target.value }))} data-testid="input-rpc-endpoint" />
              </SettingRow>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quick-actions">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { label: "Repeat Last Launch", description: "Re-use settings from your most recent bundle", badge: "Coming Soon" },
                  { label: "Emergency Stop All Bots", description: "Immediately stop all running bump bots" },
                  { label: "Export Wallets", description: "Download all wallet public keys as CSV" },
                  { label: "Clear Activity Log", description: "Remove all activity history" },
                ].map(({ label, description, badge }) => (
                  <div key={label} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/30">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{label}</p>
                        {badge && <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-400/30">{badge}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{description}</p>
                    </div>
                    <Button variant="outline" size="sm" disabled={!!badge} data-testid={`button-action-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                      Run
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Activity Log</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Activity className="w-12 h-12 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">Your full activity log is on the Dashboard</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
