import { Router } from "express";
import type { IRouter } from "express";
import { eq, and, ilike, sql } from "drizzle-orm";
import { db, bundlesTable, activityTable } from "@workspace/db";
import {
  ListBundlesQueryParams,
  CreateBundleBody,
  CreateVampBundleBody,
  GetBundleStatsQueryParams,
  GetBundleParams,
  DeleteBundleParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /bundles
router.get("/bundles", async (req, res): Promise<void> => {
  const parsed = ListBundlesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const conditions: ReturnType<typeof eq>[] = [];
  if (parsed.data.ownerAddress) conditions.push(eq(bundlesTable.ownerAddress, parsed.data.ownerAddress));
  if (parsed.data.status) conditions.push(eq(bundlesTable.status, parsed.data.status));

  let query = db.select().from(bundlesTable);
  const bundles = await (conditions.length > 0 ? query.where(and(...conditions)) : query).orderBy(sql`${bundlesTable.createdAt} desc`);

  let result = bundles;
  if (parsed.data.search) {
    const s = parsed.data.search.toLowerCase();
    result = bundles.filter(b =>
      b.tokenName.toLowerCase().includes(s) ||
      b.tokenSymbol.toLowerCase().includes(s) ||
      (b.tokenAddress ?? "").toLowerCase().includes(s)
    );
  }

  res.json(result);
});

// POST /bundles
router.post("/bundles", async (req, res): Promise<void> => {
  const parsed = CreateBundleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const tokenAddress = Array.from({ length: 44 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const totalSolSpent = (parsed.data.solPerWallet ?? 0.1) * parsed.data.walletCount;

  const [bundle] = await db.insert(bundlesTable).values({
    ownerAddress: parsed.data.ownerAddress,
    tokenName: parsed.data.tokenName,
    tokenSymbol: parsed.data.tokenSymbol,
    tokenDescription: parsed.data.tokenDescription ?? null,
    tokenImageUrl: parsed.data.tokenImageUrl ?? null,
    walletCount: parsed.data.walletCount,
    solPerWallet: parsed.data.solPerWallet ?? 0.1,
    totalSolSpent,
    status: "active",
    launchType: "bundle",
    tokenAddress,
  }).returning();

  await db.insert(activityTable).values({
    ownerAddress: parsed.data.ownerAddress,
    type: "bundle_launch",
    description: `Launched ${parsed.data.tokenName} with ${parsed.data.walletCount} wallets`,
    tokenName: parsed.data.tokenName,
    tokenSymbol: parsed.data.tokenSymbol,
    amount: totalSolSpent,
  });

  res.status(201).json(bundle);
});

// POST /bundles/vamp
router.post("/bundles/vamp", async (req, res): Promise<void> => {
  const parsed = CreateVampBundleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const tokenAddress = Array.from({ length: 44 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const totalSolSpent = (parsed.data.solPerWallet ?? 0.1) * parsed.data.walletCount;

  const [bundle] = await db.insert(bundlesTable).values({
    ownerAddress: parsed.data.ownerAddress,
    tokenName: "VAMP Copy",
    tokenSymbol: "VAMP",
    walletCount: parsed.data.walletCount,
    solPerWallet: parsed.data.solPerWallet ?? 0.1,
    totalSolSpent,
    status: "active",
    launchType: "vamp",
    tokenAddress,
  }).returning();

  await db.insert(activityTable).values({
    ownerAddress: parsed.data.ownerAddress,
    type: "vamp_launch",
    description: `VAMP launched from ${parsed.data.sourceTokenAddress.slice(0, 8)}... with ${parsed.data.walletCount} wallets`,
    amount: totalSolSpent,
  });

  res.status(201).json(bundle);
});

// GET /bundles/stats
router.get("/bundles/stats", async (req, res): Promise<void> => {
  const parsed = GetBundleStatsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const conditions = parsed.data.ownerAddress ? [eq(bundlesTable.ownerAddress, parsed.data.ownerAddress)] : [];
  const bundles = await db.select().from(bundlesTable).where(conditions.length ? and(...conditions) : undefined);

  const totalLaunches = bundles.length;
  const totalSolSpent = bundles.reduce((s, b) => s + (b.totalSolSpent ?? 0), 0);
  const performances = bundles.filter(b => b.performanceUsd != null).map(b => b.performanceUsd!);
  const bestLaunchUsd = performances.length ? Math.max(...performances) : 0;
  const bestLaunchSol = bundles.filter(b => b.performanceSol != null).reduce((m, b) => Math.max(m, b.performanceSol!), 0);
  const successRate = totalLaunches ? (bundles.filter(b => b.status === "active" || b.status === "completed").length / totalLaunches) * 100 : 0;
  const avgWalletsPerBundle = totalLaunches ? bundles.reduce((s, b) => s + b.walletCount, 0) / totalLaunches : 0;

  res.json({ totalLaunches, bestLaunchUsd, bestLaunchSol, totalSolSpent, successRate, avgWalletsPerBundle });
});

// GET /bundles/:id
router.get("/bundles/:id", async (req, res): Promise<void> => {
  const params = GetBundleParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bundle] = await db.select().from(bundlesTable).where(eq(bundlesTable.id, params.data.id));
  if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }
  res.json(bundle);
});

// DELETE /bundles/:id
router.delete("/bundles/:id", async (req, res): Promise<void> => {
  const params = DeleteBundleParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bundle] = await db.delete(bundlesTable).where(eq(bundlesTable.id, params.data.id)).returning();
  if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }
  res.sendStatus(204);
});

export default router;
