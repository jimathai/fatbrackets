export type ProcessedImage = {
  blob: Blob;
  width: number;
  height: number;
  hash: string;
};

type CropBox = {
  x: number;
  y: number;
  size: number;
};

async function sha256(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function renderProcessedImage(bitmap: ImageBitmap, crop: CropBox, size = 640): Promise<ProcessedImage> {
  const safeSize = Math.max(1, crop.size);
  const safeX = Math.max(0, Math.min(bitmap.width - safeSize, crop.x));
  const safeY = Math.max(0, Math.min(bitmap.height - safeSize, crop.y));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable in this browser.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, safeX, safeY, safeSize, safeSize, 0, 0, size, size);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not compress image.")), "image/webp", 0.82));
  return { blob, width: size, height: size, hash: await sha256(blob) };
}

export async function processContestantImage(file: File, size = 640): Promise<ProcessedImage> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  const bitmap = await createImageBitmap(file);
  try {
    const sourceSize = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.max(0, (bitmap.width - sourceSize) / 2);
    const sourceY = Math.max(0, (bitmap.height - sourceSize) / 2);
    return await renderProcessedImage(bitmap, { x: sourceX, y: sourceY, size: sourceSize }, size);
  } finally {
    bitmap.close();
  }
}

export async function processCroppedContestantImage(source: Blob, crop: CropBox, size = 640): Promise<ProcessedImage> {
  if (!source.type.startsWith("image/")) throw new Error("Please choose an image file.");
  const bitmap = await createImageBitmap(source);
  try {
    return await renderProcessedImage(bitmap, crop, size);
  } finally {
    bitmap.close();
  }
}
