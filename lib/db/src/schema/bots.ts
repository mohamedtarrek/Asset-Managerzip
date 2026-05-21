import { pgTable, text, serial, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botsTable = pgTable("bots", {
  id: serial("id").primaryKey(),
  ownerAddress: text("owner_address").notNull(),
  tokenAddress: text("token_address").notNull(),
  tokenName: text("token_name"),
  walletCount: integer("wallet_count").notNull(),
  speed: text("speed").notNull().default("moderate"),
  budgetSol: real("budget_sol").notNull(),
  solPerWallet: real("sol_per_wallet"),
  bumpSize: real("bump_size"),
  bumpsPerHour: integer("bumps_per_hour"),
  costPerBump: real("cost_per_bump"),
  totalBumps: integer("total_bumps"),
  bumpsExecuted: integer("bumps_executed").default(0),
  estimatedDurationHours: real("estimated_duration_hours"),
  status: text("status").notNull().default("idle"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBotSchema = createInsertSchema(botsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBot = z.infer<typeof insertBotSchema>;
export type Bot = typeof botsTable.$inferSelect;
