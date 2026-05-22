import { Router } from "express";
import type { IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, bundlesTable, activityTable, walletsTable, settingsTable } from "@workspace/db";
import { Keypair } from "@solana/web3.js";
import { getPumpFunSDK, keypairFromEncrypted, urlToBlob, lamportsToBigInt } from "../lib/solana.js";
import {
  ListBundlesQueryParams,
  CreateBundleBody,
  CreateVampBundleBody,
  GetBundleStatsQueryParams,
  GetBundleParams,
  DeleteBundleParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const PRIORITY_FEES = { unitLimit: 250_000, unitPrice: 250_000 };
const SLIPPAGE_BASIS_POINTS = 500n;

async function getRpcForOwner(ownerAddress: string): Promise<string | null> {
  try {
    const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.walletAddress, ownerAddress));
    return settings?.rpcEndpoint ?? null;
  } catch { return null; }
}

async function getOwnerWallets(ownerAddress: string, count: number) {
  const wallets = await db.select().from(walletsTable)
    .where(and(eq(walletsTable.ownerAddress, ownerAddress), eq(walletsTable.isActive, true)))
    .limit(count);
  if (wallets.length < count) throw new Error(`Not enough wallets stored. Need ${count}, have ${wallets.length}. Generate more wallets first.`);
  return wallets;
}

// GET /bundles
router.get("/bundles", async (req, res): Promise<void> => {
  const parsed = ListBundlesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const conditions: ReturnType<typeof eq>[] = [];
  if (parsed.data.ownerAddress) conditions.push(eq(bundlesTable.ownerAddress, parsed.data.ownerAddress));
  if (parsed.data.status) conditions.push(eq(bundlesTable.status, parsed.data.status));

  const q = db.select().from(bundlesTable);
  let bundles = await (conditions.length > 0 ? q.where(and(...conditions)) : q).orderBy(sql`${bundlesTable.createdAt} desc`);

  if (parsed.data.search) {
    const s = parsed.data.search.toLowerCase();
    bundles = bundles.filter(b =>
      b.tokenName.toLowerCase().includes(s) ||
      b.tokenSymbol.toLowerCase().includes(s) ||
      (b.tokenAddress ?? "").toLowerCase().includes(s)
    );
  }

  res.json(bundles);
});

