/** Turns an uploaded image into a small PNG data URL for the PDF header and the sidebar. */
export async function fileToLogoDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) throw new Error('Choose a PNG, JPG, WEBP or GIF image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('The image is too large. Choose one under 5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That image could not be read.'));
      el.src = url;
    });
    for (const max of [400, 256, 160]) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser cannot process images.');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/png');
      if (data.length <= 300_000) return data;
    }
    throw new Error('The image is too detailed. Use a simpler or smaller logo.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
