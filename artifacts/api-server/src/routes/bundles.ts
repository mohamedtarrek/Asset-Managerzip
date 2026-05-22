import { Router } from "express";
import type { IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, bundlesTable, activityTable, walletsTable, settingsTable, bundleWalletsTable } from "@workspace/db";
import { Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, createTransferInstruction } from "@solana/spl-token";
import { getPumpFunSDK, keypairFromEncrypted, urlToBlob, lamportsToBigInt, airdropIfDevnet, getConnection } from "../lib/solana.js";
import { launchDevnetBundle } from "../lib/devnet-launch.js";
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

async function saveBundleWallets(bundleId: number, wallets: { publicKey: string }[], creatorIndex = 0) {
  await db.insert(bundleWalletsTable).values(
    wallets.map((w, i) => ({
      bundleId,
      walletPublicKey: w.publicKey,
      isCreator: i === creatorIndex,
    }))
  );
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

// GET /bundles/:id/wallets — list wallets that participated in a bundle
router.get("/bundles/:id/wallets", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid bundle id" }); return; }
  const rows = await db.select().from(bundleWalletsTable).where(eq(bundleWalletsTable.bundleId, id));
  res.json(rows);
});

// POST /bundles — real Pump.Fun token creation with bundle buys
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
  const isDevnet = !!(rpcEndpoint?.includes("devnet"));
  const network = isDevnet ? "devnet" : "mainnet";
  const sdk = getPumpFunSDK(rpcEndpoint);
  const creatorWallet = wallets[0];
  const bundleWallets = wallets.slice(1);

  const creatorKeypair = keypairFromEncrypted(creatorWallet.encryptedPrivateKey);
  const mintKeypair = Keypair.generate();
  const sol = solPerWallet ?? 0.1;
  const buyAmountLamports = lamportsToBigInt(sol);

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
    network,
    tokenAddress: mintKeypair.publicKey.toString(),
  }).returning();

  await saveBundleWallets(bundle.id, wallets, 0);

  res.status(201).json(bundle);

  (async () => {
    try {
      if (isDevnet) {
        await airdropIfDevnet(rpcEndpoint, [creatorKeypair.publicKey, ...bundleWallets.map(w => { try { return keypairFromEncrypted(w.encryptedPrivateKey).publicKey; } catch { return creatorKeypair.publicKey; } })]);

        const devnetLog = (msg: string) => req.log?.info(msg);
        const result = await launchDevnetBundle({
          rpcEndpoint: rpcEndpoint ?? "https://api.devnet.solana.com",
          creatorKeypair,
          mintKeypair,
          tokenName,
          tokenSymbol,
          bundleWallets,
          solPerWallet: sol,
          log: devnetLog,
        });

        const primaryTx = result.txHashes[0] ?? "";
        await db.update(bundlesTable).set({
          status: "active",
          txHash: primaryTx,
          tokenAddress: result.mintAddress,
          poolId: result.poolId || null,
          marketId: result.marketId || null,
        }).where(eq(bundlesTable.id, bundle.id));

        const poolNote = result.poolId ? ` | Pool: ${result.poolId.slice(0, 8)}...` : "";
        await db.insert(activityTable).values({
          ownerAddress,
          type: "bundle_launch",
          description: `[DEVNET] Launched ${tokenName} (${tokenSymbol}) — SPL mint + Raydium pool with ${walletCount} wallets${poolNote}`,
          tokenName,
          tokenSymbol,
          amount: sol * walletCount,
          txHash: primaryTx,
        });
        return;
      }

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
  } catch { }

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
  const isDevnet = !!(vampRpc?.includes("devnet"));
  const network = isDevnet ? "devnet" : "mainnet";
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
    network,
    tokenAddress: mintKeypair.publicKey.toString(),
  }).returning();

  await saveBundleWallets(bundle.id, wallets, 0);

  res.status(201).json(bundle);

  (async () => {
    try {
      if (isDevnet) {
        const vampCreatorKeypair = keypairFromEncrypted(wallets[0].encryptedPrivateKey);
        const allWalletKeys = wallets.map(w => { try { return keypairFromEncrypted(w.encryptedPrivateKey).publicKey; } catch { return vampCreatorKeypair.publicKey; } });
        await airdropIfDevnet(vampRpc, allWalletKeys);

        const vampDevnetLog = (msg: string) => req.log?.info(msg);
        const vampResult = await launchDevnetBundle({
          rpcEndpoint: vampRpc ?? "https://api.devnet.solana.com",
          creatorKeypair: vampCreatorKeypair,
          mintKeypair,
          tokenName,
          tokenSymbol,
          bundleWallets: wallets.slice(1),
          solPerWallet: sol,
          log: vampDevnetLog,
        });

        const vampPrimaryTx = vampResult.txHashes[0] ?? "";
        await db.update(bundlesTable).set({
          status: "active",
          txHash: vampPrimaryTx,
          tokenAddress: vampResult.mintAddress,
          poolId: vampResult.poolId || null,
          marketId: vampResult.marketId || null,
        }).where(eq(bundlesTable.id, bundle.id));

        const vampPoolNote = vampResult.poolId ? ` | Pool: ${vampResult.poolId.slice(0, 8)}...` : "";
        await db.insert(activityTable).values({
          ownerAddress,
          type: "vamp_launch",
          description: `[DEVNET] VAMP'd ${tokenName} (${tokenSymbol}) from ${sourceTokenAddress.slice(0, 8)}... — SPL mint + Raydium pool${vampPoolNote}`,
          tokenName,
          tokenSymbol,
          amount: sol * walletCount,
          txHash: vampPrimaryTx,
        });
        return;
      }

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
        } catch { }
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

// POST /bundles/:id/sell — sell tokens from bundle wallets and send SOL to recipient
router.post("/bundles/:id/sell", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid bundle id" }); return; }

  const { recipientAddress, walletPublicKey, rpcEndpoint: bodyRpc } = req.body as {
    recipientAddress: string;
    walletPublicKey?: string;
    rpcEndpoint?: string;
  };
  if (!recipientAddress || typeof recipientAddress !== "string" || recipientAddress.length < 32) {
    res.status(400).json({ error: "recipientAddress is required" });
    return;
  }

  const [bundle] = await db.select().from(bundlesTable).where(eq(bundlesTable.id, id));
  if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }
  if (!bundle.tokenAddress) { res.status(400).json({ error: "Bundle has no token address" }); return; }

  const settingsRpc = await getRpcForOwner(bundle.ownerAddress);
  const rpcEndpoint = bodyRpc ?? settingsRpc ?? (bundle.network === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");
  const connection = getConnection(rpcEndpoint);
  const mintPubkey = new PublicKey(bundle.tokenAddress);
  const recipientPubkey = new PublicKey(recipientAddress);
  const isDevnet = bundle.network === "devnet";

  let bundleWalletRows = await db.select().from(bundleWalletsTable).where(eq(bundleWalletsTable.bundleId, id));
  const creatorRow = bundleWalletRows.find(w => w.isCreator);

  if (walletPublicKey) {
    bundleWalletRows = bundleWalletRows.filter(w => w.walletPublicKey === walletPublicKey && !w.isCreator);
  } else {
    bundleWalletRows = bundleWalletRows.filter(w => !w.isCreator && !w.soldAt);
  }

  if (bundleWalletRows.length === 0) {
    res.status(400).json({ error: "No unsold bundle wallets found" });
    return;
  }

  const sold: { walletPublicKey: string; solAmount: number; txHash: string }[] = [];
  const failed: { walletPublicKey: string; error: string }[] = [];

  const sdk = isDevnet ? null : getPumpFunSDK(rpcEndpoint);

  for (const bw of bundleWalletRows) {
    try {
      const walletRow = await db.select().from(walletsTable).where(eq(walletsTable.publicKey, bw.walletPublicKey)).limit(1);
      if (!walletRow[0]) { failed.push({ walletPublicKey: bw.walletPublicKey, error: "Wallet not found in DB" }); continue; }

      const walletKeypair = keypairFromEncrypted(walletRow[0].encryptedPrivateKey);

      if (isDevnet) {
        // Devnet: transfer tokens back to creator, sweep SOL to recipient
        let tokenBalance = 0n;
        try {
          const ata = getAssociatedTokenAddressSync(mintPubkey, walletKeypair.publicKey);
          const account = await getAccount(connection, ata);
          tokenBalance = account.amount;
        } catch { }

        if (tokenBalance > 0n && creatorRow) {
          try {
            const bundleAta = getAssociatedTokenAddressSync(mintPubkey, walletKeypair.publicKey);
            const creatorAta = getAssociatedTokenAddressSync(mintPubkey, new PublicKey(creatorRow.walletPublicKey));
            await sendAndConfirmTransaction(
              connection,
              new Transaction().add(
                createTransferInstruction(bundleAta, creatorAta, walletKeypair.publicKey, tokenBalance)
              ),
              [walletKeypair],
              { commitment: "confirmed" }
            );
          } catch (err) {
            req.log?.warn({ err }, "Token return failed, continuing SOL sweep");
          }
        }

        const solBalance = await connection.getBalance(walletKeypair.publicKey);
        const sweepLamports = solBalance - 5_000;
        if (sweepLamports <= 0) {
          await db.update(bundleWalletsTable).set({ soldAt: new Date() }).where(eq(bundleWalletsTable.id, bw.id));
          sold.push({ walletPublicKey: bw.walletPublicKey, solAmount: 0, txHash: "" });
          continue;
        }

        const sig = await sendAndConfirmTransaction(
          connection,
          new Transaction().add(SystemProgram.transfer({
            fromPubkey: walletKeypair.publicKey,
            toPubkey: recipientPubkey,
            lamports: sweepLamports,
          })),
          [walletKeypair],
          { commitment: "confirmed" }
        );
        await db.update(bundleWalletsTable).set({ soldAt: new Date() }).where(eq(bundleWalletsTable.id, bw.id));
        sold.push({ walletPublicKey: bw.walletPublicKey, solAmount: sweepLamports / LAMPORTS_PER_SOL, txHash: sig });

      } else {
        // Mainnet: Pump.Fun sell
        let tokenBalance = 0n;
        try {
          const ata = getAssociatedTokenAddressSync(mintPubkey, walletKeypair.publicKey);
          const account = await getAccount(connection, ata);
          tokenBalance = account.amount;
        } catch { }

        if (tokenBalance > 0n && sdk) {
          const sellResult = await sdk.sell(walletKeypair, mintPubkey, tokenBalance, SLIPPAGE_BASIS_POINTS, PRIORITY_FEES);
          if (!sellResult.success) throw new Error("Pump.Fun sell failed");
        }

        const solBalance = await connection.getBalance(walletKeypair.publicKey);
        const sweepLamports = solBalance - 5_000;
        let sweepSig = "";
        if (sweepLamports > 0) {
          sweepSig = await sendAndConfirmTransaction(
            connection,
            new Transaction().add(SystemProgram.transfer({
              fromPubkey: walletKeypair.publicKey,
              toPubkey: recipientPubkey,
              lamports: sweepLamports,
            })),
            [walletKeypair],
            { commitment: "confirmed" }
          );
        }

        await db.update(bundleWalletsTable).set({ soldAt: new Date() }).where(eq(bundleWalletsTable.id, bw.id));
        sold.push({ walletPublicKey: bw.walletPublicKey, solAmount: sweepLamports / LAMPORTS_PER_SOL, txHash: sweepSig });
      }
    } catch (err) {
      failed.push({ walletPublicKey: bw.walletPublicKey, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const allSold = await db.select().from(bundleWalletsTable)
    .where(and(eq(bundleWalletsTable.bundleId, id), eq(bundleWalletsTable.isCreator, false)));
  if (allSold.every(w => w.soldAt)) {
    await db.update(bundlesTable).set({ status: "completed" }).where(eq(bundlesTable.id, id));
  }

  const totalSol = sold.reduce((s, w) => s + w.solAmount, 0);
  if (sold.length > 0) {
    await db.insert(activityTable).values({
      ownerAddress: bundle.ownerAddress,
      type: "sell",
      description: `Sold ${sold.length} wallet(s) from ${bundle.tokenName} (${bundle.tokenSymbol}) — ${totalSol.toFixed(4)} SOL returned to ${recipientAddress.slice(0, 8)}...`,
      tokenName: bundle.tokenName,
      tokenSymbol: bundle.tokenSymbol,
      amount: totalSol,
    });
  }

  res.json({ sold, failed });
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
