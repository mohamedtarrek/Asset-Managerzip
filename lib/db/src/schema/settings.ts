import { pgTable, text, serial, timestamp, real, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  defaultWalletCount: integer("default_wallet_count").notNull().default(5),
  defaultSolPerWallet: real("default_sol_per_wallet").notNull().default(0.1),
  autoApprove: boolean("auto_approve").notNull().default(false),
  darkMode: boolean("dark_mode").notNull().default(true),
  notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
  rpcEndpoint: text("rpc_endpoint"),
  githubToken: text("github_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
