import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const bundleWalletsTable = pgTable("bundle_wallets", {
  id: serial("id").primaryKey(),
  bundleId: integer("bundle_id").notNull(),
  walletPublicKey: text("wallet_public_key").notNull(),
  isCreator: boolean("is_creator").notNull().default(false),
  soldAt: timestamp("sold_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BundleWallet = typeof bundleWalletsTable.$inferSelect;
