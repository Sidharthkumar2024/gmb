import { api } from "./api";

// Direct-to-storage upload. The server issues a short-lived presigned PUT URL
// (scoped to the tenant); the browser uploads the bytes straight to S3/R2 and
// then stores the returned public URL. Used to replace "paste an image URL"
// inputs (branding logo, GMB images) with a real file upload.

interface PresignResult {
  uploadUrl: string;
  publicUrl: string;
  key: string;
}

export type UploadPurpose = "gmb-image" | "branding-logo";

/**
 * Upload a file to object storage and return its public URL. Throws
 * ApiClientError with a 503 message when storage isn't configured, or an Error
 * if the storage PUT itself fails.
 */
export async function uploadFile(
  file: File,
  purpose: UploadPurpose = "gmb-image",
): Promise<string> {
  const { uploadUrl, publicUrl } = await api.post<PresignResult>(
    "/api/v1/uploads/presign",
    { filename: file.name, purpose },
  );

  // PUT straight to storage. Only `host` is signed (UNSIGNED-PAYLOAD), so
  // Content-Type can ride along without breaking the signature.
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status}). Please try again.`);
  }
  return publicUrl;
}
