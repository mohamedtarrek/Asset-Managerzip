import { Router } from "express";
import type { IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";

const router: IRouter = Router();

// GET /settings/github-token/status
// Returns whether a token is stored — never returns the raw token
router.get("/settings/github-token/status", async (req, res): Promise<void> => {
  const { walletAddress } = req.query as { walletAddress?: string };

  // Check env var first
  if (process.env.GITHUB_TOKEN) {
    res.json({ hasToken: true, source: "env" });
    return;
  }

  if (!walletAddress) {
    // Check if any settings row has a token (single-user convenience)
    const [row] = await db
      .select({ githubToken: settingsTable.githubToken })
      .from(settingsTable)
      .limit(1);
    res.json({ hasToken: !!row?.githubToken, source: "db" });
    return;
  }

  const [row] = await db
    .select({ githubToken: settingsTable.githubToken })
    .from(settingsTable)
    .where(eq(settingsTable.walletAddress, walletAddress))
    .limit(1);

  res.json({ hasToken: !!row?.githubToken, source: "db" });
});

// POST /settings/github-token
// Saves (or clears) the GitHub token for a wallet
router.post("/settings/github-token", async (req, res): Promise<void> => {
  const { walletAddress, token } = req.body as { walletAddress?: string; token: string };

  if (typeof token !== "string") {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const githubToken = token.trim() || null;

  if (walletAddress) {
    // Upsert settings row for this wallet
    await db
      .insert(settingsTable)
      .values({ walletAddress, githubToken })
      .onConflictDoUpdate({
        target: settingsTable.walletAddress,
        set: { githubToken },
      });
  } else {
    // Update first existing row (single-user convenience)
    const [existing] = await db.select({ id: settingsTable.id }).from(settingsTable).limit(1);
    if (existing) {
      await db
        .update(settingsTable)
        .set({ githubToken })
        .where(eq(settingsTable.id, existing.id));
    } else {
      res.status(400).json({ error: "Connect a wallet first so settings can be saved" });
      return;
    }
  }

  res.json({ success: true, hasToken: !!githubToken });
});

export default router;
