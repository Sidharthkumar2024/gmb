import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireTenantScope, type RequestWithAuth } from "../middleware/auth";
import { buildUploadKey, presignUpload } from "../services/storage.service";

// Direct-to-storage uploads. The browser asks for a short-lived presigned PUT
// URL, uploads the bytes straight to S3/R2, then stores the returned public URL
// (branding logo, GMB image). The object key is scoped to the caller's tenant
// server-side, so one workspace can never overwrite another's, and the filename
// is sanitised. Fails closed with 503 (from the service) until storage is set up.

const router = Router();

const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  purpose: z.enum(["gmb-image", "branding-logo"]).default("gmb-image"),
});

router.post(
  "/presign",
  requireAuth,
  requireTenantScope,
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { filename, purpose } = presignSchema.parse(req.body);
      // tenantId is guaranteed by requireTenantScope above, never from the body.
      const key = buildUploadKey({ purpose, tenantId: req.tenantId!, filename });
      const { uploadUrl, publicUrl } = await presignUpload({ key });
      res.json({ success: true, data: { uploadUrl, publicUrl, key } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
