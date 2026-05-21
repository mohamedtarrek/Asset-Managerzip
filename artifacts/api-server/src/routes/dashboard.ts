import { Router } from "express";
import type { IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, walletsTable, bundlesTable, botsTable, activityTable, settingsTable } from "@workspace/db";
import {
  GetDashboardStatsQueryParams,
  GetDashboardActivityQueryParams,
  GetSettingsQueryParams,
  UpdateSettingsBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /dashboard/stats
router.get("/dashboard/stats", async (req, res): Promise<void> => {
  const parsed = GetDashboardStatsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const walletAddress = parsed.data.walletAddress;
  const conditions = walletAddress ? [eq(walletsTable.ownerAddress, walletAddress)] : [];
  const bundleConditions = walletAddress ? [eq(bundlesTable.ownerAddress, walletAddress)] : [];
  const botConditions = walletAddress ? [eq(botsTable.ownerAddress, walletAddress)] : [];

  const [wallets, bundles, bots] = await Promise.all([
    db.select().from(walletsTable).where(conditions.length ? and(...conditions) : undefined),
    db.select().from(bundlesTable).where(bundleConditions.length ? and(...bundleConditions) : undefined),
    db.select().from(botsTable).where(botConditions.length ? and(...botConditions) : undefined),
  ]);

  const totalBalanceSol = wallets.reduce((s, w) => s + (w.balanceSol ?? 0), 0);
  const totalBalanceUsd = totalBalanceSol * 142.8;
  const bundlesLaunched = bundles.length;
  const activeBots = bots.filter(b => b.status === "running").length;
  const totalWallets = wallets.length;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayBundles = bundles.filter(b => new Date(b.createdAt) >= todayStart);
  const earningsToday = todayBundles.reduce((s, b) => s + (b.performanceUsd ?? 0), 0);
  const earningsLast30Days = bundles.reduce((s, b) => s + (b.performanceUsd ?? 0), 0);
  const pnl = bundlesLaunched > 0 ? (earningsLast30Days / (bundles.reduce((s, b) => s + (b.totalSolSpent ?? 0), 0) * 142.8 || 1)) * 100 : 0;

  res.json({
    earningsToday,
    earningsLast30Days,
    bundlesLaunched,
    totalBalanceSol,
    totalBalanceUsd,
    pnl: Math.round(pnl * 100) / 100,
    activeBots,
    totalWallets,
  });
});

// GET /dashboard/activity
router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const parsed = GetDashboardActivityQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const walletAddress = parsed.data.walletAddress;
  const conditions = walletAddress ? [eq(activityTable.ownerAddress, walletAddress)] : [];
  const limit = parsed.data.limit ?? 20;

  const activity = await db
    .select()
    .from(activityTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(activityTable.createdAt))
    .limit(limit);

  res.json(activity.map(a => ({
    id: a.id,
    type: a.type,
    description: a.description,
    timestamp: a.createdAt.toISOString(),
    tokenName: a.tokenName,
    tokenSymbol: a.tokenSymbol,
    amount: a.amount,
    txHash: a.txHash,
    walletAddress: a.walletAddress,
  })));
});

// GET /settings
router.get("/settings", async (req, res): Promise<void> => {
  const parsed = GetSettingsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const walletAddress = parsed.data.walletAddress;
  if (!walletAddress) {
    res.json({ walletAddress: "", defaultWalletCount: 10, defaultSolPerWallet: 0.1, autoApprove: false, darkMode: true, notificationsEnabled: true, rpcEndpoint: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return;
  }

  let [settings] = await db.select().from(settingsTable).where(eq(settingsTable.walletAddress, walletAddress));
  if (!settings) {
    [settings] = await db.insert(settingsTable).values({ walletAddress }).returning();
  }

  res.json({ ...settings, createdAt: settings.createdAt.toISOString(), updatedAt: settings.updatedAt.toISOString() });
});

// PATCH /settings
router.patch("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const walletAddress = parsed.data.walletAddress;
  if (!walletAddress) { res.status(400).json({ error: "walletAddress required" }); return; }

  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.walletAddress, walletAddress));
  let settings;
  if (existing) {
    [settings] = await db.update(settingsTable).set(parsed.data).where(eq(settingsTable.walletAddress, walletAddress)).returning();
  } else {
    [settings] = await db.insert(settingsTable).values({ walletAddress, ...parsed.data }).returning();
  }

  res.json({ ...settings, createdAt: settings.createdAt.toISOString(), updatedAt: settings.updatedAt.toISOString() });
});

export default router;
