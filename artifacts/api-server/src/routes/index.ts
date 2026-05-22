import { Router, type IRouter } from "express";
import healthRouter from "./health";
import walletsRouter from "./wallets";
import bundlesRouter from "./bundles";
import botsRouter from "./bots";
import dashboardRouter from "./dashboard";
import tokensRouter from "./tokens";
import portfolioRouter from "./portfolio";
import githubRouter from "./github";

const router: IRouter = Router();

router.use(healthRouter);
router.use(walletsRouter);
router.use(bundlesRouter);
router.use(botsRouter);
router.use(dashboardRouter);
router.use(tokensRouter);
router.use(portfolioRouter);
router.use(githubRouter);

export default router;
