import { Router } from "express";
import type { IRouter } from "express";
import { GetTokenMetadataQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /tokens/metadata
router.get("/tokens/metadata", async (req, res): Promise<void> => {
  const parsed = GetTokenMetadataQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const ca = parsed.data.ca;
  if (!ca || ca.length < 32) {
    res.status(404).json({ error: "Token not found" });
    return;
  }

  // In a real implementation, this would call Pump.Fun API or Solana RPC
  // For demo purposes, return mock data based on the CA
  const mockTokens: Record<string, { name: string; symbol: string; description: string; imageUrl: string }> = {
    "SAMPLE": { name: "Sample Token", symbol: "SMPL", description: "A sample meme token on Pump.Fun", imageUrl: "" },
  };

  // Simulate a token lookup - for demo return a generic response
  const token = {
    address: ca,
    name: `Token ${ca.slice(0, 4).toUpperCase()}`,
    symbol: ca.slice(0, 4).toUpperCase(),
    description: "Fetched from Pump.Fun",
    imageUrl: null,
    decimals: 6,
    supply: 1000000000,
  };

  res.json(token);
});

export default router;
