import { Router } from "express";
import type { IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, walletsTable } from "@workspace/db";
import { generateKeypair, keypairFromEncrypted, getSolBalance, decryptSecretKey } from "../lib/solana.js";
import {
  ListWalletsQueryParams,
  CreateWalletBody,
  ImportWalletBody,
  GenerateBulkWalletsBody,
  GetWalletParams,
  UpdateWalletParams,
  UpdateWalletBody,
  DeleteWalletParams,
  GetWalletBalanceParams,
  ListWalletGroupsQueryParams,
} from "@workspace/api-zod";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { encryptSecretKey } from "../lib/solana.js";

const router: IRouter = Router();

function toWalletResponse(w: typeof walletsTable.$inferSelect) {
  const { encryptedPrivateKey: _enc, ...rest } = w;
  return rest;
}

// GET /wallets
router.get("/wallets", async (req, res): Promise<void> => {
  const parsed = ListWalletsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const conditions = [];
  if (parsed.data.ownerAddress) conditions.push(eq(walletsTable.ownerAddress, parsed.data.ownerAddress));
  if (parsed.data.group) conditions.push(eq(walletsTable.group, parsed.data.group));

  const wallets = await db.select().from(walletsTable).where(conditions.length ? and(...conditions) : undefined);
  res.json(wallets.map(toWalletResponse));
});

// POST /wallets — generate a real Solana keypair
router.post("/wallets", async (req, res): Promise<void> => {
  const parsed = CreateWalletBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { publicKey, encryptedPrivateKey } = generateKeypair();

  const [wallet] = await db.insert(walletsTable).values({
    publicKey,
    encryptedPrivateKey,
    ownerAddress: parsed.data.ownerAddress,
    label: parsed.data.label ?? null,
    group: parsed.data.group ?? null,
    balanceSol: 0,
    balanceUsd: 0,
  }).returning();

  res.status(201).json(toWalletResponse(wallet));
});

// POST /wallets/import — import real private key (bs58)
router.post("/wallets/import", async (req, res): Promise<void> => {
  const parsed = ImportWalletBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  let keypair: Keypair;
  try {
    const secretKey = bs58.decode(parsed.data.privateKey);
    keypair = Keypair.fromSecretKey(secretKey);
  } catch {
    res.status(400).json({ error: "Invalid private key — must be a base58-encoded Solana secret key" });
    return;
  }

  const existing = await db.select().from(walletsTable).where(eq(walletsTable.publicKey, keypair.publicKey.toString()));
  if (existing.length > 0) {
    res.status(409).json({ error: "Wallet with this public key already exists" });
    return;
  }

  const [wallet] = await db.insert(walletsTable).values({
    publicKey: keypair.publicKey.toString(),
    encryptedPrivateKey: encryptSecretKey(parsed.data.privateKey),
    ownerAddress: parsed.data.ownerAddress,
    label: parsed.data.label ?? null,
    group: parsed.data.group ?? null,
    balanceSol: 0,
    balanceUsd: 0,
  }).returning();

  res.status(201).json(toWalletResponse(wallet));
});

// POST /wallets/generate-bulk — generate N real Solana keypairs
router.post("/wallets/generate-bulk", async (req, res): Promise<void> => {
  const parsed = GenerateBulkWalletsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const count = Math.min(parsed.data.count, 50);
  const values = Array.from({ length: count }, () => {
    const { publicKey, encryptedPrivateKey } = generateKeypair();
    return {
      publicKey,
      encryptedPrivateKey,
      ownerAddress: parsed.data.ownerAddress,
      group: parsed.data.group ?? null,
      balanceSol: 0,
      balanceUsd: 0,
    };
  });

  const wallets = await db.insert(walletsTable).values(values).returning();
  res.status(201).json(wallets.map(toWalletResponse));
});

// GET /wallets/groups
router.get("/wallets/groups", async (req, res): Promise<void> => {
  const parsed = ListWalletGroupsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const conditions = [];
  if (parsed.data.ownerAddress) conditions.push(eq(walletsTable.ownerAddress, parsed.data.ownerAddress));

  const groups = await db
    .select({
      name: walletsTable.group,
      count: sql<number>`count(*)::int`,
      totalBalanceSol: sql<number>`coalesce(sum(${walletsTable.balanceSol}), 0)`,
    })
    .from(walletsTable)
    .where(and(sql`${walletsTable.group} is not null`, ...(conditions.length ? conditions : [])))
    .groupBy(walletsTable.group);

  res.json(groups.map(g => ({ name: g.name ?? "", count: g.count, totalBalanceSol: g.totalBalanceSol })));
});

// GET /wallets/:id
router.get("/wallets/:id", async (req, res): Promise<void> => {
  const params = GetWalletParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, params.data.id));
  if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }
  res.json(toWalletResponse(wallet));
});

// PATCH /wallets/:id
router.patch("/wallets/:id", async (req, res): Promise<void> => {
  const params = UpdateWalletParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = UpdateWalletBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [wallet] = await db.update(walletsTable).set(body.data).where(eq(walletsTable.id, params.data.id)).returning();
  if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }
  res.json(toWalletResponse(wallet));
});

// DELETE /wallets/:id
router.delete("/wallets/:id", async (req, res): Promise<void> => {
  const params = DeleteWalletParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [wallet] = await db.delete(walletsTable).where(eq(walletsTable.id, params.data.id)).returning();
  if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }
  res.sendStatus(204);
});

// GET /wallets/:id/private-key — return decrypted base58 private key
router.get("/wallets/:id/private-key", async (req, res): Promise<void> => {
  const params = GetWalletParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, params.data.id));
  if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }

  try {
    const privateKeyBase58 = decryptSecretKey(wallet.encryptedPrivateKey);
    res.json({ id: wallet.id, publicKey: wallet.publicKey, privateKeyBase58 });
  } catch {
    res.status(500).json({ error: "Failed to decrypt private key" });
  }
});

// GET /wallets/:id/balance — fetch real on-chain SOL balance
router.get("/wallets/:id/balance", async (req, res): Promise<void> => {
  const params = GetWalletBalanceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, params.data.id));
  if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }

  const rpcEndpoint = req.query.rpcEndpoint as string | undefined;

  try {
    const { balanceSol, balanceUsd } = await getSolBalance(wallet.publicKey, rpcEndpoint);

    await db.update(walletsTable)
      .set({ balanceSol, balanceUsd })
      .where(eq(walletsTable.id, wallet.id));

    res.json({ publicKey: wallet.publicKey, balanceSol, balanceUsd });
  } catch (err) {
    req.log.warn({ err }, "Failed to fetch on-chain balance");
    res.json({ publicKey: wallet.publicKey, balanceSol: wallet.balanceSol ?? 0, balanceUsd: wallet.balanceUsd ?? 0 });
  }
});

export default router;
