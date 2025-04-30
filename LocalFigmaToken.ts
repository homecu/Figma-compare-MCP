import { chromium } from "playwright";
import sharp from "sharp";
import { PNG } from "pngjs";
import { writeFile } from "fs/promises";
import path from "path";
import os from "os";
import pixelmatch from "pixelmatch";
import dotenv from 'dotenv';


dotenv.config();

const token = process.env.FIGMA_TOKEN || "";



const url1 = "http://localhost:5173/rick-and-morty-app"; 
const url2 =
  "https://www.figma.com/design/rLqGVk83OKICyAhvW7gjFW/Front-end-test-project?node-id=873-4390&t=QPcUMZtkjTEpUiml-0"; // URL de la imagen de Figma


async function compareImages() {
  const browser = await chromium.launch();
  const context = await browser.newContext();

  const screenshots: Record<string, Buffer> = {};

 
  let figmaImageBuffer: Buffer;

  if (isFigmaUrl(url2)) {
    figmaImageBuffer = await downloadFigmaImage(url2);
  } else {
    console.error("URL no válida. Debe ser un enlace de Figma.");
    return;
  }

  
  const figmaImageMetadata = await sharp(figmaImageBuffer).metadata();
  const viewportWidth = figmaImageMetadata.width || 1280;
  const viewportHeight = figmaImageMetadata.height || 720;

 
  const page = await context.newPage();
  await page.setViewportSize({
    width: viewportWidth,
    height: viewportHeight,
  });
  await page.goto(url1, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000); // Esperar 2 segundos para asegurar que se cargue todo
  const screenshotBuffer = await page.screenshot({ fullPage: false });
  await page.close();




  screenshots["local"] = screenshotBuffer;
  screenshots["deployed"] = figmaImageBuffer;

  // Crear overlay
  const finalBuffer = await createOverlayImageWithSharp(
    screenshots["local"],
    screenshots["deployed"],
    0.3
  );

  // Comparar pixeles
  const img1 = PNG.sync.read(screenshots["local"]);
  const img2 = PNG.sync.read(screenshots["deployed"]);

  const { width: imgWidth, height: imgHeight } = img1;
  const diff = new PNG({ width: imgWidth, height: imgHeight });

  pixelmatch(img1.data, img2.data, diff.data, imgWidth, imgHeight, {
    threshold: 0.3,
  });

  const diffBuffer = PNG.sync.write(diff);

  const tempDir = os.tmpdir();
  const tempComparePath = path.join(tempDir, `Local-token-compare.png`);
  const tempDiffPath = path.join(tempDir, `Local-token-diff.png`);


  await writeFile(tempComparePath, finalBuffer);
  await writeFile(tempDiffPath, diffBuffer);


  console.log("Comparación completada. Archivos guardados en:");
  console.log("Comparar archivo:", tempComparePath);
  console.log("Archivo de diferencia:", tempDiffPath);

  await browser.close();
 
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

function isFigmaUrl(url: string): boolean {
  return url.includes("figma.com");
}

async function downloadFigmaImage(
  figmaUrl: string,
): Promise<Buffer> {
  const fileKeyMatch = figmaUrl.match(/\/([a-zA-Z0-9]{22})\//);
  const nodeIdMatch = figmaUrl.match(/node-id=([^&]+)/);

  if (!fileKeyMatch || !nodeIdMatch) {
    throw new Error("No se pudo extraer file_key o node_id del URL de Figma");
  }

  const fileKey = fileKeyMatch[1];
  const nodeId = nodeIdMatch[1];

  const apiUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${nodeId}&format=png`;

  const response = await fetch(apiUrl, {
    headers: {
      "X-Figma-Token": token,
    },
  });

  const data = await response.json();

  if (!data.images) {
    throw new Error("No se pudo obtener la URL de la imagen desde Figma");
  }

  const imageUrl = data.images[Object.keys(data.images)[0]];
  const imageResponse = await fetch(imageUrl);
  const arrayBuffer = await imageResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return buffer;
}

// Ejecutar la función de comparación
compareImages().catch((err) =>
  console.error("Error al comparar imágenes:", err)
);
