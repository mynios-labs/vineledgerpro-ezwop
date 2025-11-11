import fs from "fs";
import path from "path";
import crypto from "crypto";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export interface ImageUploader {
  upload(buffer: Buffer, mimeType: string): Promise<string>;
  delete(url: string): Promise<void>;
}

class FilesystemUploader implements ImageUploader {
  constructor() {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
  }

  async upload(buffer: Buffer, mimeType: string): Promise<string> {
    const ext = mimeType === "image/png" ? ".png" : ".jpg";
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const filename = `${hash}${ext}`;
    const filepath = path.join(UPLOADS_DIR, filename);

    if (!fs.existsSync(filepath)) {
      await fs.promises.writeFile(filepath, buffer);
    }

    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `http://localhost:${process.env.PORT || 5000}`;

    return `${baseUrl}/uploads/${filename}`;
  }

  async delete(url: string): Promise<void> {
    try {
      const filename = path.basename(url);
      const filepath = path.join(UPLOADS_DIR, filename);
      
      if (fs.existsSync(filepath)) {
        await fs.promises.unlink(filepath);
      }
    } catch (error) {
      console.error("[ImageUploader] Delete failed:", error);
    }
  }
}

export const imageUploader: ImageUploader = new FilesystemUploader();
