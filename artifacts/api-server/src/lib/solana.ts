import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PumpFunSDK } from "pumpdotfun-sdk";
import { AnchorProvider } from "@coral-xyz/anchor";
import _NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet.js";
const NodeWallet = (_NodeWallet as any).default ?? _NodeWallet;
import bs58 from "bs58";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const SOL_PRICE_USD = 142.8;

const encKey = () => {
  const secret = process.env.SESSION_SECRET ?? "fallback-dev-key-must-be-padded!!";
  return Buffer.from(secret.padEnd(32, "!").slice(0, 32));
};

export function encryptSecretKey(secretKeyBase58: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", encKey(), iv);
  let encrypted = cipher.update(secretKeyBase58, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decryptSecretKey(encrypted: string): string {
  const [ivHex, data] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv("aes-256-cbc", encKey(), iv);
  let decrypted = decipher.update(data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function generateKeypair(): { publicKey: string; encryptedPrivateKey: string } {
  const keypair = Keypair.generate();
  const secretKeyBase58 = bs58.encode(keypair.secretKey);
  return {
    publicKey: keypair.publicKey.toString(),
    encryptedPrivateKey: encryptSecretKey(secretKeyBase58),
  };
}

export function keypairFromEncrypted(encryptedPrivateKey: string): Keypair {
  const secretKeyBase58 = decryptSecretKey(encryptedPrivateKey);
  const secretKey = bs58.decode(secretKeyBase58);
  return Keypair.fromSecretKey(secretKey);
}

export function getConnection(rpcEndpoint?: string | null): Connection {
  return new Connection(rpcEndpoint ?? DEFAULT_RPC, "confirmed");
}

export function getPumpFunSDK(rpcEndpoint?: string | null): PumpFunSDK {
  const connection = getConnection(rpcEndpoint);
  const dummyWallet = new NodeWallet(Keypair.generate());
  const provider = new AnchorProvider(connection, dummyWallet, { commitment: "confirmed" });
  return new PumpFunSDK(provider);
}

export async function getSolBalance(publicKey: string, rpcEndpoint?: string | null): Promise<{ balanceSol: number; balanceUsd: number }> {
  const connection = getConnection(rpcEndpoint);
  const lamports = await connection.getBalance(new PublicKey(publicKey));
  const balanceSol = lamports / LAMPORTS_PER_SOL;
  return { balanceSol, balanceUsd: balanceSol * SOL_PRICE_USD };
}

export async function urlToBlob(url: string): Promise<Blob> {
  if (url.startsWith("data:")) {
    const [header, base64] = url.split(",");
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : "image/png";
    const buffer = Buffer.from(base64, "base64");
    return new Blob([buffer], { type: mime });
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
  return resp.blob();
}

export function lamportsToBigInt(sol: number): bigint {
  return BigInt(Math.floor(sol * LAMPORTS_PER_SOL));
}

/**
 * Try to airdrop via the Solana web faucet (higher rate limits than RPC).
 * Returns true if successful.
 */
async function tryWebFaucet(address: string, amountSol: number): Promise<boolean> {
  try {
    const resp = await fetch("https://faucet.solana.com/api/airdrop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, amount: amountSol, network: "devnet" }),
      signal: AbortSignal.timeout(15_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * On devnet: ensure each wallet has at least `minSol` SOL.
 * Strategy (each step only runs if the wallet still needs more SOL):
 *   1. Check existing balance — skip entirely if already funded.
 *   2. Try RPC requestAirdrop (up to `rpcRetries` times with backoff).
 *   3. Try the Solana web faucet as a fallback (higher rate limits).
 *   4. Re-check balance. If still below minimum, log a warning but NEVER throw —
 *      the individual transaction balance checks in devnet-launch.ts handle it
 *      gracefully so the launch can continue for wallets that do have funds.
 *
 * No-op on mainnet/testnet.
 */
export async function airdropIfDevnet(
  rpcEndpoint: string | null | undefined,
  publicKeys: PublicKey[],
  amountSol = 2,
  rpcRetries = 3,
): Promise<void> {
  if (!rpcEndpoint?.includes("devnet")) return;

  const connection = getConnection(rpcEndpoint);
  const minLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  for (const key of publicKeys) {
    const address = key.toBase58();

    // 1. Check existing balance — skip if already funded
    const existingBalance = await connection.getBalance(key).catch(() => 0);
    if (existingBalance >= minLamports) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    let funded = false;

    // 2. Try RPC airdrop with exponential backoff
    for (let attempt = 0; attempt < rpcRetries && !funded; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
      try {
        const sig = await connection.requestAirdrop(key, minLamports);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        funded = true;
      } catch {
        // rate-limited or network error — try next attempt
      }
    }

    // 3. Try web faucet as backup
    if (!funded) {
      funded = await tryWebFaucet(address, amountSol);
      if (funded) {
        // Give the faucet tx a moment to land
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    // 4. Final balance check — warn but never throw
    if (!funded) {
      const finalBalance = await connection.getBalance(key).catch(() => 0);
      if (finalBalance === 0) {
        console.warn(
          `[DEVNET] Airdrop warning: wallet ${address.slice(0, 8)}... has 0 SOL and faucet is rate-limited. ` +
          `Transactions from this wallet will be skipped. Fund it manually at https://faucet.solana.com`
        );
      }
    }

    // Small gap between wallets
    await new Promise((r) => setTimeout(r, 500));
  }
}
