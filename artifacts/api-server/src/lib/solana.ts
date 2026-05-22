import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PumpFunSDK } from "pumpdotfun-sdk";
import { AnchorProvider } from "@coral-xyz/anchor";
import _NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet.js";
// esbuild CJS/ESM interop: the file uses exports.default so the resolved value
// may be the namespace object; unwrap .default if needed.
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
  // Handle base64 data URIs from frontend file upload
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
 * On devnet endpoints, airdrop SOL to each supplied public key and wait for
 * confirmation. Retries up to `retries` times per key with exponential backoff.
 * Verifies balance after airdrop — throws if a key still has 0 SOL after all
 * retries (so callers know immediately instead of getting a cryptic tx error).
 * No-op on mainnet/testnet.
 */
export async function airdropIfDevnet(
  rpcEndpoint: string | null | undefined,
  publicKeys: PublicKey[],
  amountSol = 2,
  retries = 4,
): Promise<void> {
  if (!rpcEndpoint?.includes("devnet")) return;
  const connection = getConnection(rpcEndpoint);
  const lamports = amountSol * LAMPORTS_PER_SOL;

  for (const key of publicKeys) {
    let success = false;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const sig = await connection.requestAirdrop(key, lamports);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        success = true;
        break;
      } catch {
        // Rate-limit or network hiccup — wait and retry
        const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (!success) {
      // Last-chance balance check: if the wallet already has SOL we can proceed
      const balance = await connection.getBalance(key).catch(() => 0);
      if (balance === 0) {
        throw new Error(
          `Devnet airdrop failed for ${key.toBase58().slice(0, 8)}... after ${retries} attempts. ` +
          `The public devnet faucet is rate-limited. Try again in a few minutes or use a private devnet RPC endpoint.`
        );
      }
    }
    // Small gap between wallets to reduce back-to-back rate limiting
    await new Promise((r) => setTimeout(r, 600));
  }
}
