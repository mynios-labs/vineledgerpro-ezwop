import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import NotFound from "@/pages/not-found";
import Inventory from "@/pages/inventory";
import ImportPage from "@/pages/import";
import ConflictsPage from "@/pages/conflicts";
import ManagePage from "@/pages/manage";
import ImportDetailsPage from "@/pages/import-details";
import DraftPage from "@/pages/draft";
import ListingsPage from "@/pages/listings";
import OrdersPage from "@/pages/orders";
import MessagesPage from "@/pages/messages";
import MoneyPage from "@/pages/money";
import HealthPage from "@/pages/health";
import TaxReport from "@/pages/tax-report";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Inventory} />
      <Route path="/import" component={ImportPage} />
      <Route path="/conflicts" component={ConflictsPage} />
      <Route path="/manage" component={ManagePage} />
      <Route path="/manage/:importId" component={ImportDetailsPage} />
      <Route path="/draft" component={DraftPage} />
      <Route path="/listings" component={ListingsPage} />
      <Route path="/orders" component={OrdersPage} />
      <Route path="/messages" component={MessagesPage} />
      <Route path="/money" component={MoneyPage} />
      <Route path="/tax-report" component={TaxReport} />
      <Route path="/health" component={HealthPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full">
            <AppSidebar />
            <div className="flex flex-col flex-1 min-w-0">
              <header className="flex items-center justify-between gap-4 p-4 border-b bg-background sticky top-0 z-10">
                <div className="flex items-center gap-4">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                      <span className="text-primary-foreground font-bold text-sm">VR</span>
                    </div>
                    <h1 className="text-lg font-semibold hidden sm:block">Vine Resale</h1>
                  </div>
                </div>
                <ThemeToggle />
              </header>
              <main className="flex-1">
                <Router />
              </main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
