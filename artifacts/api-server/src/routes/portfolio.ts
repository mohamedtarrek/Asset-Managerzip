import { Router } from "express";
import type { IRouter } from "express";
import { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getConnection } from "../lib/solana.js";

const router: IRouter = Router();

const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

async function getTokenMetadata(
  connection: Connection,
  mintAddress: string
): Promise<{ name: string; symbol: string } | null> {
  try {
    const mint = new PublicKey(mintAddress);
    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      METAPLEX_PROGRAM_ID
    );
    const accountInfo = await connection.getAccountInfo(metadataPda);
    if (!accountInfo) return null;

    const data = accountInfo.data;
    let offset = 65;

    const nameLen = data.readUInt32LE(offset);
    offset += 4;
    const name = data.slice(offset, offset + nameLen).toString("utf8").replace(/\0/g, "").trim();
    offset += nameLen;

    const symbolLen = data.readUInt32LE(offset);
    offset += 4;
    const symbol = data.slice(offset, offset + symbolLen).toString("utf8").replace(/\0/g, "").trim();

    if (!name && !symbol) return null;
    return { name: name || mintAddress.slice(0, 8), symbol: symbol || mintAddress.slice(0, 4).toUpperCase() };
  } catch {
    return null;
  }
}

// GET /portfolio?walletAddress=...&network=...
router.get("/portfolio", async (req, res): Promise<void> => {
  const { walletAddress, network } = req.query as { walletAddress?: string; network?: string };

  if (!walletAddress || walletAddress.length < 32) {
    res.status(400).json({ error: "walletAddress is required" });
    return;
  }

  const rpc =
    network === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com";
  const connection = getConnection(rpc);

  try {
    const pubkey = new PublicKey(walletAddress);

    const [solLamports, tokenAccounts] = await Promise.all([
      connection.getBalance(pubkey),
      connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }),
    ]);

    const solBalance = solLamports / LAMPORTS_PER_SOL;

    const nonZeroAccounts = tokenAccounts.value.filter((a) => {
      const info = a.account.data.parsed?.info;
      return info && Number(info.tokenAmount.uiAmount ?? 0) > 0;
    });

    const tokens = await Promise.all(
      nonZeroAccounts.map(async (a) => {
        const info = a.account.data.parsed?.info;
        const mint = info.mint as string;
        const uiAmount = info.tokenAmount.uiAmount as number;
        const rawAmount = info.tokenAmount.amount as string;
        const decimals = info.tokenAmount.decimals as number;

        const metadata = await getTokenMetadata(connection, mint).catch(() => null);

        return {
          mint,
          name: metadata?.name ?? `${mint.slice(0, 4)}...${mint.slice(-4)}`,
          symbol: metadata?.symbol ?? mint.slice(0, 6).toUpperCase(),
          balance: uiAmount,
          rawAmount,
          decimals,
          tokenAccount: a.pubkey.toString(),
        };
      })
    );

    res.json({ solBalance, tokens, network: network ?? "mainnet" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch portfolio" });
  }
});

// POST /portfolio/sell-tx — build an unsigned sell transaction for Phantom to sign
router.post("/portfolio/sell-tx", async (req, res): Promise<void> => {
  const {
    walletAddress,
    mint,
    amount,
    slippage = 10,
    network,
  } = req.body as {
    walletAddress: string;
    mint: string;
    amount: string;
    slippage?: number;
    network?: string;
  };

  if (!walletAddress || !mint || !amount) {
    res.status(400).json({ error: "walletAddress, mint, and amount are required" });
    return;
  }

  const isMainnet = network !== "devnet";

  if (isMainnet) {
    try {
      const response = await fetch("https://pumpportal.fun/api/trade-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: walletAddress,
          action: "sell",
          mint,
          denominatedInSol: "false",
          amount: Number(amount),
          slippage,
          priorityFee: 0.005,
          pool: "pump",
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`pumpportal.fun error (${response.status}): ${errText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64Tx = Buffer.from(arrayBuffer).toString("base64");
      res.json({ transaction: base64Tx, type: "versioned", network: "mainnet" });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to build sell transaction",
      });
    }
  } else {
    res.json({ simulated: true, network: "devnet" });
  }
});

export default router;
