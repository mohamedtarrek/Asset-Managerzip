import { Router } from "express";
import type { IRouter } from "express";
import { GetTokenMetadataQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /tokens/metadata — fetch real token metadata from Pump.Fun API
router.get("/tokens/metadata", async (req, res): Promise<void> => {
  const parsed = GetTokenMetadataQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const ca = parsed.data.ca;
  if (!ca || ca.length < 32) {
    res.status(400).json({ error: "Invalid contract address" });
    return;
  }

  try {
    // Pump.Fun frontend API — returns token metadata including image, description, social links
    const resp = await fetch(`https://frontend-api.pump.fun/coins/${ca}`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      res.status(404).json({ error: "Token not found on Pump.Fun" });
      return;
    }

    const data = await resp.json() as {
      mint?: string;
      name?: string;
      symbol?: string;
      description?: string;
      image_uri?: string;
      metadata_uri?: string;
      twitter?: string;
      telegram?: string;
      website?: string;
      total_supply?: number;
      market_cap?: number;
      usd_market_cap?: number;
      creator?: string;
      created_timestamp?: number;
    };

    res.json({
      address: data.mint ?? ca,
      name: data.name ?? "Unknown",
      symbol: data.symbol ?? "?",
      description: data.description ?? "",
      imageUrl: data.image_uri ?? null,
      metadataUri: data.metadata_uri ?? null,
      twitter: data.twitter ?? null,
      telegram: data.telegram ?? null,
      website: data.website ?? null,
      decimals: 6,
      supply: data.total_supply ?? 1_000_000_000,
      marketCapUsd: data.usd_market_cap ?? null,
      creator: data.creator ?? null,
      createdAt: data.created_timestamp ? new Date(data.created_timestamp * 1000).toISOString() : null,
    });
  } catch (err) {
    req.log.warn({ err, ca }, "Failed to fetch Pump.Fun metadata");
    res.status(502).json({ error: "Failed to reach Pump.Fun API — check token address and try again" });
  }
});

export default router;
