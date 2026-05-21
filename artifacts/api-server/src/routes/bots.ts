import { Router } from "express";
import type { IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, botsTable, activityTable, walletsTable, settingsTable } from "@workspace/db";
import { PublicKey } from "@solana/web3.js";
import { getPumpFunSDK, keypairFromEncrypted, lamportsToBigInt } from "../lib/solana.js";
import {
  ListBotsQueryParams,
  CreateBotBody,
  GetBotParams,
  DeleteBotParams,
  StartBotParams,
  StopBotParams,
  PauseBotParams,
  EstimateBotCostBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

const SPEED_INTERVALS: Record<string, { minSec: number; maxSec: number }> = {
  gentle: { minSec: 90, maxSec: 150 },
  moderate: { minSec: 20, maxSec: 40 },
  fast: { minSec: 10, maxSec: 20 },
};
const PRIORITY_FEES = { unitLimit: 100_000, unitPrice: 150_000 };
const SLIPPAGE_BASIS_POINTS = 500n;

// In-memory bump loop timers keyed by bot id
const botTimers = new Map<number, NodeJS.Timeout>();

function calcEstimate(walletCount: number, speed: string, budgetSol: number) {
  const interval = SPEED_INTERVALS[speed] ?? SPEED_INTERVALS.moderate;
  const avgIntervalSec = (interval.minSec + interval.maxSec) / 2;
  const bumpsPerHour = Math.floor(3600 / avgIntervalSec);
  const solPerWallet = budgetSol / walletCount;
  const bumpSize = solPerWallet * 0.05;
  const costPerBump = bumpSize + 0.000005;
  const totalBumps = Math.floor(budgetSol / costPerBump);
  const estimatedDurationHours = totalBumps / bumpsPerHour;
  const minBudget = walletCount * 0.05 * 0.2;
  const isValid = budgetSol >= minBudget;
  const validationMessage = isValid ? null : `Minimum ${minBudget.toFixed(3)} SOL required for ${walletCount} wallets`;
  return { bumpSize, bumpsPerHour, costPerBump, totalBumps, estimatedDurationHours, solPerWallet, isValid, validationMessage };
}

async function getRpcForOwner(ownerAddress: string): Promise<string | null> {
  try {
    const [s] = await db.select().from(settingsTable).where(eq(settingsTable.walletAddress, ownerAddress));
    return s?.rpcEndpoint ?? null;
  } catch { return null; }
}

async function executeBump(botId: number) {
  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, botId));
  if (!bot || bot.status !== "running") return;

  const rpcEndpoint = await getRpcForOwner(bot.ownerAddress);
  const sdk = getPumpFunSDK(rpcEndpoint);

  // Pick a wallet round-robin
  const wallets = await db.select().from(walletsTable)
    .where(and(eq(walletsTable.ownerAddress, bot.ownerAddress), eq(walletsTable.isActive, true)))
    .limit(bot.walletCount);

  if (wallets.length === 0) return;

  const bumpIdx = (bot.bumpsExecuted ?? 0) % wallets.length;
  const wallet = wallets[bumpIdx];
  if (!wallet) return;

  const bumpSol = bot.bumpSize ?? 0.0025;
  const bumpLamports = lamportsToBigInt(bumpSol);

  try {
    const buyerKeypair = keypairFromEncrypted(wallet.encryptedPrivateKey);
    const mintPubkey = new PublicKey(bot.tokenAddress);
    const result = await sdk.buy(buyerKeypair, mintPubkey, bumpLamports, SLIPPAGE_BASIS_POINTS, PRIORITY_FEES);

    const newBumpsExecuted = (bot.bumpsExecuted ?? 0) + 1;
    const isComplete = bot.totalBumps && newBumpsExecuted >= bot.totalBumps;

    await db.update(botsTable).set({
      bumpsExecuted: newBumpsExecuted,
      status: isComplete ? "completed" : "running",
    }).where(eq(botsTable.id, botId));

    if (result.signature) {
      await db.insert(activityTable).values({
        ownerAddress: bot.ownerAddress,
        type: "bot_bump",
        description: `Bump #${newBumpsExecuted} executed for ${bot.tokenAddress.slice(0, 8)}...`,
        txHash: result.signature,
        walletAddress: wallet.publicKey,
      }).catch(() => {});
    }

    if (isComplete) stopBotTimer(botId);
  } catch (err) {
    // Bump failed — continue trying, don't stop the bot
  }
}

