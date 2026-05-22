/**
 * Real devnet token launch: SPL mint + OpenBook market + Raydium AMM v4 pool.
 *
 * Replaces the old [DEVNET SIM] stub in bundles.ts.
 * Pump.fun is mainnet-only; on devnet we create a native SPL token, open an
 * OpenBook order-book market (required by Raydium AMM v4), then initialise an
 * AMM v4 pool seeded with SOL + token liquidity.  The remaining token supply
 * (20 %) is distributed directly to the bundle wallets — equivalent to each
 * wallet "buying in" at the launch price without routing through the AMM so
 * we avoid the extra WSOL-wrap complexity and fragile pool-state reads.
 *
 * Program IDs used on devnet
 * ─────────────────────────
 *  OpenBook v2:  EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVAXr5sCS76takq
 *  Raydium AMM v4: HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8
 *  AMM fee dest: 3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  NATIVE_MINT,
} from "@solana/spl-token";
import BN from "bn.js";
import { Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { keypairFromEncrypted, getConnection, airdropIfDevnet } from "./solana.js";

// ── Devnet program IDs ───────────────────────────────────────────────────────
export const DEVNET_OPENBOOK    = new PublicKey("EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVAXr5sCS76takq");
export const DEVNET_AMM_V4      = new PublicKey("HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8");
export const DEVNET_AMM_FEE_DEST = new PublicKey("3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR");

// ── Token constants ──────────────────────────────────────────────────────────
const TOKEN_DECIMALS    = 6;
const TOTAL_SUPPLY      = 1_000_000_000;                      // 1 billion
const TOTAL_SUPPLY_RAW  = TOTAL_SUPPLY * 10 ** TOKEN_DECIMALS; // smallest units
const POOL_TOKEN_SHARE  = 0.8;   // 80 % of supply goes to LP
const POOL_SOL_AMOUNT   = 2;     // 2 SOL added as quote liquidity

type WalletRow = { publicKey: string; encryptedPrivateKey: string };

export interface DevnetLaunchResult {
  mintAddress: string;
  marketId:    string;
  poolId:      string;
  txHashes:    string[];
}

// ── Helper: recompute OpenBook vault-signer (marketAuthority) ────────────────
function computeVaultSigner(marketId: PublicKey, dexProgram: PublicKey): PublicKey {
  const nonce = new BN(0);
  while (true) {
    try {
      return PublicKey.createProgramAddressSync(
        [marketId.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
        dexProgram,
      );
    } catch {
      nonce.iaddn(1);
      if (nonce.gt(new BN(25_555))) throw new Error("computeVaultSigner: max nonce exceeded");
    }
  }
}

// ── Helper: top up creator SOL on devnet (market + pool creation costs ~4 SOL)
// Tries two rounds of airdrop to accumulate enough SOL, then verifies balance.
// Throws a user-friendly error only if creator ends up with 0 SOL (cannot pay fees).
async function topUpCreatorSol(rpcEndpoint: string, payer: Keypair, connection: Connection): Promise<void> {
  // Two rounds to build up ~4 SOL headroom (market + pool + fees)
  await airdropIfDevnet(rpcEndpoint, [payer.publicKey], 2, 3);
  await airdropIfDevnet(rpcEndpoint, [payer.publicKey], 2, 2);

  const balance = await connection.getBalance(payer.publicKey).catch(() => 0);
  if (balance === 0) {
    throw new Error(
      "Creator wallet has 0 SOL on devnet and the faucet is currently rate-limited. " +
      "Please fund the creator wallet manually at https://faucet.solana.com, then try again."
    );
  }
}

// ── Main export ──────────────────────────────────────────────────────────────
export async function launchDevnetBundle(params: {
  rpcEndpoint:    string;
  creatorKeypair: Keypair;
  mintKeypair:    Keypair;
  tokenName:      string;
  tokenSymbol:    string;
  bundleWallets:  WalletRow[];
  solPerWallet:   number;
  log:            (msg: string) => void;
}): Promise<DevnetLaunchResult> {
  const {
    rpcEndpoint, creatorKeypair, mintKeypair, tokenSymbol,
    bundleWallets, solPerWallet, log,
  } = params;

  const connection = getConnection(rpcEndpoint);
  const txHashes:  string[]   = [];
  let   marketId:  PublicKey  = PublicKey.default;
  let   poolId:    string     = "";

  // ── 0. Ensure creator has enough SOL ──────────────────────────────────────
  log("[DEVNET] Topping up creator SOL for market + pool creation...");
  await topUpCreatorSol(rpcEndpoint, creatorKeypair, connection);

  // ── 0b. Ensure bundle wallets have enough SOL (ATA rent + solPerWallet + fees)
  if (bundleWallets.length > 0) {
    log(`[DEVNET] Airdropping SOL to ${bundleWallets.length} bundle wallet(s)...`);
    const neededSol = Math.max(2, solPerWallet + 0.1); // ATA rent + buy amount + fees
    const bundleKeys = bundleWallets.map(w => {
      try { return keypairFromEncrypted(w.encryptedPrivateKey).publicKey; }
      catch { return creatorKeypair.publicKey; }
    });
    await airdropIfDevnet(rpcEndpoint, bundleKeys, neededSol, 4);
  }

  // ── 1. Create SPL token mint ───────────────────────────────────────────────
  log(`[DEVNET] Creating SPL token mint (${TOKEN_DECIMALS} decimals)...`);
  await createMint(
    connection,
    creatorKeypair,            // fee payer
    creatorKeypair.publicKey,  // mint authority
    null,                      // freeze authority
    TOKEN_DECIMALS,
    mintKeypair,               // mint keypair (determines address)
  );
  log(`[DEVNET] Mint: ${mintKeypair.publicKey.toString()}`);

  // ── 2. Mint entire supply to creator ──────────────────────────────────────
  const creatorAta = await getOrCreateAssociatedTokenAccount(
    connection, creatorKeypair,
    mintKeypair.publicKey, creatorKeypair.publicKey,
  );
  const mintSig = await mintTo(
    connection, creatorKeypair,
    mintKeypair.publicKey, creatorAta.address, creatorKeypair.publicKey,
    BigInt(Math.floor(TOTAL_SUPPLY_RAW)),
  );
  txHashes.push(mintSig);
  log(`[DEVNET] Minted ${TOTAL_SUPPLY.toLocaleString()} ${tokenSymbol} to creator`);

  // ── 3. Raydium SDK: OpenBook market + AMM pool ────────────────────────────
  try {
    log("[DEVNET] Initialising Raydium SDK on devnet...");
    const raydium = await Raydium.load({
      connection,
      cluster: "devnet",
      owner:   creatorKeypair,
    });

    // 3a. OpenBook market ──────────────────────────────────────────────────
    log("[DEVNET] Creating OpenBook market (2–3 txns)...");
    const marketBuild = await raydium.marketV2.create({
      baseInfo:     { mint: mintKeypair.publicKey, decimals: TOKEN_DECIMALS },
      quoteInfo:    { mint: NATIVE_MINT, decimals: 9 },
      lotSize:      1,
      tickSize:     0.0001,
      dexProgramId: DEVNET_OPENBOOK,
      txVersion:    TxVersion.LEGACY,
    });
    const marketTxIds = await marketBuild.execute({ sequentially: true });
    txHashes.push(...marketTxIds);
    marketId = marketBuild.extInfo.address.marketId;
    log(`[DEVNET] OpenBook market: ${marketId.toString()}`);

    // 3b. AMM v4 pool ──────────────────────────────────────────────────────
    log("[DEVNET] Creating Raydium AMM v4 pool...");
    const poolTokens = new BN(Math.floor(TOTAL_SUPPLY_RAW * POOL_TOKEN_SHARE));
    const poolSol    = new BN(Math.floor(POOL_SOL_AMOUNT * LAMPORTS_PER_SOL));

    const poolBuild = await (raydium.liquidity as any).createPoolV4({
      programId:     DEVNET_AMM_V4,
      marketInfo:    { marketId, programId: DEVNET_OPENBOOK },
      baseMintInfo:  { mint: mintKeypair.publicKey, decimals: TOKEN_DECIMALS },
      quoteMintInfo: { mint: NATIVE_MINT, decimals: 9 },
      baseAmount:    poolTokens,
      quoteAmount:   poolSol,
      startTime:     new BN(0),
      ownerInfo:     { feePayer: creatorKeypair.publicKey, useSOLBalance: true },
      associatedOnly: false,
      txVersion:     TxVersion.LEGACY,
      feeDestinationId: DEVNET_AMM_FEE_DEST,
    });
    const poolTxId = await poolBuild.execute();
    txHashes.push(poolTxId);
    poolId = poolBuild.extInfo.address.ammId.toString();
    log(`[DEVNET] Raydium pool: ${poolId}`);
  } catch (err) {
    // Pool / market creation may fail if devnet programs are not deployed or
    // SOL airdrop quota is exhausted.  The SPL token is already on-chain;
    // we continue to distribute tokens to bundle wallets.
    log(`[DEVNET] Pool creation step failed (${err instanceof Error ? err.message : String(err)}) — continuing with token distribution`);
  }

  // ── 4. Distribute reserve tokens to bundle wallets ────────────────────────
  //   20 % of supply is reserved for the bundle wallets.  Each wallet
  //   receives an equal share and also "pays" by sending SOL to the creator.
  const reserveRaw = Math.floor(TOTAL_SUPPLY_RAW * (1 - POOL_TOKEN_SHARE));
  const perWallet  = bundleWallets.length > 0
    ? Math.floor(reserveRaw / bundleWallets.length)
    : 0;

  for (const w of bundleWallets) {
    try {
      const buyerKeypair = keypairFromEncrypted(w.encryptedPrivateKey);

      // Ensure buyer wallet has an ATA (buyer signs as payer for rent)
      const buyerAta = await getOrCreateAssociatedTokenAccount(
        connection, buyerKeypair,
        mintKeypair.publicKey, buyerKeypair.publicKey,
      );

      // Transfer tokens from creator ATA → buyer ATA
      const sig = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          createTransferInstruction(
            creatorAta.address,
            buyerAta.address,
            creatorKeypair.publicKey,
            BigInt(perWallet),
          ),
        ),
        [creatorKeypair],
        { commitment: "confirmed" },
      );
      txHashes.push(sig);

      // Buyer sends SOL to creator to represent the buy
      const buySolLamports = Math.floor(solPerWallet * LAMPORTS_PER_SOL);
      if (buySolLamports > 0) {
        // Guard: ensure buyer actually has enough SOL (airdrop can be rate-limited)
        const buyerBalance = await connection.getBalance(buyerKeypair.publicKey);
        const minRequired  = buySolLamports + 10_000; // buy amount + tx fee buffer
        if (buyerBalance < minRequired) {
          log(`[DEVNET] Bundle wallet ${w.publicKey.slice(0, 8)}... has insufficient SOL (${buyerBalance / LAMPORTS_PER_SOL} SOL), skipping SOL transfer`);
        } else {
          const solSig = await sendAndConfirmTransaction(
            connection,
            new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: buyerKeypair.publicKey,
                toPubkey:   creatorKeypair.publicKey,
                lamports:   buySolLamports,
              }),
            ),
            [buyerKeypair],
            { commitment: "confirmed" },
          );
          txHashes.push(solSig);
        }
      }

      log(`[DEVNET] Bundle buy: ${w.publicKey.slice(0, 8)}... received ${(perWallet / 10 ** TOKEN_DECIMALS).toLocaleString()} ${tokenSymbol}`);
    } catch (err) {
      log(`[DEVNET] Bundle wallet ${w.publicKey.slice(0, 8)}... failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    mintAddress: mintKeypair.publicKey.toString(),
    marketId:    marketId.equals(PublicKey.default) ? "" : marketId.toString(),
    poolId,
    txHashes,
  };
}
