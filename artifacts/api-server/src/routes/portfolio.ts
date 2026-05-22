import { Router } from "express";
import type { IRouter } from "express";
import { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { eq, and } from "drizzle-orm";
import { db, bundlesTable, bundleWalletsTable } from "@workspace/db";
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

// GET /portfolio/bundle-holdings?ownerAddress=...&network=...
// Returns live token balances held across all bundle wallets for this owner
router.get("/portfolio/bundle-holdings", async (req, res): Promise<void> => {
  const { ownerAddress, network } = req.query as { ownerAddress?: string; network?: string };

  if (!ownerAddress || ownerAddress.length < 32) {
    res.status(400).json({ error: "ownerAddress is required" });
    return;
  }

  const rpc =
    network === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com";
  const connection = getConnection(rpc);

  try {
    const bundles = await db
      .select()
      .from(bundlesTable)
      .where(
        and(
          eq(bundlesTable.ownerAddress, ownerAddress),
          eq(bundlesTable.network, network === "devnet" ? "devnet" : "mainnet")
        )
      );

    const bundlesWithTokens = bundles.filter((b) => b.tokenAddress && b.status !== "failed");

    const results = await Promise.all(
      bundlesWithTokens.map(async (bundle) => {
        try {
          const walletRows = await db
            .select()
            .from(bundleWalletsTable)
            .where(eq(bundleWalletsTable.bundleId, bundle.id));

          if (walletRows.length === 0) return null;

          const mintPubkey = new PublicKey(bundle.tokenAddress!);
          const TOKEN_DECIMALS = 6;

          const walletBalances = await Promise.all(
            walletRows.map(async (w) => {
              const pubkey = new PublicKey(w.walletPublicKey);
              const [solLamports, tokenBalance] = await Promise.all([
                connection.getBalance(pubkey).catch(() => 0),
                (async () => {
                  try {
                    const ata = getAssociatedTokenAddressSync(mintPubkey, pubkey);
                    const account = await getAccount(connection, ata);
                    return Number(account.amount) / 10 ** TOKEN_DECIMALS;
                  } catch {
                    return 0;
                  }
                })(),
              ]);
              return {
                walletPublicKey: w.walletPublicKey,
                isCreator: w.isCreator,
                soldAt: w.soldAt,
                solBalance: solLamports / LAMPORTS_PER_SOL,
                tokenBalance,
              };
            })
          );

          const totalTokenBalance = walletBalances.reduce((s, w) => s + w.tokenBalance, 0);
          const totalSolBalance = walletBalances.reduce((s, w) => s + w.solBalance, 0);
          const unsoldWallets = walletBalances.filter((w) => !w.soldAt && !w.isCreator);

          return {
            bundleId: bundle.id,
            tokenName: bundle.tokenName,
            tokenSymbol: bundle.tokenSymbol,
            tokenAddress: bundle.tokenAddress,
            status: bundle.status,
            network: bundle.network,
            totalTokenBalance,
            totalSolBalance,
            unsoldWalletCount: unsoldWallets.length,
            wallets: walletBalances,
          };
        } catch {
          return null;
        }
      })
    );

    res.json(results.filter((r) => r !== null && r.totalTokenBalance > 0));
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to fetch bundle holdings",
    });
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
