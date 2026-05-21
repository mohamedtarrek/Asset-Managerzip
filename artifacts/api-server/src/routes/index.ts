import { Router, type IRouter } from "express";
import healthRouter from "./health";
import walletsRouter from "./wallets";
import bundlesRouter from "./bundles";
import botsRouter from "./bots";
import dashboardRouter from "./dashboard";
import tokensRouter from "./tokens";

const router: IRouter = Router();

router.use(healthRouter);
router.use(walletsRouter);
router.use(bundlesRouter);
router.use(botsRouter);
router.use(dashboardRouter);
router.use(tokensRouter);

export default router;
