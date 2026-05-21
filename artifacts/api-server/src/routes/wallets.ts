import { Router } from "express";
import type { IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, walletsTable } from "@workspace/db";
import { createCipheriv, randomBytes } from "crypto";
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

const router: IRouter = Router();

const ENCRYPTION_KEY = process.env.SESSION_SECRET ?? "fallback-dev-key-32-chars-padding";

function encryptKey(privateKey: string): string {
  const iv = randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32));
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(privateKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function generateMockKeypair() {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const pubkey = Array.from({ length: 44 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const privkey = Array.from({ length: 88 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return { publicKey: pubkey, privateKey: privkey };
}

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

// POST /wallets
router.post("/wallets", async (req, res): Promise<void> => {
  const parsed = CreateWalletBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { publicKey, privateKey } = generateMockKeypair();
  const [wallet] = await db.insert(walletsTable).values({
    publicKey,
    encryptedPrivateKey: encryptKey(privateKey),
    ownerAddress: parsed.data.ownerAddress,
    label: parsed.data.label ?? null,
    group: parsed.data.group ?? null,
    balanceSol: 0,
  }).returning();

  res.status(201).json(toWalletResponse(wallet));
});

// POST /wallets/import
router.post("/wallets/import", async (req, res): Promise<void> => {
  const parsed = ImportWalletBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  if (parsed.data.privateKey.length < 32) {
    res.status(400).json({ error: "Invalid private key" });
    return;
  }

  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const pubkey = Array.from({ length: 44 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");

  const [wallet] = await db.insert(walletsTable).values({
    publicKey: pubkey,
    encryptedPrivateKey: encryptKey(parsed.data.privateKey),
    ownerAddress: parsed.data.ownerAddress,
    label: parsed.data.label ?? null,
    group: parsed.data.group ?? null,
    balanceSol: 0,
  }).returning();

  res.status(201).json(toWalletResponse(wallet));
});

// POST /wallets/generate-bulk
router.post("/wallets/generate-bulk", async (req, res): Promise<void> => {
  const parsed = GenerateBulkWalletsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const count = Math.min(parsed.data.count, 50);
  const values = Array.from({ length: count }, () => {
    const { publicKey, privateKey } = generateMockKeypair();
    return {
      publicKey,
      encryptedPrivateKey: encryptKey(privateKey),
      ownerAddress: parsed.data.ownerAddress,
      group: parsed.data.group ?? null,
      balanceSol: 0,
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
      totalBalanceSol: sql<number>`sum(${walletsTable.balanceSol})`,
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

// GET /wallets/:id/balance
router.get("/wallets/:id/balance", async (req, res): Promise<void> => {
  const params = GetWalletBalanceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, params.data.id));
  if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }
  const balanceSol = wallet.balanceSol ?? 0;
  res.json({ publicKey: wallet.publicKey, balanceSol, balanceUsd: balanceSol * 142.8 });
});

export default router;