function scheduleNextBump(botId: number, speed: string) {
  const interval = SPEED_INTERVALS[speed] ?? SPEED_INTERVALS.moderate;
  const delaySec = interval.minSec + Math.random() * (interval.maxSec - interval.minSec);
  const timer = setTimeout(async () => {
    await executeBump(botId);
    // Schedule next if still running
    const [bot] = await db.select({ status: botsTable.status, speed: botsTable.speed }).from(botsTable).where(eq(botsTable.id, botId));
    if (bot?.status === "running") {
      scheduleNextBump(botId, bot.speed);
    }
  }, delaySec * 1000);
  botTimers.set(botId, timer);
}

function stopBotTimer(botId: number) {
  const timer = botTimers.get(botId);
  if (timer) { clearTimeout(timer); botTimers.delete(botId); }
}

// GET /bots
router.get("/bots", async (req, res): Promise<void> => {
  const parsed = ListBotsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const conditions = [];
  if (parsed.data.ownerAddress) conditions.push(eq(botsTable.ownerAddress, parsed.data.ownerAddress));
  if (parsed.data.status) conditions.push(eq(botsTable.status, parsed.data.status));

  const bots = await db.select().from(botsTable).where(conditions.length ? and(...conditions) : undefined);
  res.json(bots);
});

// POST /bots
router.post("/bots", async (req, res): Promise<void> => {
  const parsed = CreateBotBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const est = calcEstimate(parsed.data.walletCount, parsed.data.speed, parsed.data.budgetSol);

  const [bot] = await db.insert(botsTable).values({
    ownerAddress: parsed.data.ownerAddress,
    tokenAddress: parsed.data.tokenAddress,
    walletCount: parsed.data.walletCount,
    speed: parsed.data.speed,
    budgetSol: parsed.data.budgetSol,
    solPerWallet: est.solPerWallet,
    bumpSize: est.bumpSize,
    bumpsPerHour: est.bumpsPerHour,
    costPerBump: est.costPerBump,
    totalBumps: est.totalBumps,
    estimatedDurationHours: est.estimatedDurationHours,
    bumpsExecuted: 0,
    status: "idle",
  }).returning();

  res.status(201).json(bot);
});

// POST /bots/estimate
router.post("/bots/estimate", async (req, res): Promise<void> => {
  const parsed = EstimateBotCostBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  res.json(calcEstimate(parsed.data.walletCount, parsed.data.speed, parsed.data.budgetSol));
});

// GET /bots/:id
router.get("/bots/:id", async (req, res): Promise<void> => {
  const params = GetBotParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, params.data.id));
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json(bot);
});

// DELETE /bots/:id
router.delete("/bots/:id", async (req, res): Promise<void> => {
  const params = DeleteBotParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  stopBotTimer(params.data.id);
  const [bot] = await db.delete(botsTable).where(eq(botsTable.id, params.data.id)).returning();
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.sendStatus(204);
});

// POST /bots/:id/start — starts the real bump loop
router.post("/bots/:id/start", async (req, res): Promise<void> => {
  const params = StartBotParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [bot] = await db.update(botsTable)
    .set({ status: "running", startedAt: new Date(), stoppedAt: null })
    .where(eq(botsTable.id, params.data.id))
    .returning();

  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }

  scheduleNextBump(bot.id, bot.speed);

  await db.insert(activityTable).values({
    ownerAddress: bot.ownerAddress,
    type: "bot_start",
    description: `Bump bot started for ${bot.tokenAddress.slice(0, 8)}... — ${bot.speed} speed`,
  }).catch(() => {});

  res.json(bot);
});

// POST /bots/:id/stop
router.post("/bots/:id/stop", async (req, res): Promise<void> => {
  const params = StopBotParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  stopBotTimer(params.data.id);
  const [bot] = await db.update(botsTable)
    .set({ status: "stopped", stoppedAt: new Date() })
    .where(eq(botsTable.id, params.data.id))
    .returning();

  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }

  await db.insert(activityTable).values({
    ownerAddress: bot.ownerAddress,
    type: "bot_stop",
    description: `Bump bot stopped. ${bot.bumpsExecuted ?? 0} bumps executed`,
  }).catch(() => {});

  res.json(bot);
});

// POST /bots/:id/pause
router.post("/bots/:id/pause", async (req, res): Promise<void> => {
  const params = PauseBotParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  stopBotTimer(params.data.id);
  const [bot] = await db.update(botsTable).set({ status: "paused" }).where(eq(botsTable.id, params.data.id)).returning();
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json(bot);
});

export default router;