// POST /bundles — REAL Pump.Fun token creation with bundle buys
router.post("/bundles", async (req, res): Promise<void> => {
  const parsed = CreateBundleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { ownerAddress, tokenName, tokenSymbol, tokenDescription, tokenImageUrl, walletCount, solPerWallet, rpcEndpoint: requestRpc } = parsed.data;

  if (!tokenImageUrl) {
    res.status(400).json({ error: "Token image URL is required for Pump.Fun launch" });
    return;
  }

  let wallets: Awaited<ReturnType<typeof getOwnerWallets>>;
  try {
    wallets = await getOwnerWallets(ownerAddress, walletCount);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Not enough wallets" });
    return;
  }

  const settingsRpc = await getRpcForOwner(ownerAddress);
  const rpcEndpoint = requestRpc ?? settingsRpc;
  const sdk = getPumpFunSDK(rpcEndpoint);
  const creatorWallet = wallets[0];
  const bundleWallets = wallets.slice(1);

  const creatorKeypair = keypairFromEncrypted(creatorWallet.encryptedPrivateKey);
  const mintKeypair = Keypair.generate();
  const sol = solPerWallet ?? 0.1;
  const buyAmountLamports = lamportsToBigInt(sol);

  // Record bundle as pending
  const [bundle] = await db.insert(bundlesTable).values({
    ownerAddress,
    tokenName,
    tokenSymbol,
    tokenDescription: tokenDescription ?? null,
    tokenImageUrl,
    walletCount,
    solPerWallet: sol,
    totalSolSpent: sol * walletCount,
    status: "pending",
    launchType: "bundle",
    tokenAddress: mintKeypair.publicKey.toString(),
  }).returning();

  // Respond immediately so UI doesn't hang
  res.status(201).json(bundle);

  // Execute asynchronously
  (async () => {
    try {
      const isDevnet = !!(rpcEndpoint?.includes("devnet"));

      if (isDevnet) {
        // Pump.fun is mainnet-only — simulate the launch on devnet
        await new Promise((r) => setTimeout(r, 1000 + walletCount * 150));
        const mockSig = `devnet_sim_${mintKeypair.publicKey.toString().slice(0, 12)}_${Date.now()}`;
        await db.update(bundlesTable).set({ status: "active", txHash: mockSig }).where(eq(bundlesTable.id, bundle.id));
        await db.insert(activityTable).values({
          ownerAddress,
          type: "bundle_launch",
          description: `[DEVNET SIM] Launched ${tokenName} (${tokenSymbol}) with ${walletCount} wallets`,
          tokenName,
          tokenSymbol,
          amount: sol * walletCount,
          txHash: mockSig,
        });
        return;
      }

      // Mainnet: real Pump.Fun launch
      const imageBlob = await urlToBlob(tokenImageUrl);

      const createResult = await sdk.createAndBuy(
        creatorKeypair,
        mintKeypair,
        { name: tokenName, symbol: tokenSymbol, description: tokenDescription ?? "", file: imageBlob },
        buyAmountLamports,
        SLIPPAGE_BASIS_POINTS,
        PRIORITY_FEES
      );

      if (!createResult.success) {
        const sdkErr = (createResult as any).error;
        const msg = sdkErr instanceof Error ? sdkErr.message : (typeof sdkErr === "string" ? sdkErr : "createAndBuy failed");
        throw new Error(msg);
      }

      // Bundle wallet buys (sequential — for true Jito atomicity, upgrade to Jito bundle API)
      const signatures: string[] = [createResult.signature ?? ""];
      for (const w of bundleWallets) {
        try {
          const buyerKeypair = keypairFromEncrypted(w.encryptedPrivateKey);
          const buyResult = await sdk.buy(buyerKeypair, mintKeypair.publicKey, buyAmountLamports, SLIPPAGE_BASIS_POINTS, PRIORITY_FEES);
          if (buyResult.signature) signatures.push(buyResult.signature);
        } catch (err) {
          req.log?.warn({ err, wallet: w.publicKey }, "Bundle wallet buy failed");
        }
      }

      await db.update(bundlesTable).set({
        status: "active",
        txHash: signatures[0],
      }).where(eq(bundlesTable.id, bundle.id));

      await db.insert(activityTable).values({
        ownerAddress,
        type: "bundle_launch",
        description: `Launched ${tokenName} (${tokenSymbol}) on Pump.Fun with ${walletCount} wallets`,
        tokenName,
        tokenSymbol,
        amount: sol * walletCount,
        txHash: signatures[0],
      });
    } catch (err) {
      req.log?.error({ err }, "Bundle launch failed");
      await db.update(bundlesTable).set({ status: "failed" }).where(eq(bundlesTable.id, bundle.id));
      await db.insert(activityTable).values({
        ownerAddress,
        type: "bundle_launch",
        description: `Bundle launch FAILED for ${tokenName}: ${err instanceof Error ? err.message : "unknown error"}`,
        tokenName,
        tokenSymbol,
      });
    }
  })();
});

