import { Router } from "express";
import type { IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, botsTable, activityTable } from "@workspace/db";
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

// GET /bots/estimate
router.post("/bots/estimate", async (req, res): Promise<void> => {
  const parsed = EstimateBotCostBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const est = calcEstimate(parsed.data.walletCount, parsed.data.speed, parsed.data.budgetSol);
  res.json(est);
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
  const [bot] = await db.delete(botsTable).where(eq(botsTable.id, params.data.id)).returning();
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.sendStatus(204);
});

// POST /bots/:id/start
router.post("/bots/:id/start", async (req, res): Promise<void> => {
  const params = StartBotParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [bot] = await db.update(botsTable).set({ status: "running", startedAt: new Date(), stoppedAt: null }).where(eq(botsTable.id, params.data.id)).returning();
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }

  if (bot.ownerAddress) {
    await db.insert(activityTable).values({
      ownerAddress: bot.ownerAddress,
      type: "bot_start",
      description: `Bump bot started for ${bot.tokenAddress.slice(0, 8)}...`,
    }).catch(() => {});
  }

  res.json(bot);
});

// POST /bots/:id/stop
router.post("/bots/:id/stop", async (req, res): Promise<void> => {
  const params = StopBotParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [bot] = await db.update(botsTable).set({ status: "stopped", stoppedAt: new Date() }).where(eq(botsTable.id, params.data.id)).returning();
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }

  if (bot.ownerAddress) {
    await db.insert(activityTable).values({
      ownerAddress: bot.ownerAddress,
      type: "bot_stop",
      description: `Bump bot stopped. ${bot.bumpsExecuted ?? 0} bumps executed`,
    }).catch(() => {});
  }

  res.json(bot);
});

// POST /bots/:id/pause
router.post("/bots/:id/pause", async (req, res): Promise<void> => {
  const params = PauseBotParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bot] = await db.update(botsTable).set({ status: "paused" }).where(eq(botsTable.id, params.data.id)).returning();
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json(bot);
});

export default router;
