import { chromium } from "playwright";
import sharp from "sharp";
import { PNG } from "pngjs";
import { writeFile } from "fs/promises";
import path from "path";
import os from "os";
import pixelmatch from "pixelmatch";

// URLs y parámetros como constantes
const url1 = "http://localhost:5173/rick-and-morty-app";  // URL de la imagen local
const url2 = "https://www.figma.com/proto/rLqGVk83OKICyAhvW7gjFW/Front-end-test-project?node-id=873-4390&t=4uGRGGWvWcsXMwnN-0&scaling=min-zoom&content-scaling=fixed&page-id=2%3A11&starting-point-node-id=873%3A4390";  // URL de la imagen desplegada
const width = 1280;  // Ancho de la captura
const height = 720;  // Alto de la captura

async function compareImages() {
  const browser = await chromium.launch();
  const context = await browser.newContext();

  const screenshots: Record<string, Buffer> = {};

  const urls = [
    { name: "local", url: url1 },
    { name: "deployed", url: url2 },
  ];

  const viewportWidth = width || 1280;
  const viewportHeight = height || 720;

  // Tomar capturas de pantalla
  for (const { name, url } of urls) {
    const page = await context.newPage();
    await page.setViewportSize({
      width: viewportWidth,
      height: viewportHeight,
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000); // Esperar para asegurar que la página cargue
    const buffer = await page.screenshot({ fullPage: false });
    screenshots[name] = buffer;
    await page.close();
  }

  // Crear overlay de comparación
  const finalBuffer = await createOverlayImageWithSharp(
    screenshots["local"],
    screenshots["deployed"],
    0.3
  );

  // Comparar imágenes pixel a pixel
  const img1 = PNG.sync.read(screenshots["local"]);
  const img2 = PNG.sync.read(screenshots["deployed"]);

  const { width: imgWidth, height: imgHeight } = img1;
  const diff = new PNG({ width: imgWidth, height: imgHeight });

  pixelmatch(img1.data, img2.data, diff.data, imgWidth, imgHeight, {
    threshold: 0.3,
  });

  const diffBuffer = PNG.sync.write(diff);

  // Guardar resultados en disco
  const tempDir = os.tmpdir();
  const tempComparePath = path.join(tempDir, `LocalCompare.png`);
  const tempDiffPath = path.join(tempDir, `LocalDiff.png`);

  await writeFile(tempComparePath, finalBuffer);
  await writeFile(tempDiffPath, diffBuffer);

  
  await browser.close();

  // Retornar las URLs de los resultados
  return {
    tempComparePath,
    tempDiffPath,
  };
}

async function createOverlayImageWithSharp(
  baseBuffer: Buffer,
  overlayBuffer: Buffer,
  overlayOpacity: number
): Promise<Buffer> {
  const overlayWithOpacity = await sharp(overlayBuffer)
    .ensureAlpha()
    .composite([
      {
        input: Buffer.from([255, 255, 255, Math.round(255 * overlayOpacity)]),
        raw: {
          width: 1,
          height: 1,
          channels: 4,
        },
        tile: true,
        blend: "dest-in",
      },
    ])
    .toBuffer();

  const finalBuffer = await sharp(baseBuffer)
    .composite([{ input: overlayWithOpacity, blend: "over" }])
    .png()
    .toBuffer();

  return finalBuffer;
}

// Ejecutar la comparación
compareImages().then(({ tempComparePath, tempDiffPath }) => {
  console.log("Resultado de la comparación (Imagen base y overlay):", tempComparePath);
  console.log("Imagen con diferencias:", tempDiffPath);
});