// POST /bundles/vamp — copy existing Pump.Fun token metadata + relaunch
router.post("/bundles/vamp", async (req, res): Promise<void> => {
  const parsed = CreateVampBundleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { ownerAddress, sourceTokenAddress, walletCount, solPerWallet, rpcEndpoint: requestRpc } = parsed.data;

  // Fetch real metadata from Pump.Fun
  let tokenName = "VAMP Copy";
  let tokenSymbol = "VAMP";
  let description = "";
  let imageUrl = "";

  try {
    const metaResp = await fetch(`https://frontend-api.pump.fun/coins/${sourceTokenAddress}`);
    if (metaResp.ok) {
      const meta = await metaResp.json() as { name?: string; symbol?: string; description?: string; image_uri?: string };
      tokenName = meta.name ?? tokenName;
      tokenSymbol = meta.symbol ?? tokenSymbol;
      description = meta.description ?? "";
      imageUrl = meta.image_uri ?? "";
    }
  } catch { /* non-fatal */ }

  if (!imageUrl) {
    res.status(400).json({ error: "Could not fetch token image from Pump.Fun — provide a valid token address" });
    return;
  }

  let wallets: Awaited<ReturnType<typeof getOwnerWallets>>;
  try {
    wallets = await getOwnerWallets(ownerAddress, walletCount);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Not enough wallets" });
    return;
  }

  const settingsRpc2 = await getRpcForOwner(ownerAddress);
  const vampRpc = requestRpc ?? settingsRpc2;
  const sdk = getPumpFunSDK(vampRpc);
  const creatorKeypair = keypairFromEncrypted(wallets[0].encryptedPrivateKey);
  const mintKeypair = Keypair.generate();
  const sol = solPerWallet ?? 0.1;
  const buyAmountLamports = lamportsToBigInt(sol);

  const [bundle] = await db.insert(bundlesTable).values({
    ownerAddress,
    tokenName,
    tokenSymbol,
    tokenDescription: description,
    tokenImageUrl: imageUrl,
    walletCount,
    solPerWallet: sol,
    totalSolSpent: sol * walletCount,
    status: "pending",
    launchType: "vamp",
    tokenAddress: mintKeypair.publicKey.toString(),
  }).returning();

  res.status(201).json(bundle);

  (async () => {
    try {
      const isDevnet = !!(vampRpc?.includes("devnet"));

      if (isDevnet) {
        // Pump.fun is mainnet-only — simulate the launch on devnet
        await new Promise((r) => setTimeout(r, 1000 + walletCount * 150));
        const mockSig = `devnet_sim_${mintKeypair.publicKey.toString().slice(0, 12)}_${Date.now()}`;
        await db.update(bundlesTable).set({ status: "active", txHash: mockSig }).where(eq(bundlesTable.id, bundle.id));
        await db.insert(activityTable).values({
          ownerAddress,
          type: "vamp_launch",
          description: `[DEVNET SIM] VAMP'd ${tokenName} (${tokenSymbol}) from ${sourceTokenAddress.slice(0, 8)}... with ${walletCount} wallets`,
          tokenName,
          tokenSymbol,
          amount: sol * walletCount,
          txHash: mockSig,
        });
        return;
      }

      // Mainnet: real Pump.Fun launch
      const imageBlob = await urlToBlob(imageUrl);
      const createResult = await sdk.createAndBuy(
        creatorKeypair,
        mintKeypair,
        { name: tokenName, symbol: tokenSymbol, description, file: imageBlob },
        buyAmountLamports,
        SLIPPAGE_BASIS_POINTS,
        PRIORITY_FEES
      );

      if (!createResult.success) {
        const sdkErr = (createResult as any).error;
        const msg = sdkErr instanceof Error ? sdkErr.message : (typeof sdkErr === "string" ? sdkErr : "VAMP createAndBuy failed");
        throw new Error(msg);
      }

      for (const w of wallets.slice(1)) {
        try {
          const buyerKeypair = keypairFromEncrypted(w.encryptedPrivateKey);
          await sdk.buy(buyerKeypair, mintKeypair.publicKey, buyAmountLamports, SLIPPAGE_BASIS_POINTS, PRIORITY_FEES);
        } catch { /* non-fatal */ }
      }

      await db.update(bundlesTable).set({ status: "active", txHash: createResult.signature ?? null })
        .where(eq(bundlesTable.id, bundle.id));

      await db.insert(activityTable).values({
        ownerAddress,
        type: "vamp_launch",
        description: `VAMP'd ${tokenName} (${tokenSymbol}) from ${sourceTokenAddress.slice(0, 8)}...`,
        tokenName, tokenSymbol,
        amount: sol * walletCount,
        txHash: createResult.signature ?? null,
      });
    } catch (err) {
      await db.update(bundlesTable).set({ status: "failed" }).where(eq(bundlesTable.id, bundle.id));
    }
  })();
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
