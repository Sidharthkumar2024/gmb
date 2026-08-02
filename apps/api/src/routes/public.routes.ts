import { Router, type NextFunction, type Request, type Response } from "express";
import { listPlans } from "../services/plan.service";

const router = Router();

// Public, read-only plan catalog for the marketing pricing page. Only fields a
// visitor needs are returned; assignment counts and admin metadata stay private.
router.get("/plans", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const plans = await listPlans();
    res.json({
      success: true,
      data: plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        description: plan.description,
        priceCents: plan.priceCents,
        currency: plan.currency,
        interval: plan.interval,
        monthlyCredits: plan.monthlyCredits,
        maxLocations: plan.maxLocations,
        maxKeywords: plan.maxKeywords,
        maxUsers: plan.maxUsers,
        features: plan.features,
        isDefault: plan.isDefault,
      })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
