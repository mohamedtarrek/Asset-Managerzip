import { useState, useEffect } from "react";
import { Settings, User, Bell, Zap, Activity, Save, Loader2, Github, CheckCircle, Eye, EyeOff, ExternalLink } from "lucide-react";
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
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { BASE_URL } from "@/lib/base-url";

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

function GithubTokenSection({ walletAddress }: { walletAddress: string }) {
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ["github-token-status", walletAddress],
    queryFn: async () => {
      const resp = await fetch(`${BASE_URL}api/settings/github-token/status?walletAddress=${walletAddress}`);
      return resp.json() as Promise<{ hasToken: boolean; source: string }>;
    },
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (t: string) => {
      const resp = await fetch(`${BASE_URL}api/settings/github-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, token: t }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Failed to save token");
      return data as { success: boolean; hasToken: boolean };
    },
    onSuccess: (data) => {
      refetchStatus();
      setToken("");
      toast({
        title: data.hasToken ? "GitHub token saved" : "GitHub token cleared",
        description: data.hasToken
          ? "Push to GitHub is now enabled."
          : "Token has been removed.",
      });
    },
    onError: (err) => {
      toast({ title: err instanceof Error ? err.message : "Failed to save token", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-2 border-b border-border/50">
        <Github className="w-4 h-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">GitHub Integration</p>
          <p className="text-xs text-muted-foreground">Enable "Push to GitHub" from the Dashboard</p>
        </div>
        <div className="ml-auto">
          {status?.hasToken ? (
            <Badge variant="outline" className="text-green-400 border-green-400/30 bg-green-400/5 gap-1">
              <CheckCircle className="w-3 h-3" /> Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="text-yellow-400 border-yellow-400/30 bg-yellow-400/5">
              Not configured
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">
          Personal Access Token{" "}
          <a
            href="https://github.com/settings/tokens/new?scopes=repo&description=Svarog+App"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5"
          >
            Generate one <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showToken ? "text" : "password"}
              placeholder={status?.hasToken ? "••••••••••••••• (token saved)" : "ghp_xxxxxxxxxxxxxxxxxxxx"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="pr-10 font-mono text-sm"
              autoComplete="off"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <Button
            onClick={() => saveMutation.mutate(token)}
            disabled={saveMutation.isPending || !token.trim()}
            size="sm"
            className="shrink-0"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Requires <code className="bg-muted px-1 rounded">repo</code> scope. Token is stored encrypted in your database and never exposed.
        </p>
      </div>

      {status?.hasToken && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-red-400 hover:text-red-300 hover:bg-red-400/10"
            onClick={() => saveMutation.mutate("")}
            disabled={saveMutation.isPending}
          >
            Remove token
          </Button>
        </div>
      )}
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
          <TabsTrigger value="integrations"><Github className="w-3.5 h-3.5 mr-1.5" /> Integrations</TabsTrigger>
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

        <TabsContent value="integrations">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Integrations</CardTitle>
            </CardHeader>
            <CardContent>
              <GithubTokenSection walletAddress={walletAddress} />
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
