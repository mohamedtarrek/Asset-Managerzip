import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletProvider } from "@/lib/wallet-context";
import { I18nProvider } from "@/lib/i18n";
import Layout from "@/components/layout";
import DashboardPage from "@/pages/dashboard";
import LaunchPage from "@/pages/launch";
import BundlesPage from "@/pages/bundles";
import WalletsPage from "@/pages/wallets";
import BumpBotPage from "@/pages/bump-bot";
import SettingsPage from "@/pages/settings";
import PortfolioPage from "@/pages/portfolio";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
      <Route path="/dashboard">
        <Layout>
          <DashboardPage />
        </Layout>
      </Route>
      <Route path="/launch">
        <Layout>
          <LaunchPage />
        </Layout>
      </Route>
      <Route path="/bundles">
        <Layout>
          <BundlesPage />
        </Layout>
      </Route>
      <Route path="/wallets">
        <Layout>
          <WalletsPage />
        </Layout>
      </Route>
      <Route path="/bump-bot">
        <Layout>
          <BumpBotPage />
        </Layout>
      </Route>
      <Route path="/settings">
        <Layout>
          <SettingsPage />
        </Layout>
      </Route>
      <Route path="/portfolio">
        <Layout>
          <PortfolioPage />
        </Layout>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <I18nProvider>
          <WalletProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </WalletProvider>
        </I18nProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
