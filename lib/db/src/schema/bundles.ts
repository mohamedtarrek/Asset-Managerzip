import { pgTable, text, serial, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bundlesTable = pgTable("bundles", {
  id: serial("id").primaryKey(),
  ownerAddress: text("owner_address").notNull(),
  tokenName: text("token_name").notNull(),
  tokenSymbol: text("token_symbol").notNull(),
  tokenAddress: text("token_address"),
  tokenDescription: text("token_description"),
  tokenImageUrl: text("token_image_url"),
  walletCount: integer("wallet_count").notNull(),
  solPerWallet: real("sol_per_wallet"),
  totalSolSpent: real("total_sol_spent"),
  status: text("status").notNull().default("pending"),
  launchType: text("launch_type").notNull().default("bundle"),
  performanceUsd: real("performance_usd"),
  performanceSol: real("performance_sol"),
  txHash: text("tx_hash"),
  network: text("network").notNull().default("mainnet"),
  poolId: text("pool_id"),
  marketId: text("market_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBundleSchema = createInsertSchema(bundlesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBundle = z.infer<typeof insertBundleSchema>;
export type Bundle = typeof bundlesTable.$inferSelect;
