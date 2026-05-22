import { Router } from "express";
import type { IRouter } from "express";
import { exec } from "child_process";
import { promisify } from "util";

const router: IRouter = Router();
const execAsync = promisify(exec);
const WORKSPACE = "/home/runner/workspace";

// POST /github/push — commit and push workspace changes to a GitHub repo
router.post("/github/push", async (req, res): Promise<void> => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(400).json({
      error: "GITHUB_TOKEN not set",
      hint: "Add GITHUB_TOKEN to your project secrets (Settings → Secrets). Generate one at https://github.com/settings/tokens with repo scope.",
    });
    return;
  }

  const { repoUrl = "https://github.com/mohamedtarrek/Asset-Managerzip" } = req.body as { repoUrl?: string };

  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) {
    res.status(400).json({ error: "Invalid GitHub repo URL. Expected https://github.com/owner/repo" });
    return;
  }
  const [, owner, repo] = match;
  const authenticatedUrl = `https://${token}@github.com/${owner}/${repo}.git`;

  try {
    await execAsync('git config user.email "svarog-app@replit.com"', { cwd: WORKSPACE }).catch(() => {});
    await execAsync('git config user.name "Svarog App"', { cwd: WORKSPACE }).catch(() => {});

    await execAsync("git add -A", { cwd: WORKSPACE });

    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    let committed = false;
    try {
      await execAsync(`git commit -m "Update from Svarog App — ${timestamp}"`, { cwd: WORKSPACE });
      committed = true;
    } catch (err: unknown) {
      const msg = (err as { stdout?: string }).stdout ?? "";
      if (!msg.includes("nothing to commit")) throw err;
    }

    const { stdout, stderr } = await execAsync(
      `git push "${authenticatedUrl}" HEAD:main --force`,
      { cwd: WORKSPACE }
    );

    res.json({
      success: true,
      committed,
      message: `Pushed to ${owner}/${repo}`,
      output: (stdout + stderr).trim() || "Push successful",
    });
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string };
    const msg = (e.message ?? "") + (e.stderr ?? "");
    const safe = msg.replace(new RegExp(token, "g"), "***");
    res.status(500).json({ error: "Push failed", details: safe });
  }
});

export default router;
