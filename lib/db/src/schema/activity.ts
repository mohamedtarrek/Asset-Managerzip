import { pgTable, text, serial, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activityTable = pgTable("activity", {
  id: serial("id").primaryKey(),
  ownerAddress: text("owner_address").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  tokenName: text("token_name"),
  tokenSymbol: text("token_symbol"),
  amount: real("amount"),
  txHash: text("tx_hash"),
  walletAddress: text("wallet_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertActivitySchema = createInsertSchema(activityTable).omit({ id: true, createdAt: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activityTable.$inferSelect;
